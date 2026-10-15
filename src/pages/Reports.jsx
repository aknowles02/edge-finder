import { useEffect, useState } from 'react';
import { betLabel, closingLineValue, formatOdds } from '../../shared/edge.js';
import { api, pct, signedPct, units } from '../lib/api.js';
import { Alert, ResultBadge, Spinner } from '../components/ui.jsx';

const TABS = [
  { id: 'live', label: 'Real results' },
  { id: 'backtest', label: 'Backtests' },
];

export default function Reports() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [tab, setTab] = useState('live');

  useEffect(() => { api.get('/api/reports').then(setData).catch((e) => setError(e.message)); }, []);

  if (error) return <div className="mx-auto max-w-5xl px-4 py-8"><Alert>{error}</Alert></div>;
  if (!data) return <div className="grid min-h-[50vh] place-items-center"><Spinner /></div>;
  const r = data[tab];
  const isBacktest = tab === 'backtest';

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
      <h1 className="text-2xl font-bold text-white sm:text-3xl">Results &amp; ROI</h1>
      <div className="mt-4 inline-flex rounded-xl border border-ink-700 bg-ink-850 p-1" role="tablist">
        {TABS.map((t) => (
          <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}
            className={`rounded-lg px-4 py-2 text-sm font-semibold transition ${tab === t.id ? (t.id === 'live' ? 'bg-win text-white' : 'bg-ink-600 text-white') : 'text-muted hover:text-slate-200'}`}>
            {t.label}
          </button>
        ))}
      </div>

      <div className={`mt-4 rounded-xl border px-4 py-3 text-sm ${isBacktest ? 'border-warn/40 bg-warn/10 text-warn' : 'border-win/40 bg-win/10 text-win-text'}`}>
        {isBacktest
          ? 'Hypothetical. Backtests apply today’s method to past games after the fact. They were never published or bettable, and are not part of our record.'
          : 'Real, published opportunities only. Each bet is locked the moment it first qualifies and graded at that price — nothing is removed or re-priced afterwards.'}
      </div>

      <Summary s={r.summary} />

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <Breakdown title="By week" rows={r.byWeek} label={(x) => `${x.sport.toUpperCase()} ${x.season} · Wk ${x.week}`} />
        <Breakdown title="By market" rows={r.byMarket} label={(x) => ({ spread: 'Alt spreads', total: 'Alt totals', prop: 'QB props' }[x.market] ?? x.market)} />
      </div>

      {!isBacktest && <Opportunities list={data.opportunities} />}
    </div>
  );
}

function Summary({ s }) {
  const decided = s.wins + s.losses;
  const items = [
    ['Record', decided + s.pushes ? `${s.wins}–${s.losses}${s.pushes ? `–${s.pushes}` : ''}` : '—', s.pending ? `${s.pending} pending` : null],
    ['Win rate', pct(s.winRate), null],
    ['Units', decided ? units(s.units) : '—', '1u flat stakes'],
    ['ROI', signedPct(s.roi), null],
    ['Avg CLV', signedPct(s.avgClv), s.clvCount ? `${s.clvCount} with a closing price` : 'no closing prices yet'],
    ['Beat the close', pct(s.beatClose, 0), null],
  ];
  return (
    <section className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
      {items.map(([label, value, sub]) => (
        <div key={label} className="card p-4">
          <div className="text-[11px] font-medium uppercase tracking-wide text-muted">{label}</div>
          <div className="mt-1 text-xl font-bold tabular-nums text-white">{value}</div>
          {sub && <div className="mt-0.5 text-xs text-muted-dim">{sub}</div>}
        </div>
      ))}
    </section>
  );
}

function Breakdown({ title, rows, label }) {
  return (
    <section className="card overflow-hidden">
      <h2 className="border-b border-ink-700 px-4 py-3 text-sm font-semibold text-white">{title}</h2>
      {rows.length === 0 ? <p className="p-4 text-sm text-muted">Nothing graded yet.</p> : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-[11px] uppercase tracking-wide text-muted">
              <tr><th className="px-4 py-2 font-medium" /><th className="px-3 py-2 text-right font-medium">Record</th><th className="px-3 py-2 text-right font-medium">Units</th><th className="px-3 py-2 text-right font-medium">ROI</th><th className="px-4 py-2 text-right font-medium">CLV</th></tr>
            </thead>
            <tbody className="divide-y divide-ink-700/70">
              {rows.map((x) => (
                <tr key={label(x)}>
                  <td className="whitespace-nowrap px-4 py-2 text-slate-200">{label(x)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{x.wins}–{x.losses}{x.pushes ? `–${x.pushes}` : ''}</td>
                  <td className={`px-3 py-2 text-right tabular-nums ${x.units > 0 ? 'text-win-text' : x.units < 0 ? 'text-loss-text' : ''}`}>{x.wins + x.losses ? units(x.units) : '—'}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{signedPct(x.roi)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{signedPct(x.avgClv)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function Opportunities({ list }) {
  return (
    <section className="card mt-6 overflow-hidden">
      <h2 className="border-b border-ink-700 px-4 py-3 text-sm font-semibold text-white">Every tracked opportunity <span className="font-normal text-muted">(latest 200)</span></h2>
      {list.length === 0 ? <p className="p-4 text-sm text-muted">No opportunities tracked yet.</p> : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-[11px] uppercase tracking-wide text-muted">
              <tr>
                <th className="px-4 py-2 font-medium">Qualified</th><th className="px-3 py-2 font-medium">Bet</th>
                <th className="px-3 py-2 text-right font-medium">Locked</th><th className="px-3 py-2 text-right font-medium">Edge</th>
                <th className="px-3 py-2 text-right font-medium">Close</th><th className="px-3 py-2 text-right font-medium">CLV</th><th className="px-4 py-2 font-medium">Result</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-700/70">
              {list.map((o) => {
                const clv = closingLineValue(o.qualifiedOdds, o.closingOdds);
                return (
                  <tr key={o.id}>
                    <td className="whitespace-nowrap px-4 py-2 text-xs text-muted">{new Date(o.qualifiedAt).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</td>
                    <td className="whitespace-nowrap px-3 py-2"><span className="text-muted">{o.game} · </span><span className="font-semibold text-white">{betLabel(o)}</span></td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatOdds(o.qualifiedOdds)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-win-text">{signedPct(o.qualifiedEdge)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-300">{o.closingOdds != null ? formatOdds(o.closingOdds) : '—'}</td>
                    <td className={`px-3 py-2 text-right tabular-nums ${clv > 0 ? 'text-win-text' : clv < 0 ? 'text-loss-text' : 'text-muted'}`}>{signedPct(clv)}</td>
                    <td className="px-4 py-2"><ResultBadge result={o.result} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
