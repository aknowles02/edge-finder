import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight, Broadcast, CaretDown, ChartLineUp, Crosshair, LockKey, Pulse, Scales, SealCheck,
} from '@phosphor-icons/react';
import { ENTITLEMENTS, PLANS, TRIAL_DAYS, priceLabel } from '../../shared/plans.js';
import { api, timeAgo } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { CountUp, Reveal, useReveal } from '../lib/motion.jsx';

const SIGNUP = '/login?next=/board';
const CTA_LABEL = 'Start free trial';

const fmtInt = (v) => Math.round(v).toLocaleString();
const fmtPct = (v) => `+${v.toFixed(1)}%`;

const MARKETS = ['Alt spreads', 'Alt totals', 'Passing yards', 'Passing TDs', 'Completions', 'Rushing yards', 'Rush attempts',
  'Receiving yards', 'Receptions', 'Rush + rec yards', 'Anytime TD', 'Interceptions'];

export default function Landing() {
  const { user } = useAuth();
  const [preview, setPreview] = useState(undefined);
  const [record, setRecord] = useState(null);

  useEffect(() => {
    api.get('/api/preview').then((d) => setPreview(d.board)).catch(() => setPreview(null));
    api.get('/api/stats').then((d) => setRecord(d.record)).catch(() => {});
  }, []);

  const cta = user ? '/board' : SIGNUP;

  return (
    <div className="overflow-x-clip">
      <Hero preview={preview} cta={cta} />
      <Numbers preview={preview} />
      <GapSection example={preview?.rows?.[0]} />
      <HowItWorks />
      <MarketsMarquee />
      <TrackRecord record={record} />
      <Pricing cta={cta} />
      <Faq />
      <FinalCta cta={cta} count={preview?.opportunities} />
    </div>
  );
}

/* ── Hero ─────────────────────────────────────────────────────────────── */

function Hero({ preview, cta }) {
  return (
    <section className="relative">
      <div className="hero-glow pointer-events-none absolute inset-0" aria-hidden="true" />
      <div className="hero-grid pointer-events-none absolute inset-0" aria-hidden="true" />
      <div className="relative mx-auto grid max-w-7xl items-center gap-10 px-4 pb-16 pt-10 sm:px-6 lg:grid-cols-[1fr_1.08fr] lg:gap-12 lg:pb-24 lg:pt-16">
        <div className="max-w-xl">
          {preview && (
            <Link to={cta} className="enter inline-flex items-center gap-2 rounded-full border border-win/40 bg-win/10 py-1.5 pl-2 pr-3.5 text-xs font-semibold text-win-text transition hover:bg-win/20 sm:text-sm">
              <span className="live-dot" aria-hidden="true" />
              Week {preview.week} board is live: {preview.opportunities} edges
              <ArrowRight weight="bold" className="h-3.5 w-3.5" />
            </Link>
          )}
          <h1 className="enter mt-5 text-[2.6rem] font-extrabold leading-[1.02] tracking-tight text-white sm:text-6xl lg:text-[4.25rem]" style={{ '--d': '80ms' }}>
            Find Your Edge.
            <span className="block text-win-text">Beat the Market.</span>
          </h1>
          <p className="enter mt-5 max-w-md text-base leading-relaxed text-muted sm:text-lg" style={{ '--d': '160ms' }}>
            Alt lines where your edge is real. Track wins. Measure ROI. Bet with data.
          </p>
          <div className="enter mt-8 flex flex-col gap-3 sm:flex-row" style={{ '--d': '240ms' }}>
            <PrimaryCta to={cta}>{CTA_LABEL}</PrimaryCta>
            <a href="#how" className="btn-ghost h-12 px-6 text-base">See how it works</a>
          </div>
        </div>

        <div className="enter-up" style={{ '--d': '200ms' }}>
          <LockedBoard preview={preview} to={cta} />
        </div>
      </div>
    </section>
  );
}

function PrimaryCta({ to, children, className = '' }) {
  return (
    <Link to={to} className={`cta-shine group relative inline-flex h-12 items-center justify-center gap-2 overflow-hidden rounded-xl bg-win px-6 text-base font-semibold text-white shadow-[0_10px_30px_-10px_rgba(30,107,69,0.9)] transition duration-300 hover:-translate-y-0.5 hover:bg-[#23804F] active:translate-y-0 active:scale-[0.98] ${className}`}>
      <span className="relative z-10">{children}</span>
      <ArrowRight weight="bold" className="relative z-10 h-4 w-4 transition-transform duration-300 group-hover:translate-x-1" />
    </Link>
  );
}

/** The real current board, top 10 by edge, fully redacted server-side. */
function LockedBoard({ preview, to }) {
  const rows = preview?.rows ?? [];
  const locked = preview?.opportunities ?? 0;
  return (
    <Link to={to} aria-label={`Unlock all ${preview?.opportunities ?? ''} edges on this week's board`}
      className="board-card group relative block overflow-hidden rounded-2xl border border-ink-700 bg-ink-850/90 shadow-[0_30px_80px_-30px_rgba(0,0,0,0.8)] ring-1 ring-white/[0.03] backdrop-blur transition duration-500 hover:-translate-y-1 hover:border-win/50">
      <div className="flex items-center justify-between border-b border-ink-700 px-4 py-3 sm:px-5">
        <div className="flex items-center gap-2.5">
          <span className="live-dot" aria-hidden="true" />
          <span className="text-sm font-semibold text-white">{preview ? `Week ${preview.week} Edge Board` : 'Edge Board'}</span>
        </div>
        <span className="text-xs text-muted">{preview?.lastMove ? `line moved ${timeAgo(preview.lastMove)}` : 'Live prices'}</span>
      </div>

      <div className="hidden grid-cols-[28px_1fr_72px_72px] gap-3 px-5 pt-3 text-[10px] font-medium uppercase tracking-wide text-muted-dim sm:grid">
        <span>#</span><span>Bet</span><span className="text-right">Est. prob</span><span className="text-right">Edge</span>
      </div>

      <ol className="relative px-2 pb-24 pt-1 sm:px-3">
        {preview === undefined && Array.from({ length: 7 }, (_, i) => <li key={i} className="skeleton mx-2 my-2 h-11 rounded-lg" />)}
        {preview === null && <li className="px-3 py-10 text-center text-sm text-muted">This week's board is being built. Check back shortly.</li>}
        {rows.map((r, i) => (
          <li key={r.rank} className={`row-in grid grid-cols-[22px_1fr_auto] items-center gap-3 rounded-lg px-2 py-2.5 sm:grid-cols-[28px_1fr_72px_72px] sm:px-3`}
            style={{ '--d': `${300 + i * 70}ms` }}>
            <span className="text-xs tabular-nums text-muted-dim">{r.rank}</span>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted">
                {r.market}
              </div>
              <div className="flex items-center gap-1.5">
                <span className="redacted truncate text-sm font-semibold" aria-hidden="true">{r.bet} {r.game}</span>
                <LockKey weight="fill" className="h-3.5 w-3.5 flex-none text-muted" aria-label="Locked" />
              </div>
            </div>
            <span className="hidden text-right text-sm tabular-nums text-slate-300 sm:block">{(r.prob * 100).toFixed(0)}%</span>
            <span className="text-right text-sm font-bold tabular-nums text-win-text">+{(r.edge * 100).toFixed(1)}%</span>
          </li>
        ))}
      </ol>

      <div className="absolute inset-x-0 bottom-0 flex flex-col items-center gap-2 bg-gradient-to-t from-ink-850 via-ink-850/95 to-transparent px-4 pb-5 pt-14">
        <span className="inline-flex items-center gap-2 rounded-xl bg-win px-5 py-2.5 text-sm font-semibold text-white shadow-[0_10px_30px_-10px_rgba(30,107,69,0.9)] transition duration-300 group-hover:scale-[1.03]">
          <LockKey weight="bold" className="h-4 w-4" />
          Unlock {locked > 0 ? `all ${locked} edges` : 'the board'}
        </span>
        <span className="text-[11px] text-muted">{TRIAL_DAYS} days free. No card required.</span>
      </div>
    </Link>
  );
}

/* ── Real numbers from this week's board ─────────────────────────────── */

function Numbers({ preview }) {
  const items = [
    { value: preview?.opportunities, label: 'edges on this week’s board', format: fmtInt },
    { value: preview?.topEdge != null ? preview.topEdge * 100 : null, label: 'biggest edge right now', format: fmtPct },
    { value: preview?.avgEdge != null ? preview.avgEdge * 100 : null, label: 'average edge', format: fmtPct },
    { value: preview?.games, label: 'games covered', format: fmtInt },
  ];
  return (
    <section className="border-y border-ink-700/70 bg-ink-950/40">
      <dl className="mx-auto grid max-w-7xl grid-cols-2 gap-y-8 px-4 py-10 sm:px-6 lg:grid-cols-4 lg:divide-x lg:divide-ink-700/70">
        {items.map((it, i) => (
          <Reveal key={it.label} delay={i * 80} className="px-2 lg:px-8">
            <dd className="text-3xl font-extrabold tabular-nums text-white sm:text-4xl">
              <CountUp value={it.value} format={it.format} />
            </dd>
            <dt className="mt-1 text-sm text-muted">{it.label}</dt>
          </Reveal>
        ))}
      </dl>
    </section>
  );
}

/* ── The core idea, as one picture ───────────────────────────────────── */

function GapSection({ example }) {
  const ref = useReveal({ threshold: 0.35 });
  // The current #1 edge, anonymized: just the two probabilities.
  const hit = example?.prob ?? 0.88;
  const implied = example ? example.prob - example.edge : 0.75;
  const gap = hit - implied;
  return (
    <section className="mx-auto grid max-w-7xl items-center gap-12 px-4 py-20 sm:px-6 lg:grid-cols-2 lg:py-28">
      <Reveal>
        <h2 className="text-3xl font-bold tracking-tight text-white sm:text-5xl">The price says one thing. History says another.</h2>
        <p className="mt-5 max-w-lg text-base leading-relaxed text-muted sm:text-lg">
          Every alt line has a price, and every price implies a probability. We compare it to how often that exact line has actually hit. When history beats the price, that gap is your edge.
        </p>
        {example && <p className="mt-4 text-sm text-muted-dim">Shown: this week's top-ranked line. Unlock the board to see which one.</p>}
      </Reveal>

      <div ref={ref} className="gap-viz reveal rounded-2xl border border-ink-700 bg-ink-850 p-6 sm:p-8">
        <Bar label="What the price implies" value={implied} tone="market" />
        <div className="my-5" />
        <Bar label="How often it actually hit" value={hit} tone="history" delay={250} />
        <div className="relative mt-6 h-12">
          <div className="gap-bracket absolute top-0 h-5 rounded-b-md border-x-2 border-b-2 border-win-text"
            style={{ left: `${implied * 100}%`, width: `${Math.max(gap, 0.01) * 100}%` }} />
          <div className="gap-label absolute top-6 -translate-x-1/2 whitespace-nowrap text-lg font-extrabold text-win-text"
            style={{ left: `${Math.min(88, (implied + gap / 2) * 100)}%` }}>
            +{(gap * 100).toFixed(1)}% edge
          </div>
        </div>
      </div>
    </section>
  );
}

function Bar({ label, value, tone, delay = 0 }) {
  return (
    <div>
      <div className="mb-2 flex justify-between text-sm">
        <span className="text-muted">{label}</span>
        <span className={`font-bold tabular-nums ${tone === 'history' ? 'text-win-text' : 'text-slate-200'}`}>{(value * 100).toFixed(1)}%</span>
      </div>
      <div className="h-4 overflow-hidden rounded-full bg-ink-700/70">
        <div className={`bar-fill h-full rounded-full ${tone === 'history' ? 'bg-win' : 'bg-[#4A5866]'}`}
          style={{ '--w': `${value * 100}%`, '--d': `${delay}ms` }} />
      </div>
    </div>
  );
}

/* ── How it works: three verbs, one connected track ──────────────────── */

const STEPS = [
  { icon: Broadcast, title: 'Price', body: 'Every alt spread, total and player ladder is re-priced from live markets, with timestamps on every line move.' },
  { icon: Crosshair, title: 'Score', body: 'Each line is checked against how often it has actually hit in real games. Thin samples get flagged.' },
  { icon: SealCheck, title: 'Track', body: 'The moment a line qualifies it is locked and graded at that price. Wins, losses, ROI and closing line value, in public.' },
];

function HowItWorks() {
  return (
    <section id="how" className="scroll-mt-20 border-t border-ink-700/70 bg-ink-950/40 py-20 lg:py-28">
      <div className="mx-auto max-w-7xl px-4 sm:px-6">
        <Reveal as="h2" className="max-w-2xl text-3xl font-bold tracking-tight text-white sm:text-4xl">From price to proof in three moves.</Reveal>
        <ol className="relative mt-14 grid gap-10 md:grid-cols-3 md:gap-8">
          <div className="steps-line absolute left-5 top-5 hidden h-px w-[calc(100%-2.5rem)] md:block" aria-hidden="true" />
          {STEPS.map(({ icon: Icon, title, body }, i) => (
            <Reveal as="li" key={title} delay={i * 140} className="relative">
              <div className="relative z-10 grid h-10 w-10 place-items-center rounded-full border border-win/50 bg-ink-900 text-win-text">
                <Icon weight="bold" className="h-5 w-5" />
              </div>
              <h3 className="mt-5 text-xl font-bold text-white">{title}</h3>
              <p className="mt-2 max-w-sm text-sm leading-relaxed text-muted">{body}</p>
            </Reveal>
          ))}
        </ol>
      </div>
    </section>
  );
}

function MarketsMarquee() {
  const items = [...MARKETS, ...MARKETS];
  return (
    <section className="border-y border-ink-700/70 py-6" aria-label="Markets covered">
      <div className="marquee-mask overflow-hidden">
        <ul className="marquee flex w-max gap-3">
          {items.map((m, i) => (
            <li key={i} className="whitespace-nowrap rounded-full border border-ink-700 bg-ink-850 px-4 py-2 text-sm font-medium text-slate-300" aria-hidden={i >= MARKETS.length}>
              {m}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

/* ── Honesty is the differentiator ───────────────────────────────────── */

const PROOF = [
  [SealCheck, 'Locked at the price you saw', 'Results and ROI use the price when the line first qualified. No re-pricing, no deleting losers.'],
  [ChartLineUp, 'Closing line value on every bet', 'See whether the market moved toward each pick before kickoff, the sharpest signal there is.'],
  [Scales, 'Backtests kept separate', 'Hypothetical results live on their own tab and never touch the real record.'],
  [Pulse, 'Volatile props kept out', 'Touchdown and interception props are shown with a warning but never counted in the record. One play decides them.'],
];

function TrackRecord({ record }) {
  const graded = record ? record.wins + record.losses : 0;
  const tiles = graded > 0
    ? [
      { k: 'Record', v: `${record.wins}-${record.losses}` },
      { k: 'ROI', v: `${record.roi >= 0 ? '+' : ''}${(record.roi * 100).toFixed(1)}%` },
      { k: 'Units', v: `${record.units >= 0 ? '+' : ''}${record.units.toFixed(1)}u` },
    ]
    : [
      { k: 'Picks tracked so far', v: record ? record.total.toLocaleString() : '...' },
      { k: 'Grading', v: 'Automatic' },
      { k: 'Edited after the fact', v: 'Never' },
    ];
  return (
    <section className="mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:py-28">
      <div className="grid gap-12 lg:grid-cols-[1.1fr_1fr] lg:items-center">
        <Reveal>
          <h2 className="text-3xl font-bold tracking-tight text-white sm:text-5xl">Every pick is locked the second it posts.</h2>
          <ul className="mt-8 space-y-5">
            {PROOF.map(([Icon, title, body]) => (
              <li key={title} className="flex gap-4">
                <Icon weight="bold" className="mt-0.5 h-6 w-6 flex-none text-win-text" />
                <div>
                  <div className="font-semibold text-white">{title}</div>
                  <p className="mt-1 text-sm leading-relaxed text-muted">{body}</p>
                </div>
              </li>
            ))}
          </ul>
        </Reveal>
        <Reveal delay={120} className="grid grid-cols-2 gap-3">
          {tiles.map((t, i) => (
            <div key={t.k} className={`rounded-2xl border border-ink-700 p-6 ${i === 0 ? 'col-span-2 bg-gradient-to-br from-win/25 via-ink-850 to-ink-850' : 'bg-ink-850'}`}>
              <div className="text-sm text-muted">{t.k}</div>
              <div className={`mt-2 font-extrabold tabular-nums text-white ${i === 0 ? 'text-5xl' : 'text-2xl'}`}>{t.v}</div>
            </div>
          ))}
        </Reveal>
      </div>
    </section>
  );
}

/* ── Pricing ─────────────────────────────────────────────────────────── */

function Pricing({ cta }) {
  const pro = PLANS.pro;
  return (
    <section id="pricing" className="scroll-mt-20 border-t border-ink-700/70 bg-ink-950/40 py-20 lg:py-28">
      <div className="mx-auto max-w-5xl px-4 sm:px-6">
        <Reveal as="h2" className="text-center text-3xl font-bold tracking-tight text-white sm:text-4xl">Try every edge free for {TRIAL_DAYS} days.</Reveal>
        <div className="mt-12 grid gap-4 md:grid-cols-[1fr_1.35fr]">
          <Reveal className="rounded-2xl border border-ink-700 bg-ink-850 p-7">
            <h3 className="font-semibold text-white">Free trial</h3>
            <div className="mt-3 text-4xl font-extrabold text-white">$0</div>
            <p className="mt-1 text-sm text-muted">{TRIAL_DAYS} days. No card. Ends on its own.</p>
            <ul className="mt-6 space-y-2.5 text-sm text-slate-300">
              {[ENTITLEMENTS.board, 'Every market and filter', 'Live prices and line moves'].map((f) => (
                <li key={f} className="flex gap-2"><SealCheck weight="fill" className="h-4 w-4 flex-none text-win-text" />{f}</li>
              ))}
            </ul>
          </Reveal>
          <Reveal delay={100} className="pro-card relative overflow-hidden rounded-2xl border border-win/60 bg-ink-850 p-7">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-white">{pro.name}</h3>
              <span className="rounded-full bg-win/20 px-2.5 py-1 text-xs font-semibold text-win-text">After your trial</span>
            </div>
            <div className="mt-3 text-4xl font-extrabold text-white">{priceLabel(pro).replace('/mo', '')}<span className="text-base font-medium text-muted">/month</span></div>
            <p className="mt-1 text-sm text-muted">Renews monthly. Cancel anytime from your account.</p>
            <ul className="mt-6 grid gap-2.5 text-sm text-slate-300 sm:grid-cols-2">
              {pro.entitlements.map((k) => (
                <li key={k} className="flex gap-2"><SealCheck weight="fill" className="h-4 w-4 flex-none text-win-text" />{ENTITLEMENTS[k]}</li>
              ))}
            </ul>
            <PrimaryCta to={cta} className="mt-7 w-full">{CTA_LABEL}</PrimaryCta>
          </Reveal>
        </div>
      </div>
    </section>
  );
}

/* ── FAQ ─────────────────────────────────────────────────────────────── */

const FAQS = [
  ['Is this a guarantee?', 'No. Hit rates come from past games and a positive edge can still lose. We show every result, wins and losses, so you can judge the method yourself.'],
  ['Where do the prices come from?', 'Live Kalshi markets for alt spreads, totals and player props, re-priced throughout the day. Kalshi’s fee is included, so the edge is what you would actually get.'],
  ['Do I need a card for the trial?', `No. The ${TRIAL_DAYS}-day trial needs only your email and ends on its own. You choose whether to subscribe.`],
  ['How do I cancel Pro?', 'From your account page, anytime. You keep access until the end of the month you paid for.'],
];

function Faq() {
  return (
    <section className="mx-auto max-w-3xl px-4 py-20 sm:px-6 lg:py-24">
      <Reveal as="h2" className="text-3xl font-bold tracking-tight text-white sm:text-4xl">Questions, answered straight.</Reveal>
      <div className="mt-8 divide-y divide-ink-700/70 border-y border-ink-700/70">
        {FAQS.map(([q, a]) => (
          <details key={q} className="faq group py-5">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-left font-semibold text-white">
              {q}
              <CaretDown weight="bold" className="h-4 w-4 flex-none text-muted transition-transform duration-300 group-open:rotate-180" />
            </summary>
            <p className="mt-3 text-sm leading-relaxed text-muted">{a}</p>
          </details>
        ))}
      </div>
    </section>
  );
}

function FinalCta({ cta, count }) {
  return (
    <section className="relative overflow-hidden border-t border-ink-700/70">
      <div className="hero-glow pointer-events-none absolute inset-0 opacity-80" aria-hidden="true" />
      <Reveal className="relative mx-auto flex max-w-3xl flex-col items-center px-4 py-20 text-center sm:px-6 lg:py-28">
        <h2 className="text-3xl font-extrabold tracking-tight text-white sm:text-5xl">
          {count ? `${count} edges are on the board right now.` : 'This week’s edges are on the board.'}
        </h2>
        <p className="mt-4 max-w-md text-muted">See every one of them free for {TRIAL_DAYS} days.</p>
        <PrimaryCta to={cta} className="mt-8">{CTA_LABEL}</PrimaryCta>
      </Reveal>
    </section>
  );
}
