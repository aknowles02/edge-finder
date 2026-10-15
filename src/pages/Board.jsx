import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  SMALL_SAMPLE, betLabel, bestPerSide, closingLineValue, fairOdds, formatOdds, summarizeTracked,
} from '../../shared/edge.js';
import { api, kickoff, pct, signedPct, timeAgo, units } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { Alert, LockIcon, ResultBadge, Spinner } from '../components/ui.jsx';

const MARKETS = [
  { id: 'all', label: 'All markets' },
  { id: 'spread', label: 'Spreads' },
  { id: 'total', label: 'Totals' },
  { id: 'prop', label: 'Props' },
];
const ODDS_PRESETS = [
  { label: '−200 to −500', min: -500, max: -200 },
  { label: '−200 to −1000', min: -1000, max: -200 },
  { label: 'Any', min: -100000, max: 100000 },
];
const MARKET_NAME = { spread: 'Alt spread', total: 'Alt total', prop: 'QB prop' };
const POLL_MS = 60_000;

const sorters = {
  edge: (b) => b.edge, odds: (b) => b.odds, prob: (b) => b.blended, matchup: (b) => b.game,
  updated: (b) => new Date(b.oddsUpdatedAt).getTime(),
};

export default function Board() {
  const { season, week } = useParams();
  const [params, setParams] = useSearchParams();
  const sport = params.get('sport') || 'nfl';
  const navigate = useNavigate();
  const { user } = useAuth();

  const [sports, setSports] = useState([{ id: 'nfl', label: 'NFL' }]);
  const [weeks, setWeeks] = useState(null);
  const [data, setData] = useState({ loading: true });
  const [, tick] = useState(0);

  const [market, setMarket] = useState('all');
  const [minEdge, setMinEdge] = useState(0);
  const [oddsMin, setOddsMin] = useState(-500);
  const [oddsMax, setOddsMax] = useState(-200);
  const [bestOnly, setBestOnly] = useState(false);
  const [hideSmall, setHideSmall] = useState(false);
  const [showMore, setShowMore] = useState(false);
  const [sort, setSort] = useState({ key: 'edge', dir: 'desc' });

  useEffect(() => { api.get('/api/sports').then((d) => setSports(d.sports)).catch(() => {}); }, []);
  useEffect(() => {
    api.get(`/api/boards?sport=${sport}`).then(setWeeks).catch(() => setWeeks({ boards: [] }));
  }, [sport, user?.plan]);

  const load = useCallback(async ({ quiet = false } = {}) => {
    if (!quiet) setData((d) => ({ ...d, loading: true, error: null, locked: false }));
    const path = season ? `/api/boards/${season}/${week}?sport=${sport}` : `/api/boards/current?sport=${sport}`;
    try {
      const { board, odds } = await api.get(path);
      setData((d) => {
        if (!quiet || !d.board || d.board.id !== board.id) {
          setOddsMin(board.oddsMin);
          setOddsMax(board.oddsMax);
        }
        return { loading: false, board, odds, fetchedAt: new Date().toISOString() };
      });
    } catch (err) {
      if (quiet) return; // keep showing the last good data; the freshness bar tells the story
      setData({ loading: false, error: err, locked: err.status === 402 });
    }
  }, [season, week, sport]);

  useEffect(() => { load(); }, [load]);

  // Live slate: poll for new prices; re-render every 30s so "x min ago" stays honest.
  const isCurrent = data.board?.isCurrent;
  useEffect(() => {
    if (!isCurrent) return;
    const poll = setInterval(() => { if (!document.hidden) load({ quiet: true }); }, POLL_MS);
    const clock = setInterval(() => tick((n) => n + 1), 30_000);
    return () => { clearInterval(poll); clearInterval(clock); };
  }, [isCurrent, load]);

  const { board } = data;
  const history = board && !board.isCurrent;

  const rows = useMemo(() => {
    if (!board) return [];
    let list = board.bets.filter((b) =>
      (market === 'all' || b.market === market) &&
      (history || b.edge * 100 >= minEdge) &&
      (history || (b.odds >= oddsMin && b.odds <= oddsMax)) &&
      (!hideSmall || b.sampleSize >= SMALL_SAMPLE));
    if (bestOnly) list = bestPerSide(list);
    const get = sorters[sort.key];
    const dir = sort.dir === 'asc' ? 1 : -1;
    return [...list].sort((a, b) => {
      const x = get(a), y = get(b);
      return (x < y ? -1 : x > y ? 1 : 0) * dir || b.edge - a.edge;
    });
  }, [board, history, market, minEdge, oddsMin, oddsMax, bestOnly, hideSmall, sort]);

  const setSport = (id) => {
    const next = new URLSearchParams(params);
    next.set('sport', id);
    if (season) navigate(`/board?${next}`); else setParams(next);
  };
  const toggleSort = (key) => setSort((s) => (s.key === key ? { key, dir: s.dir === 'desc' ? 'asc' : 'desc' } : { key, dir: key === 'matchup' ? 'asc' : 'desc' }));

  return (
    <div className="mx-auto max-w-7xl px-4 py-5 sm:px-6 sm:py-8">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-win-text">Edge Board · DraftKings alt lines</p>
          <h1 className="mt-1 text-2xl font-bold text-white sm:text-3xl">
            {board ? `${board.season} Week ${board.week}` : season ? `Week ${week}` : 'This week'}
            {history && <span className="ml-2 align-middle text-sm font-medium text-muted">archive</span>}
          </h1>
        </div>
        {board?.isCurrent && <Freshness board={board} odds={data.odds} fetchedAt={data.fetchedAt} />}
      </header>

      {/* Quick filters: sport + market are always one tap away. */}
      <div className="mt-5 flex flex-col gap-2">
        <ChipRow label="Sport" items={sports} value={sport} onChange={setSport} />
        <ChipRow label="Market" items={MARKETS} value={market} onChange={setMarket} />
      </div>

      <WeekPicker weeks={weeks} active={board ?? (season && { season, week })} sport={sport} />

      {data.loading ? (
        <div className="grid min-h-[40vh] place-items-center"><Spinner /></div>
      ) : data.locked ? (
        <LockedCard error={data.error} />
      ) : data.error ? (
        <div className="mt-6"><Alert>{data.error.status === 404 ? 'No board has been published for this sport yet. Check back before kickoff.' : data.error.message}</Alert></div>
      ) : (
        <>
          <StaleNotice board={board} odds={data.odds} />
          {history ? <HistoryStats rows={rows} /> : <SlateStats rows={rows} />}

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button type="button" className="btn-ghost py-2 text-xs" aria-expanded={showMore} onClick={() => setShowMore((v) => !v)}>
              {showMore ? 'Hide filters' : 'More filters'}
            </button>
            <Toggle checked={bestOnly} onChange={setBestOnly} label="Best line per side" />
            <Toggle checked={hideSmall} onChange={setHideSmall} label={`Hide samples < ${SMALL_SAMPLE}`} />
          </div>
          {showMore && !history && (
            <Filters {...{ minEdge, setMinEdge, oddsMin, setOddsMin, oddsMax, setOddsMax }} />
          )}

          {rows.length === 0 ? (
            <div className="card mt-4 p-10 text-center text-sm text-muted">
              {board.bets.length === 0 ? 'No lines currently clear the edge bar. Prices move — check back closer to kickoff.' : 'No bets match these filters.'}
            </div>
          ) : (
            <>
              <BetTable rows={rows} sort={sort} onSort={toggleSort} history={history} />
              <BetCards rows={rows} history={history} />
            </>
          )}

          <Methodology history={history} />
        </>
      )}
    </div>
  );
}

function ChipRow({ label, items, value, onChange }) {
  return (
    <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0" role="radiogroup" aria-label={label}>
      <div className="flex gap-1.5">
        {items.map((t) => (
          <button key={t.id} type="button" role="radio" aria-checked={value === t.id}
            className={`whitespace-nowrap ${value === t.id ? 'chip-on' : 'chip-off'}`} onClick={() => onChange(t.id)}>
            {t.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function Freshness({ board, odds, fetchedAt }) {
  const lastMove = board.bets.reduce((m, b) => (b.lineMovedAt && (!m || b.lineMovedAt > m) ? b.lineMovedAt : m), null);
  const live = odds?.enabled && board.bets.some((b) => b.liveTracked);
  return (
    <dl className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
      <div className="flex items-center gap-1.5">
        <span className={`h-2 w-2 rounded-full ${live ? 'bg-win-text' : 'bg-muted-dim'}`} aria-hidden="true" />
        <dt className="sr-only">Odds source</dt>
        <dd>{live ? 'Live odds' : 'Posted odds'}</dd>
      </div>
      <div><dt className="inline">Prices checked </dt><dd className="inline text-slate-300">{live ? timeAgo(odds.lastSuccessAt) : timeAgo(board.publishedAt)}</dd></div>
      <div><dt className="inline">Last line move </dt><dd className="inline text-slate-300">{lastMove ? timeAgo(lastMove) : '—'}</dd></div>
      {board.isCurrent && <div className="hidden sm:block"><dt className="inline">Page refreshed </dt><dd className="inline text-slate-300">{timeAgo(fetchedAt)}</dd></div>}
    </dl>
  );
}

function StaleNotice({ board, odds }) {
  if (!board.isCurrent) return null;
  const staleCount = board.bets.filter((b) => b.stale).length;
  const missing = board.bets.filter((b) => b.lineStatus === 'missing').length;
  const notes = [];
  if (!odds?.enabled) {
    notes.push(`Live odds aren't connected yet. Prices shown are as posted ${timeAgo(board.publishedAt)} — confirm the current price at DraftKings before betting.`);
  } else {
    if (odds.lastError) notes.push(`The last odds refresh failed (${timeAgo(odds.lastRunAt)}). Prices may be out of date.`);
    if (staleCount) notes.push(`${staleCount} line${staleCount > 1 ? 's haven’t' : ' hasn’t'} been re-checked on schedule — marked "stale" below.`);
    if (missing) notes.push(`${missing} line${missing > 1 ? 's are' : ' is'} no longer offered at DraftKings; the last seen price is shown.`);
  }
  if (!notes.length) return null;
  return (
    <div role="status" className="mt-4 rounded-xl border border-warn/40 bg-warn/10 px-4 py-3 text-sm text-warn">
      {notes.map((n) => <p key={n}>{n}</p>)}
    </div>
  );
}

function Stat({ label, value, sub, tone }) {
  const color = tone === 'win' ? 'text-win-text' : tone === 'loss' ? 'text-loss-text' : 'text-white';
  return (
    <div className="card p-4">
      <div className="text-[11px] font-medium uppercase tracking-wide text-muted">{label}</div>
      <div className={`mt-1 text-xl font-bold tabular-nums sm:text-2xl ${color}`}>{value}</div>
      {sub && <div className="mt-0.5 truncate text-xs text-muted-dim">{sub}</div>}
    </div>
  );
}

function SlateStats({ rows }) {
  const avg = rows.length ? rows.reduce((s, b) => s + b.edge, 0) / rows.length : null;
  const top = rows.reduce((m, b) => (!m || b.edge > m.edge ? b : m), null);
  const games = new Set(rows.map((b) => b.game)).size;
  return (
    <section className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label="Slate summary">
      <Stat label="Opportunities" value={rows.length} sub={`${games} game${games === 1 ? '' : 's'}`} />
      <Stat label="Average edge" value={signedPct(avg)} tone={avg > 0 ? 'win' : null} />
      <Stat label="Top edge" value={top ? signedPct(top.edge) : '—'} tone="win" sub={top ? betLabel(top) : null} />
      <Stat label="Small samples" value={rows.filter((b) => b.sampleSize > 0 && b.sampleSize < SMALL_SAMPLE).length} sub={`n < ${SMALL_SAMPLE} games`} />
    </section>
  );
}

function HistoryStats({ rows }) {
  const s = summarizeTracked(rows);
  const decided = s.wins + s.losses;
  return (
    <section className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label="Tracked results">
      <Stat label="Record" value={decided + s.pushes ? `${s.wins}–${s.losses}${s.pushes ? `–${s.pushes}` : ''}` : '—'} sub={s.pending ? `${s.pending} pending` : 'All graded'} />
      <Stat label="Units" value={decided ? units(s.units) : '—'} tone={s.units > 0 ? 'win' : s.units < 0 ? 'loss' : null} sub="1u at locked price" />
      <Stat label="ROI" value={signedPct(s.roi)} tone={s.roi > 0 ? 'win' : s.roi < 0 ? 'loss' : null} />
      <Stat label="Avg CLV" value={signedPct(s.avgClv)} tone={s.avgClv > 0 ? 'win' : s.avgClv < 0 ? 'loss' : null} sub={s.clvCount ? `beat close ${pct(s.beatClose, 0)}` : 'no closing prices'} />
    </section>
  );
}

function Filters(p) {
  const presetOn = (x) => p.oddsMin === x.min && p.oddsMax === x.max;
  return (
    <section className="card mt-3 grid gap-5 p-4 sm:grid-cols-2" aria-label="More filters">
      <div>
        <label htmlFor="edge" className="label flex justify-between">
          <span>Min edge</span><span className="normal-case tracking-normal text-win-text">≥ {p.minEdge.toFixed(1)}%</span>
        </label>
        <input id="edge" type="range" min="0" max="20" step="0.5" value={p.minEdge} onChange={(e) => p.setMinEdge(Number(e.target.value))} className="w-full" />
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
            <button key={x.label} type="button" className={presetOn(x) ? 'chip-on' : 'chip-off'} onClick={() => { p.setOddsMin(x.min); p.setOddsMax(x.max); }}>{x.label}</button>
          ))}
        </div>
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
    <input aria-label={label} inputMode="numeric" className="input w-24 tabular-nums" value={text} placeholder="any"
      onChange={(e) => {
        const raw = e.target.value.replace(/−/g, '-');
        setText(raw);
        if (raw.trim() === '') return onChange(unbounded);
        const n = Number(raw.replace(/^\+/, ''));
        if (Number.isInteger(n) && Math.abs(n) >= 100) onChange(n);
      }} />
  );
}

function Toggle({ checked, onChange, label }) {
  return (
    <button type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)}
      className="flex items-center gap-2 rounded-xl px-1 py-1 text-xs font-medium text-slate-300">
      <span className={`relative h-5 w-9 flex-none rounded-full transition ${checked ? 'bg-win' : 'bg-ink-600'}`}>
        <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${checked ? 'left-[18px]' : 'left-0.5'}`} />
      </span>
      {label}
    </button>
  );
}

function WeekPicker({ weeks, active, sport }) {
  if (!weeks?.boards?.length || weeks.boards.length < 2) return null;
  return (
    <nav aria-label="Weeks" className="-mx-4 mt-3 overflow-x-auto px-4 sm:mx-0 sm:px-0">
      <ul className="flex gap-2 pb-1">
        {weeks.boards.map((b, i) => {
          const on = active && Number(active.season) === b.season && Number(active.week) === b.week;
          const to = i === 0 ? `/board?sport=${sport}` : `/board/${b.season}/${b.week}?sport=${sport}`;
          return (
            <li key={b.id}>
              <Link to={to} aria-current={on ? 'page' : undefined}
                className={`flex items-center gap-1.5 whitespace-nowrap rounded-xl border px-3 py-1.5 text-xs font-semibold transition ${
                  on ? 'border-win bg-win/20 text-white' : 'border-ink-700 bg-ink-800 text-muted hover:text-slate-200'}`}>
                {b.locked && <LockIcon className="h-3 w-3" />}
                {i === 0 ? 'This week' : `Wk ${b.week}`}
                {i > 0 && b.record && b.record.wins + b.record.losses > 0 && (
                  <span className={b.record.units >= 0 ? 'text-win-text' : 'text-loss-text'}>{b.record.wins}–{b.record.losses}</span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

function SampleNote({ bet }) {
  const small = bet.sampleSize > 0 && bet.sampleSize < SMALL_SAMPLE;
  return (
    <span className={`text-[11px] ${small ? 'text-warn' : 'text-muted-dim'}`} title={small ? 'Small sample — potential noise' : `Based on ${bet.sampleSize} games`}>
      {small && '● '}n={bet.sampleSize || '—'}
    </span>
  );
}

function OddsCell({ bet, history }) {
  const shown = history ? bet.qualifiedOdds ?? bet.odds : bet.odds;
  const ref = bet.qualifiedOdds;
  const moved = !history && ref != null && ref !== bet.odds;
  return (
    <div className="tabular-nums">
      <div className="font-semibold text-slate-100">{formatOdds(shown)}</div>
      {moved && <div className="text-[11px] text-muted-dim">from {formatOdds(ref)}</div>}
      {history && bet.closingOdds != null && <div className="text-[11px] text-muted-dim">close {formatOdds(bet.closingOdds)}</div>}
    </div>
  );
}

function UpdatedCell({ bet }) {
  return (
    <div className="text-xs">
      <div className={bet.stale ? 'font-semibold text-warn' : 'text-slate-300'}>
        {bet.stale ? 'Stale · ' : ''}{timeAgo(bet.oddsUpdatedAt)}
      </div>
      <div className="text-[11px] text-muted-dim">
        {bet.lineStatus === 'missing' ? 'Line pulled' : bet.lineMovedAt ? `moved ${timeAgo(bet.lineMovedAt)}` : bet.liveTracked ? 'no move' : 'posted'}
      </div>
    </div>
  );
}

function Th({ children, k, sort, onSort, right }) {
  const active = k && sort.key === k;
  return (
    <th scope="col" aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}
      className={`whitespace-nowrap px-3 py-3 font-medium ${right ? 'text-right' : ''}`}>
      {k ? (
        <button type="button" onClick={() => onSort(k)} className={`inline-flex items-center gap-1 uppercase hover:text-slate-200 ${active ? 'text-white' : ''}`}>
          {children}<span aria-hidden="true" className={active ? '' : 'opacity-0'}>{sort.dir === 'asc' ? '↑' : '↓'}</span>
        </button>
      ) : children}
    </th>
  );
}

function BetTable({ rows, sort, onSort, history }) {
  return (
    <div className="card mt-4 hidden overflow-hidden md:block">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-ink-700 bg-ink-850 text-left text-[11px] uppercase tracking-wide text-muted">
            <tr>
              <Th>#</Th>
              <Th k="matchup" sort={sort} onSort={onSort}>Matchup</Th>
              <Th>Market · Bet</Th>
              <Th k="odds" sort={sort} onSort={onSort} right>{history ? 'Locked odds' : 'Odds'}</Th>
              <Th k="prob" sort={sort} onSort={onSort} right>Est. prob</Th>
              <Th right>Fair odds</Th>
              <Th k="edge" sort={sort} onSort={onSort} right>Edge</Th>
              {history ? <Th right>CLV</Th> : <Th k="updated" sort={sort} onSort={onSort}>Updated</Th>}
              {history && <Th>Result</Th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-ink-700/70">
            {rows.map((b, i) => {
              const edge = history ? b.qualifiedEdge ?? b.edge : b.edge;
              const clv = closingLineValue(b.qualifiedOdds, b.closingOdds);
              return (
                <tr key={b.id} className="transition hover:bg-ink-850/70">
                  <td className="px-3 py-3 text-xs tabular-nums text-muted-dim">{i + 1}</td>
                  <td className="whitespace-nowrap px-3 py-3">
                    <div className="text-slate-200">{b.game}</div>
                    {b.commenceTime && <div className="text-[11px] text-muted-dim">{b.started ? 'Started' : kickoff(b.commenceTime)}</div>}
                  </td>
                  <td className="px-3 py-3">
                    <div className="text-[11px] text-muted">{MARKET_NAME[b.market]}</div>
                    <div className="whitespace-nowrap font-semibold text-white">{betLabel(b)}</div>
                  </td>
                  <td className="px-3 py-3 text-right"><OddsCell bet={b} history={history} /></td>
                  <td className="px-3 py-3 text-right tabular-nums">
                    <div className="font-semibold text-white">{pct(b.blended)}</div>
                    <SampleNote bet={b} />
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums text-slate-300">{formatOdds(fairOdds(b.blended))}</td>
                  <td className="px-3 py-3 text-right text-base font-bold tabular-nums text-win-text">{signedPct(edge)}</td>
                  {history ? (
                    <td className={`px-3 py-3 text-right tabular-nums ${clv > 0 ? 'text-win-text' : clv < 0 ? 'text-loss-text' : 'text-muted'}`}>{signedPct(clv)}</td>
                  ) : (
                    <td className="px-3 py-3"><UpdatedCell bet={b} /></td>
                  )}
                  {history && <td className="px-3 py-3"><ResultBadge result={b.result} /></td>}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function BetCards({ rows, history }) {
  return (
    <ol className="mt-4 space-y-3 md:hidden">
      {rows.map((b, i) => {
        const edge = history ? b.qualifiedEdge ?? b.edge : b.edge;
        return (
          <li key={b.id} className={`card p-4 ${b.stale ? 'border-warn/40' : ''}`}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-[11px] text-muted">#{i + 1} · {b.game}{b.commenceTime && !b.started ? ` · ${kickoff(b.commenceTime)}` : ''}</div>
                <div className="mt-0.5 font-semibold text-white">{betLabel(b)}</div>
                <div className="text-[11px] text-muted-dim">{MARKET_NAME[b.market]}</div>
              </div>
              <div className="text-right">
                <div className="text-lg font-bold tabular-nums text-win-text">{signedPct(edge)}</div>
                <div className="text-[11px] text-muted">edge</div>
              </div>
            </div>
            <dl className="mt-3 grid grid-cols-3 gap-2 text-xs">
              <div><dt className="text-muted-dim">{history ? 'Locked' : 'Odds'}</dt><dd><OddsCell bet={b} history={history} /></dd></div>
              <div><dt className="text-muted-dim">Est. prob</dt><dd className="font-semibold tabular-nums text-white">{pct(b.blended)} <SampleNote bet={b} /></dd></div>
              <div><dt className="text-muted-dim">Fair odds</dt><dd className="font-semibold tabular-nums text-slate-300">{formatOdds(fairOdds(b.blended))}</dd></div>
            </dl>
            <div className="mt-3 flex items-center justify-between border-t border-ink-700 pt-2">
              {history ? (
                <>
                  <span className="text-xs text-muted">CLV {signedPct(closingLineValue(b.qualifiedOdds, b.closingOdds))}</span>
                  <ResultBadge result={b.result} />
                </>
              ) : <UpdatedCell bet={b} />}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function Methodology({ history }) {
  return (
    <details className="mt-5 text-xs leading-relaxed text-muted-dim">
      <summary className="cursor-pointer font-medium text-muted">How these numbers are calculated</summary>
      <div className="mt-2 space-y-1.5">
        <p><b className="text-muted">Est. prob</b> is a historical hit rate: 75% from the full 2025 season, 25% from 2026 to date (props: QB games with 15+ attempts). It is an estimate, not a guarantee. <span className="text-warn">●</span> flags samples under {SMALL_SAMPLE} games.</p>
        <p><b className="text-muted">Fair odds</b> converts that probability to American odds. <b className="text-muted">Edge</b> = est. prob − the price's implied probability (|odds| ÷ (|odds| + 100)).</p>
        <p>Lines on the same side of a game are correlated; “Best line per side” keeps just one.</p>
        {history && <p><b className="text-muted">Locked odds</b> is the price when the bet first qualified; results and ROI are graded at that price. <b className="text-muted">CLV</b> is the closing implied probability minus the locked implied probability — positive means the market moved your way.</p>}
      </div>
    </details>
  );
}

function LockedCard({ error }) {
  const ended = error?.body?.plan === 'none';
  return (
    <div className="card mx-auto mt-8 max-w-lg p-8 text-center">
      <div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-win/20 text-win-text"><LockIcon className="h-5 w-5" /></div>
      <h2 className="mt-4 text-xl font-bold text-white">{ended ? 'Your free trial has ended' : 'Past boards are part of Pro'}</h2>
      <p className="mt-2 text-sm text-muted">{error?.message}</p>
      <div className="mt-6 flex flex-col justify-center gap-2 sm:flex-row">
        <Link to="/subscribe" className="btn-primary">See Edge Finder Pro</Link>
        {!ended && <Link to="/board" className="btn-ghost">Back to this week</Link>}
      </div>
    </div>
  );
}
