# Edge Finder

NFL alt-line edge finder: DraftKings alternate spreads, totals and QB props where the blended historical hit rate beats the implied probability. React + Tailwind front end, Express API, PostgreSQL, Stripe billing, magic-link email auth. Deploys to Vercel as one project.

## How the numbers work

| | |
|---|---|
| Implied | `|odds| ÷ (|odds| + 100)` (positive odds: `100 ÷ (odds + 100)`) |
| Blended hit rate | `0.75 × 2025 + 0.25 × 2026 (Weeks 1–3)`; falls back to whichever season has data. Props: QB games with 15+ attempts (filter upstream before pasting). |
| Edge | `blended − implied`. Rows at or below zero are dropped on import. |
| Small sample | `n_2025 + n_2026 < 15` gets a ● warning and can be hidden. |
| Units | 1u flat. Win at −250 = +0.4u, loss = −1u, push = 0 and excluded from win rate / ROI. |
| ROI | `units ÷ decided bets` |
| Official record | Positive-edge bets inside each board's own odds window (default −500 to −200). Users can widen/narrow the window on the board; the stat cards follow their filters. |

All of this lives in `shared/edge.js`, which both the API and the browser import, so the admin paste preview, the stored values and the UI can never disagree. Tests: `npm test`.

## Weekly workflow (admin)

1. Sign in with an email listed in `ADMIN_EMAILS` → **Admin**.
2. Paste the week's odds (CSV or straight from Google Sheets):
   ```
   game,market,selection,line,odds,hit_2025,n_2025,hit_2026,n_2026
   BUF @ MIA,spread,BUF,+2.5,-310,86%,17,67%,3
   BUF @ MIA,total,Over,37.5,-360,0.88,17,1.00,3
   BUF @ MIA,prop,Josh Allen Pass Yds Over,189.5,-280,82%,11,100%,3
   ```
   `game` must be `AWAY @ HOME`; spread `selection` is one of those teams; totals are `Over`/`Under`. A live preview flags bad rows before you save.
3. **Publish** (tick "Email Premium" to send the new-board alert — sent once per board).
4. After games: **Results** → enter final scores → spreads and totals grade themselves. Grade props with the W/L/P dropdown.

## Plans

Defined once in `shared/plans.js` (the API enforces them, the UI renders copy from them).

- **7-day free trial** — automatic on sign-up, no card. Includes the live Edge Board only. Ends on its own.
- **Edge Finder Pro $19.99/mo** — board + every past board + results/CLV/ROI reports + email alerts.
  Subscribing mid-trial defers the first charge to the trial's end (Stripe `trial_end`), and checkout states the price, first-charge date and auto-renewal.
- Adding a tier later (e.g. sport-specific or Elite): add an entry to `PLANS` with its own `stripePriceEnv`, `entitlements` and `sports`. Webhooks map the Stripe price back to the plan.

## Live odds & tracking

- `server/odds.js` re-prices DraftKings alt spreads/totals from [The Odds API](https://the-odds-api.com) (`ODDS_API_KEY`). Cadence speeds up toward kickoff: 6h → 2h → 1h → every 15 min in the last 3 hours. Props stay manual.
- Scheduler: `.github/workflows/refresh-odds.yml` (template in `deploy/github-refresh-odds.yml`) calls `/api/cron/refresh-odds` every 15 min (add repo secrets `CRON_SECRET` and `APP_URL`); `vercel.json` adds a daily Vercel Cron as a fallback (Hobby plans only allow daily). Both authenticate with `CRON_SECRET`.
- Every run is logged; the board shows last check / last line move times and warns when a price is stale (not re-checked within 2× its cadence), a line was pulled, or the last refresh failed.
- A bet becomes a **tracked opportunity** the moment it first qualifies (edge > 0 inside the board's odds window). Its price, probability and edge are snapshotted and locked by database triggers; published live boards with tracked bets can't be unpublished, replaced or deleted. Results and ROI are graded at the locked price; the last pre-kickoff price is stored as the close for CLV.
- **Backtests** are imported as their own board type, never appear on the Edge Board or the public record, and are reported on a separate, labelled tab.

## Local development

```bash
cp .env.example .env        # fill in DATABASE_URL, SESSION_SECRET, ADMIN_EMAILS, Stripe keys
npm install
npm run migrate             # creates tables (idempotent)
npm run seed                # optional demo data: 2026 weeks 5 (graded) and 6
npm run dev                 # API :3001 + Vite :5173 (proxied)
```

Without `RESEND_API_KEY`, magic links are printed in the API console. For Stripe webhooks locally:
`stripe listen --forward-to localhost:3001/api/billing/webhook`.

## Deploy to Vercel

1. Create a Postgres database (Neon via Vercel Marketplace works well — use the **pooled** connection string).
2. In Stripe: create a product with a $19.99/month recurring price; enable the Customer Portal; add a webhook to `https://YOUR_DOMAIN/api/billing/webhook` for `checkout.session.completed` and `customer.subscription.created|updated|deleted`.
3. In Resend: verify your sending domain.
4. Import the repo into Vercel and set every variable from `.env.example` (`APP_URL` = your production URL).
5. Run `npm run migrate` once against the production `DATABASE_URL`, then deploy.

`vercel.json` routes `/api/*` to the Express app in `api/index.js` and everything else to the SPA.

## Security notes

- Magic links: 32-byte random tokens, stored as SHA-256 hashes, 15-minute expiry, single use, and consumed by a POST from the page (so email link scanners can't burn them). Login is rate-limited.
- Sessions: signed JWT in an `httpOnly`, `SameSite=Lax`, `Secure` (in prod) cookie; plus an Origin check on every mutating request.
- Stripe webhook verified against the raw body; subscription state is only ever written by the webhook.
- Helmet security headers, parameterized SQL everywhere, admin routes gated by `ADMIN_EMAILS`.
