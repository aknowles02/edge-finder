import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { SMALL_SAMPLE, betLabel, bestPerSide, formatOdds, summarize } from '../../shared/edge.js';
import { api, pct, signedPct, units } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import HitBar from '../components/HitBar.jsx';
import { Alert, LockIcon, ResultBadge, Spinner } from '../components/ui.jsx';

const MARKET_TABS = [
  { id: 'all', label: 'All' },
  { id: 'spread', label: 'Spread' },
  { id: 'total', label: 'Total' },
  { id: 'prop', label: 'Prop' },
];

const ODDS_PRESETS = [
  { label: '−200 to −500', min: -500, max: -200 },
  { label: '−200 to −1000', min: -1000, max: -200 },
  { label: 'Any', min: -100000, max: 100000 },
];

const COLUMNS = [
  { key: 'game', label: 'Game' },
  { key: 'bet', label: 'Bet' },
  { key: 'odds', label: 'Odds', numeric: true },
  { key: 'blended', label: 'Hit rate', sub: '2025+2026', numeric: true },
  { key: 'implied', label: 'Implied', numeric: true },
  { key: 'edge', label: 'Edge', numeric: true },
  { key: null, label: 'Hit vs price' },
  { key: 'result', label: 'Result' },
];

const sortValue = {
  game: (b) => b.game,
  bet: (b) => betLabel(b),
  odds: (b) => b.odds,
  blended: (b) => b.blended,
  implied: (b) => b.implied,
  edge: (b) => b.edge,
  result: (b) => ({ W: 3, P: 2, L: 1 }[b.result] ?? 0),
};

export default function Board() {
  const { season, week } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [weeks, setWeeks] = useState(null);
  const [state, setState] = useState({ loading: true, board: null, error: null, locked: null });

  const [market, setMarket] = useState('all');
  const [minEdge, setMinEdge] = useState(0);
  const [oddsMin, setOddsMin] = useState(-500);
  const [oddsMax, setOddsMax] = useState(-200);
  const [bestOnly, setBestOnly] = useState(false);
  const [hideSmall, setHideSmall] = useState(false);
  const [sort, setSort] = useState({ key: 'edge', dir: 'desc' });

  useEffect(() => {
    api.get('/api/boards').then(setWeeks).catch(() => setWeeks({ boards: [] }));
  }, [user?.plan]);

  useEffect(() => {
    let cancelled = false;
    setState((s) => ({ ...s, loading: true, error: null, locked: null }));
    const path = season ? `/api/boards/${season}/${week}` : '/api/boards/current';
    api.get(path)
      .then(({ board }) => {
        if (cancelled) return;
        setState({ loading: false, board, error: null, locked: null });
        setOddsMin(board.oddsMin);
        setOddsMax(board.oddsMax);
      })
      .catch((err) => {
        if (cancelled) return;
        if (err.status === 402) setState({ loading: false, board: null, error: null, locked: { season, week } });
        else setState({ loading: false, board: null, error: err, locked: null });
      });
    return () => { cancelled = true; };
  }, [season, week]);

  const { board } = state;

  const rows = useMemo(() => {
    if (!board) return [];
    let list = board.bets.filter((b) =>
      (market === 'all' || b.market === market) &&
      b.edge * 100 >= minEdge &&
      b.odds >= oddsMin && b.odds <= oddsMax &&
      (!hideSmall || b.sampleSize >= SMALL_SAMPLE));
    if (bestOnly) list = bestPerSide(list);
    const get = sortValue[sort.key];
    const dir = sort.dir === 'asc' ? 1 : -1;
    return [...list].sort((a, b) => {
      const x = get(a), y = get(b);
      return (x < y ? -1 : x > y ? 1 : 0) * dir || b.edge - a.edge;
    });
  }, [board, market, minEdge, oddsMin, oddsMax, bestOnly, hideSmall, sort]);

  const stats = useMemo(() => summarize(rows), [rows]);
  const avgEdge = rows.length ? rows.reduce((s, b) => s + b.edge, 0) / rows.length : null;

  function toggleSort(key) {
    if (!key) return;
    setSort((s) => (s.key === key ? { key, dir: s.dir === 'desc' ? 'asc' : 'desc' } : { key, dir: ['game', 'bet'].includes(key) ? 'asc' : 'desc' }));
  }

  const currentLabel = board ? `Week ${board.week}` : state.locked ? `Week ${state.locked.week}` : 'This week';

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-win-text">NFL alt lines · DraftKings</p>
          <h1 className="mt-1 text-2xl font-bold text-white sm:text-3xl">{board ? `${board.season} ${currentLabel}` : currentLabel} board</h1>
        </div>
        {board?.publishedAt && (
          <p className="text-xs text-muted">Published {new Date(board.publishedAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</p>
        )}
      </div>

      <WeekPicker weeks={weeks} active={board ?? state.locked} onPick={(b) => navigate(`/board/${b.season}/${b.week}`)} />

      {state.loading ? (
        <div className="grid min-h-[40vh] place-items-center"><Spinner /></div>
      ) : state.locked ? (
        <UpgradeCard />
      ) : state.error ? (
        <div className="mt-6"><Alert>{state.error.status === 404 ? 'No board has been published yet. Check back before kickoff.' : state.error.message}</Alert></div>
      ) : (
        <>
          <section className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label="Results for this view">
            <Stat label="Record" value={stats.wins + stats.losses + stats.pushes ? `${stats.wins}–${stats.losses}${stats.pushes ? `–${stats.pushes}` : ''}` : '—'} sub={stats.pending ? `${stats.pending} pending` : 'All graded'} />
            <Stat label="Win rate" value={pct(stats.winRate)} tone={stats.winRate != null ? 'win' : null} />
            <Stat label="Units" value={stats.wins + stats.losses ? units(stats.units) : '—'} tone={stats.units > 0 ? 'win' : stats.units < 0 ? 'loss' : null} sub="1u flat stakes" />
            <Stat label="ROI" value={signedPct(stats.roi)} tone={stats.roi > 0 ? 'win' : stats.roi < 0 ? 'loss' : null} sub={`${rows.length} bets · avg edge ${signedPct(avgEdge)}`} />
          </section>

          <Filters {...{ market, setMarket, minEdge, setMinEdge, oddsMin, setOddsMin, oddsMax, setOddsMax, bestOnly, setBestOnly, hideSmall, setHideSmall }} />

          {rows.length === 0 ? (
            <div className="card mt-4 p-10 text-center text-sm text-muted">No bets match these filters. Try lowering the edge threshold or widening the odds window.</div>
          ) : (
            <>
              <BetTable rows={rows} sort={sort} onSort={toggleSort} />
              <BetCards rows={rows} />
            </>
          )}

          <p className="mt-4 text-xs leading-relaxed text-muted-dim">
            Hit rate blends 75% of the full 2025 season with 25% of 2026 to date (props: QB games with 15+ attempts).
            Implied = |odds| ÷ (|odds| + 100). <span className="text-warn">●</span> marks samples under {SMALL_SAMPLE} games — treat as noise.
            Lines on the same side of a game are correlated; use “Best line per side” to avoid stacking them.
          </p>
        </>
      )}
    </div>
  );
}

function WeekPicker({ weeks, active, onPick }) {
  if (!weeks?.boards?.length) return null;
  return (
    <nav aria-label="Weeks" className="-mx-4 mt-5 overflow-x-auto px-4 sm:mx-0 sm:px-0">
      <ul className="flex gap-2 pb-1">
        {weeks.boards.map((b) => {
          const on = active && Number(active.season) === b.season && Number(active.week) === b.week;
          return (
            <li key={b.id}>
              <button
                type="button" onClick={() => onPick(b)} aria-current={on ? 'page' : undefined}
                className={`flex items-center gap-1.5 whitespace-nowrap rounded-xl border px-3.5 py-2 text-sm font-semibold transition ${
                  on ? 'border-win bg-win/20 text-white' : 'border-ink-700 bg-ink-800 text-muted hover:text-slate-200'}`}
              >
                {b.locked && <LockIcon />}
                Wk {b.week}
                {b.record && b.record.wins + b.record.losses > 0 && (
                  <span className={`text-xs font-medium ${b.record.units >= 0 ? 'text-win-text' : 'text-loss-text'}`}>
                    {b.record.wins}–{b.record.losses}
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

function Stat({ label, value, sub, tone }) {
  const color = tone === 'win' ? 'text-win-text' : tone === 'loss' ? 'text-loss-text' : 'text-white';
  return (
    <div className="card p-4 sm:p-5">
      <div className="text-xs font-medium uppercase tracking-wide text-muted">{label}</div>
      <div className={`mt-1.5 text-2xl font-bold tabular-nums sm:text-3xl ${color}`}>{value}</div>
      {sub && <div className="mt-1 truncate text-xs text-muted-dim">{sub}</div>}
    </div>
  );
}

function Filters(p) {
  const presetActive = (x) => p.oddsMin === x.min && p.oddsMax === x.max;
  return (
    <section className="card mt-4 grid gap-5 p-4 sm:p-5 lg:grid-cols-[auto_1fr_auto] lg:items-end" aria-label="Filters">
      <div>
        <span className="label">Market</span>
        <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Market">
          {MARKET_TABS.map((t) => (
            <button key={t.id} type="button" role="radio" aria-checked={p.market === t.id}
              className={p.market === t.id ? 'chip-on' : 'chip-off'} onClick={() => p.setMarket(t.id)}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <label htmlFor="edge" className="label flex justify-between">
            <span>Min edge</span><span className="normal-case tracking-normal text-win-text">≥ {p.minEdge.toFixed(1)}%</span>
          </label>
          <input id="edge" type="range" min="0" max="20" step="0.5" value={p.minEdge}
            onChange={(e) => p.setMinEdge(Number(e.target.value))} className="w-full" />
        </div>
        <div>
          <span className="label">Odds window</span>
          <div className="flex items-center gap-2">
            <OddsInput label="Min odds (most negative)" value={p.oddsMin} onChange={p.setOddsMin} unbounded={-100000} />
            <span className="text-muted-dim">to</span>
            <OddsInput label="Max odds" value={p.oddsMax} onChange={p.setOddsMax} unbounded={100000} />
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {ODDS_PRESETS.map((x) => (
              <button key={x.label} type="button" className={presetActive(x) ? 'chip-on' : 'chip-off'}
                onClick={() => { p.setOddsMin(x.min); p.setOddsMax(x.max); }}>
                {x.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-3">
        <Toggle checked={p.bestOnly} onChange={p.setBestOnly} label="Best line per side" />
        <Toggle checked={p.hideSmall} onChange={p.setHideSmall} label={`Hide samples < ${SMALL_SAMPLE}`} />
      </div>
    </section>
  );
}

// Blank means unbounded on that side (±100000 sentinel).
function OddsInput({ label, value, onChange, unbounded }) {
  const show = (v) => (Math.abs(v) >= 100000 ? '' : String(v));
  const [text, setText] = useState(show(value));
  useEffect(() => setText(show(value)), [value]);
  return (
    <input
      aria-label={label} inputMode="numeric" className="input w-24 tabular-nums" value={text} placeholder="any"
      onChange={(e) => {
        const raw = e.target.value.replace(/−/g, '-');
        setText(raw);
        if (raw.trim() === '') return onChange(unbounded);
        const n = Number(raw.replace(/^\+/, ''));
        if (Number.isInteger(n) && Math.abs(n) >= 100) onChange(n);
      }}
    />
  );
}

function Toggle({ checked, onChange, label }) {
  return (
    <label className="flex cursor-pointer select-none items-center gap-3 text-sm text-slate-300">
      <button type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)}
        className={`relative h-6 w-11 flex-none rounded-full transition ${checked ? 'bg-win' : 'bg-ink-600'}`}>
        <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${checked ? 'left-[22px]' : 'left-0.5'}`} />
      </button>
      {label}
    </label>
  );
}

function SampleNote({ bet }) {
  const small = bet.sampleSize > 0 && bet.sampleSize < SMALL_SAMPLE;
  return (
    <span className={`text-xs ${small ? 'text-warn' : 'text-muted-dim'}`} title={small ? 'Small sample — potential noise' : undefined}>
      {small && '● '}n={bet.sampleSize || '—'}
    </span>
  );
}

const marketTag = { spread: 'SPR', total: 'TOT', prop: 'PROP' };

function BetTable({ rows, sort, onSort }) {
  return (
    <div className="card mt-4 hidden overflow-hidden md:block">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-ink-700 bg-ink-850 text-left text-xs uppercase tracking-wide text-muted">
            <tr>
              {COLUMNS.map((c) => {
                const active = sort.key === c.key && c.key;
                return (
                  <th key={c.label} scope="col"
                    aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}
                    className={`whitespace-nowrap px-4 py-3 font-medium ${c.numeric ? 'text-right' : ''}`}>
                    {c.key ? (
                      <button type="button" onClick={() => onSort(c.key)} className={`inline-flex items-center gap-1 uppercase hover:text-slate-200 ${active ? 'text-white' : ''}`}>
                        {c.label}{c.sub && <span className="normal-case text-muted-dim">{c.sub}</span>}
                        <span aria-hidden="true" className={active ? 'opacity-100' : 'opacity-0'}>{sort.dir === 'asc' ? '↑' : '↓'}</span>
                      </button>
                    ) : c.label}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody className="divide-y divide-ink-700/70">
            {rows.map((b) => (
              <tr key={b.id} className="transition hover:bg-ink-850/70">
                <td className="whitespace-nowrap px-4 py-3 text-muted">{b.game}</td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <span className="rounded bg-ink-700 px-1.5 py-0.5 text-[10px] font-bold text-muted">{marketTag[b.market]}</span>
                    <span className="whitespace-nowrap font-semibold text-white">{betLabel(b)}</span>
                  </div>
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-slate-300">{formatOdds(b.odds)}</td>
                <td className="px-4 py-3 text-right tabular-nums">
                  <div className="font-semibold text-white">{pct(b.blended)}</div>
                  <SampleNote bet={b} />
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-slate-300">{pct(b.implied)}</td>
                <td className="px-4 py-3 text-right font-bold tabular-nums text-win-text">{signedPct(b.edge)}</td>
                <td className="w-[200px] px-4 py-3"><HitBar hit={b.blended} implied={b.implied} /></td>
                <td className="px-4 py-3"><ResultBadge result={b.result} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function BetCards({ rows }) {
  return (
    <ul className="mt-4 space-y-3 md:hidden">
      {rows.map((b) => (
        <li key={b.id} className="card p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-xs text-muted">{b.game} · {b.market}</div>
              <div className="mt-0.5 truncate font-semibold text-white">{betLabel(b)} <span className="font-normal tabular-nums text-muted">{formatOdds(b.odds)}</span></div>
            </div>
            <ResultBadge result={b.result} />
          </div>
          <div className="mt-3"><HitBar hit={b.blended} implied={b.implied} /></div>
          <dl className="mt-3 grid grid-cols-3 gap-2 text-xs">
            <div><dt className="text-muted-dim">Hit rate</dt><dd className="font-semibold tabular-nums text-white">{pct(b.blended)} <SampleNote bet={b} /></dd></div>
            <div><dt className="text-muted-dim">Implied</dt><dd className="font-semibold tabular-nums text-slate-300">{pct(b.implied)}</dd></div>
            <div className="text-right"><dt className="text-muted-dim">Edge</dt><dd className="text-base font-bold tabular-nums text-win-text">{signedPct(b.edge)}</dd></div>
          </dl>
        </li>
      ))}
    </ul>
  );
}

function UpgradeCard() {
  return (
    <div className="card mx-auto mt-8 max-w-lg p-8 text-center">
      <div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-win/20 text-win-text"><LockIcon className="h-5 w-5" /></div>
      <h2 className="mt-4 text-xl font-bold text-white">Past weeks are Premium</h2>
      <p className="mt-2 text-sm text-muted">
        Unlock every historical board, the full week-by-week track record, and an email the moment a new board drops — $19.99/mo.
      </p>
      <div className="mt-6 flex flex-col justify-center gap-2 sm:flex-row">
        <Link to="/account" className="btn-primary">Upgrade to Premium</Link>
        <Link to="/board" className="btn-ghost">Back to this week</Link>
      </div>
    </div>
  );
}
