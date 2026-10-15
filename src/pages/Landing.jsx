import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { formatRecord } from '../../shared/edge.js';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import HitBar from '../components/HitBar.jsx';

const steps = [
  {
    title: 'Price every alt line',
    body: 'Each week we pull DraftKings alternate spreads, totals and QB props and convert every price to its implied probability.',
  },
  {
    title: 'Blend the hit rate',
    body: '75% full 2025 season, 25% 2026 to date. Props only count QB games with 15+ attempts. Small samples get flagged.',
  },
  {
    title: 'Show only real edge',
    body: 'Edge = hit rate − implied. Anything at or below zero never makes the board. Results grade themselves after the final whistle.',
  },
];

const preview = [
  { game: 'KC @ LV', bet: 'KC +3.5', odds: '−400', hit: 0.93, implied: 0.8 },
  { game: 'SF @ ARI', bet: 'Under 52.5', odds: '−410', hit: 0.955, implied: 0.804 },
  { game: 'BUF @ MIA', bet: 'BUF +2.5', odds: '−310', hit: 0.813, implied: 0.756 },
];

export default function Landing() {
  const { user } = useAuth();
  const [record, setRecord] = useState(null);

  useEffect(() => {
    api.get('/api/stats').then((d) => setRecord(d.record)).catch(() => {});
  }, []);

  const cta = user ? '/board' : '/login';
  const hasRecord = record && record.wins + record.losses > 0;

  return (
    <>
      <section className="relative overflow-hidden">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-[480px] bg-[radial-gradient(60%_60%_at_50%_0%,rgba(30,107,69,0.28),transparent)]" />
        <div className="relative mx-auto max-w-5xl px-4 pb-16 pt-16 text-center sm:px-6 sm:pt-24">
          {hasRecord && (
            <div className="mx-auto mb-6 inline-flex items-center gap-2 rounded-full border border-win/40 bg-win/10 px-3.5 py-1.5 text-xs font-semibold text-win-text sm:text-sm">
              <span className="h-1.5 w-1.5 rounded-full bg-win-text" />
              Season record: {formatRecord(record)}
            </div>
          )}
          <h1 className="text-4xl font-extrabold tracking-tight text-white sm:text-6xl">
            Find Your Edge.<br className="hidden sm:block" /> <span className="text-win-text">Beat the Market.</span>
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-base text-muted sm:text-lg">
            Alt lines where your edge is real. Track wins. Measure ROI. Bet with data.
          </p>
          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link to={cta} className="btn-primary w-full px-6 py-3 text-base sm:w-auto">See this week's board</Link>
            <a href="#pricing" className="btn-ghost w-full px-6 py-3 text-base sm:w-auto">Pricing</a>
          </div>

          <div className="card mx-auto mt-14 max-w-3xl p-4 text-left sm:p-6">
            <div className="mb-3 flex items-center justify-between text-xs font-medium uppercase tracking-wide text-muted">
              <span>Sample board</span><span>Hit rate vs price</span>
            </div>
            <ul className="divide-y divide-ink-700">
              {preview.map((p) => (
                <li key={p.bet} className="grid grid-cols-[1fr_auto] items-center gap-3 py-3 sm:grid-cols-[1fr_80px_200px_70px]">
                  <div>
                    <div className="font-semibold text-white">{p.bet}</div>
                    <div className="text-xs text-muted">{p.game}</div>
                  </div>
                  <div className="hidden text-sm tabular-nums text-slate-300 sm:block">{p.odds}</div>
                  <div className="col-span-2 sm:col-span-1"><HitBar hit={p.hit} implied={p.implied} /></div>
                  <div className="row-start-1 text-right text-sm font-bold tabular-nums text-win-text sm:row-auto">
                    +{((p.hit - p.implied) * 100).toFixed(1)}%
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
        <h2 className="text-center text-2xl font-bold text-white sm:text-3xl">How the board is built</h2>
        <div className="mt-10 grid gap-4 md:grid-cols-3">
          {steps.map((s, i) => (
            <div key={s.title} className="card p-6">
              <div className="mb-4 grid h-9 w-9 place-items-center rounded-lg bg-win/20 text-sm font-bold text-win-text">{i + 1}</div>
              <h3 className="font-semibold text-white">{s.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted">{s.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section id="pricing" className="mx-auto max-w-4xl scroll-mt-20 px-4 py-16 sm:px-6">
        <h2 className="text-center text-2xl font-bold text-white sm:text-3xl">Simple pricing</h2>
        <div className="mt-10 grid gap-4 md:grid-cols-2">
          <Plan
            name="Free" price="$0" cta="Start free" to={cta}
            features={['Current week\'s board', 'All filters and sorting', 'Live W/L, units and ROI']}
          />
          <Plan
            highlight name="Premium" price="$19.99" period="/mo" cta="Go Premium" to={user ? '/account' : '/login?next=/account'}
            features={['Every historical week', 'Full season track record by week', 'Email alert the moment a new board drops', 'Cancel anytime']}
          />
        </div>
      </section>
    </>
  );
}

function Plan({ name, price, period, features, cta, to, highlight }) {
  return (
    <div className={`card flex flex-col p-6 sm:p-8 ${highlight ? 'border-win/60 ring-1 ring-win/40' : ''}`}>
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-white">{name}</h3>
        {highlight && <span className="rounded-full bg-win/20 px-2.5 py-1 text-xs font-semibold text-win-text">Most popular</span>}
      </div>
      <div className="mt-4 text-4xl font-extrabold text-white">{price}<span className="text-base font-medium text-muted">{period}</span></div>
      <ul className="mt-6 flex-1 space-y-3 text-sm text-slate-300">
        {features.map((f) => (
          <li key={f} className="flex gap-2.5">
            <svg viewBox="0 0 20 20" className="mt-0.5 h-4 w-4 flex-none text-win-text" fill="currentColor" aria-hidden="true"><path fillRule="evenodd" d="M16.7 5.3a1 1 0 0 1 0 1.4l-8 8a1 1 0 0 1-1.4 0l-4-4a1 1 0 1 1 1.4-1.4L8 12.6l7.3-7.3a1 1 0 0 1 1.4 0Z" clipRule="evenodd" /></svg>
            {f}
          </li>
        ))}
      </ul>
      <Link to={to} className={`${highlight ? 'btn-primary' : 'btn-ghost'} mt-8 w-full py-3`}>{cta}</Link>
    </div>
  );
}
