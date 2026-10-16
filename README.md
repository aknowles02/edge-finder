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

## Edge model: your sportsbook vs. Kalshi fair value

Kalshi's NFL ladders are efficiently priced (backtested 2025-26), so they are the fair-price reference:
`server/fair.js` fits each game's margin/total to the whole Kalshi ladder (empirical NFL result shape, key
numbers, pushes) and interpolates player ladders for props. `server/books.js` pulls every supported
sportsbook from The Odds API in one request per game (`ODDS_API_KEY`), and edge = fair probability −
the book's implied probability. Users pick their book; boards and records are per book. Lines qualify
as tracked opportunities at edge ≥ 1% inside the board's odds window. Credits: ~13 per game per pull;
cadence 12h → 6h → 3h → 1h toward kickoff; stops at `ODDS_API_MIN_CREDITS` (default 300). Override
markets with `ODDS_API_MARKETS`. The earlier hit-rate method is retired (`EDGE_MODEL=hitrate` restores
it); its picks remain on the record, reported separately.

## Automated boards (no pasting required)

`server/pipeline.js` runs on page views (throttled to once per 90s), Vercel Cron, the admin button, or `GET /api/tick` (point any free uptime pinger at it). Each run:

1. **Builds this week's board** (hourly) — every Kalshi alt spread/total rung and player-prop rung (`KXNFLSPREAD`, `KXNFLTOTAL`, public API, no key) for the week's open games, scored with nflverse hit rates: spreads pool both teams' logs from the right side, totals pool both teams' games, blended 75% 2025 / 25% 2026-to-date. Lines from −150 to −1000 are stored; the board window (−200 to −500) decides what qualifies. Auto-publishes unless `AUTO_PUBLISH_BOARDS=0`.
2. **Re-prices** every open Kalshi line (ask + Kalshi's taker fee → American odds), logs moves, flags pulled lines.
3. **Locks closing prices** at kickoff and **qualifies** newly positive-edge lines.
4. **Grades** finished games from nflverse finals (every 30 min), and player props from nflverse weekly player stats once that week is published (usually within a day). A player with no stat row (inactive) is left for manual review.

**Player props** (all of Kalshi's per-game NFL player ladders): passing yards / TDs / attempts / completions / INTs, rushing yards / attempts, receiving yards, receptions, rush+rec yards, and anytime TDs (`shared/props.js`). Hit rates use the same 75/25 blend and only count games where the player had a real role (QB 15+ attempts, a carry, or a target); players need 6+ such games.

Games where a team's latest starting QB differs from its usual starter are flagged ⚠. Dry-run with live data and no database: `node scripts/preview-week.js [week]`.

DraftKings' own API blocks server requests, so DraftKings prices come from pasted boards (optionally re-priced via The Odds API with `ODDS_API_KEY`).

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
