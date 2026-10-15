import { useCallback, useEffect, useMemo, useState } from 'react';
import { betLabel, formatOdds, parseBoardInput } from '../../shared/edge.js';
import { api, signedPct } from '../lib/api.js';
import { Alert, ResultBadge, Spinner } from '../components/ui.jsx';

const TEMPLATE = `game,market,selection,line,odds,hit_2025,n_2025,hit_2026,n_2026
BUF @ MIA,spread,BUF,+2.5,-310,86%,17,67%,3
BUF @ MIA,total,Over,37.5,-360,88%,17,100%,3
BUF @ MIA,prop,Josh Allen Pass Yds Over,189.5,-280,82%,11,100%,3`;

export default function Admin() {
  const [boards, setBoards] = useState(null);
  const [odds, setOdds] = useState(null);
  const [openId, setOpenId] = useState(null);
  const load = useCallback(() => api.get('/api/admin/boards').then((d) => { setBoards(d.boards); setOdds(d.odds); }), []);
  useEffect(() => { load(); }, [load]);

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-8 sm:px-6">
      <h1 className="text-2xl font-bold text-white">Admin</h1>
      <OddsPanel odds={odds} onChange={setOdds} onLoad={load} />
      <ImportForm onDone={load} />
      <section className="card overflow-hidden">
        <h2 className="border-b border-ink-700 px-5 py-4 font-semibold text-white">Boards</h2>
        {!boards ? <div className="p-6"><Spinner /></div> : boards.length === 0 ? (
          <p className="p-6 text-sm text-muted">No boards yet — paste one above.</p>
        ) : (
          <ul className="divide-y divide-ink-700">
            {boards.map((b) => (
              <BoardRow key={b.id} board={b} open={openId === b.id} onToggle={() => setOpenId(openId === b.id ? null : b.id)} onChange={load} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function ImportForm({ onDone }) {
  const [season, setSeason] = useState(2026);
  const [week, setWeek] = useState('');
  const [oddsMin, setOddsMin] = useState(-500);
  const [oddsMax, setOddsMax] = useState(-200);
  const [mode, setMode] = useState('replace');
  const [kind, setKind] = useState('live');
  const [csv, setCsv] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  // Live preview with the same parser the server uses.
  const preview = useMemo(() => (csv.trim() ? parseBoardInput(csv) : null), [csv]);
  const positive = preview?.rows.filter((r) => r.edge > 0) ?? [];

  async function submit(e) {
    e.preventDefault();
    setBusy(true); setMsg(null);
    try {
      const r = await api.post('/api/admin/boards', { sport: 'nfl', kind, season: Number(season), week: Number(week), oddsMin: Number(oddsMin), oddsMax: Number(oddsMax), mode, csv });
      setMsg({ tone: 'success', text: `Saved as draft: ${r.inserted} positive-edge bets (${r.skippedNonPositive} dropped at ≤ 0 edge). Publish it below.` });
      setCsv('');
      onDone();
    } catch (err) {
      setMsg({ tone: 'error', text: err.message, errors: err.body?.errors });
    }
    setBusy(false);
  }

  return (
    <form onSubmit={submit} className="card space-y-4 p-5">
      <div>
        <h2 className="font-semibold text-white">Paste this week's alt lines</h2>
        <p className="mt-1 text-sm text-muted">CSV or tab-separated (paste straight from Sheets). Hit rates as 0.86 or 86%. Edge, blend and implied are computed for you.</p>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-6">
        <Field label="Type">
          <select className="input" value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="live">Live board</option>
            <option value="backtest">Backtest</option>
          </select>
        </Field>
        <Field label="Season"><input className="input" type="number" value={season} onChange={(e) => setSeason(e.target.value)} required /></Field>
        <Field label="Week"><input className="input" type="number" min="1" max="22" value={week} onChange={(e) => setWeek(e.target.value)} required /></Field>
        <Field label="Odds min"><input className="input" type="number" value={oddsMin} onChange={(e) => setOddsMin(e.target.value)} /></Field>
        <Field label="Odds max"><input className="input" type="number" value={oddsMax} onChange={(e) => setOddsMax(e.target.value)} /></Field>
        <Field label="Mode">
          <select className="input" value={mode} onChange={(e) => setMode(e.target.value)}>
            <option value="replace">Replace week</option>
            <option value="append">Append</option>
          </select>
        </Field>
      </div>
      <textarea className="input min-h-[180px] font-mono text-xs" placeholder={TEMPLATE} value={csv} onChange={(e) => setCsv(e.target.value)} spellCheck={false} required />
      {preview && (
        <div className="text-sm">
          <span className="text-win-text">{positive.length} positive edge</span>
          <span className="text-muted"> · {preview.rows.length - positive.length} at or below zero · </span>
          <span className={preview.errors.length ? 'text-loss-text' : 'text-muted'}>{preview.errors.length} errors</span>
          {preview.errors.length > 0 && (
            <ul className="mt-2 space-y-1 text-xs text-loss-text">
              {preview.errors.slice(0, 10).map((e) => <li key={e.line}>Line {e.line}: {e.message}</li>)}
            </ul>
          )}
        </div>
      )}
      {msg && (
        <Alert tone={msg.tone}>
          {msg.text}
          {msg.errors && <ul className="mt-2 text-xs">{msg.errors.slice(0, 10).map((e) => <li key={e.line}>Line {e.line}: {e.message}</li>)}</ul>}
        </Alert>
      )}
      <div className="flex flex-wrap gap-2">
        <button className="btn-primary" disabled={busy || !week || !csv.trim() || preview?.errors.length > 0}>
          {busy ? <Spinner className="h-4 w-4" /> : 'Save draft'}
        </button>
        <button type="button" className="btn-ghost" onClick={() => setCsv(TEMPLATE)}>Load example</button>
      </div>
    </form>
  );
}

function Field({ label, children }) {
  return <label className="block"><span className="label">{label}</span>{children}</label>;
}

function BoardRow({ board, open, onToggle, onChange }) {
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notify, setNotify] = useState(!board.alertedAt);

  async function act(name, fn) {
    setBusy(name); setError('');
    try { await fn(); await onChange(); } catch (err) { setError(err.message); }
    setBusy('');
  }

  return (
    <li className="px-5 py-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-[160px] flex-1">
          <div className="font-semibold text-white">
            {board.season} · Week {board.week}
            {board.kind === 'backtest' && <span className="ml-2 rounded bg-warn/20 px-1.5 py-0.5 text-[10px] font-bold uppercase text-warn">Backtest</span>}
          </div>
          <div className="text-xs text-muted">
            {board.betCount} on board · {board.trackedCount} tracked · {board.ungraded} ungraded · odds {formatOdds(board.oddsMin)} to {formatOdds(board.oddsMax)}
            {board.alertedAt && ' · alert sent'}
          </div>
        </div>
        <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${board.status === 'published' ? 'bg-win/20 text-win-text' : 'bg-ink-700 text-muted'}`}>{board.status}</span>
        {board.status === 'draft' ? (
          <>
            {!board.alertedAt && (
              <label className="flex items-center gap-2 text-xs text-muted">
                <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} /> Email Premium
              </label>
            )}
            <button className="btn-primary py-2" disabled={!!busy} onClick={() => act('pub', async () => {
              const r = await api.post(`/api/admin/boards/${board.id}/publish`, { notify });
              alert(`Published. ${r.qualified} bets locked as tracked opportunities.${notify && !board.alertedAt ? ` Alert sent to ${r.alerted} Pro members.` : ''}`);
            })}>{busy === 'pub' ? <Spinner className="h-4 w-4" /> : 'Publish'}</button>
          </>
        ) : (
          <button className="btn-ghost py-2" disabled={!!busy} onClick={() => act('unpub', () => api.post(`/api/admin/boards/${board.id}/unpublish`))}>Unpublish</button>
        )}
        <button className="btn-ghost py-2" onClick={onToggle} aria-expanded={open}>{open ? 'Close' : 'Results'}</button>
        <button className="btn-ghost py-2 text-loss-text" disabled={!!busy} onClick={() => {
          if (confirm(`Delete ${board.season} week ${board.week} and all its bets? This cannot be undone.`)) act('del', () => api.del(`/api/admin/boards/${board.id}`));
        }}>Delete</button>
      </div>
      {error && <div className="mt-3"><Alert>{error}</Alert></div>}
      {open && <ResultsEditor boardId={board.id} onChange={onChange} />}
    </li>
  );
}

function ResultsEditor({ boardId, onChange }) {
  const [board, setBoard] = useState(null);
  const [scores, setScores] = useState({});
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);

  const hydrate = useCallback((b) => {
    setBoard(b);
    setScores(Object.fromEntries(b.games.map((g) => [g.id, { awayScore: g.awayScore ?? '', homeScore: g.homeScore ?? '' }])));
  }, []);
  useEffect(() => { api.get(`/api/admin/boards/${boardId}`).then((d) => hydrate(d.board)); }, [boardId, hydrate]);

  if (!board) return <div className="mt-4"><Spinner /></div>;

  async function saveScores() {
    setBusy(true); setMsg(null);
    try {
      const games = Object.entries(scores).map(([id, s]) => ({ id: Number(id), ...s }));
      const r = await api.post(`/api/admin/boards/${boardId}/scores`, { games });
      hydrate(r.board);
      setMsg({ tone: 'success', text: `Graded ${r.graded} spread/total bets.` });
      onChange();
    } catch (err) { setMsg({ tone: 'error', text: err.message }); }
    setBusy(false);
  }

  async function setResult(bet, result) {
    await api.patch(`/api/admin/bets/${bet.id}`, { result: result || null });
    setBoard((b) => ({ ...b, bets: b.bets.map((x) => (x.id === bet.id ? { ...x, result: result || null } : x)) }));
    onChange();
  }

  const setScore = (id, side, v) => setScores((s) => ({ ...s, [id]: { ...s[id], [side]: v } }));

  return (
    <div className="mt-4 grid gap-6 rounded-xl border border-ink-700 bg-ink-850 p-4 lg:grid-cols-2">
      <div>
        <h3 className="text-sm font-semibold text-white">Final scores</h3>
        <p className="mb-3 text-xs text-muted">Spreads and totals grade automatically.</p>
        <ul className="space-y-2">
          {board.games.map((g) => (
            <li key={g.id} className="flex items-center gap-2 text-sm">
              <span className="w-12 text-right text-muted">{g.away}</span>
              <input aria-label={`${g.away} score`} className="input w-16 py-1.5 text-center" inputMode="numeric" value={scores[g.id]?.awayScore ?? ''} onChange={(e) => setScore(g.id, 'awayScore', e.target.value)} />
              <span className="text-muted-dim">@</span>
              <input aria-label={`${g.home} score`} className="input w-16 py-1.5 text-center" inputMode="numeric" value={scores[g.id]?.homeScore ?? ''} onChange={(e) => setScore(g.id, 'homeScore', e.target.value)} />
              <span className="w-12 text-muted">{g.home}</span>
            </li>
          ))}
        </ul>
        <button className="btn-primary mt-3 py-2" disabled={busy} onClick={saveScores}>{busy ? <Spinner className="h-4 w-4" /> : 'Save & grade'}</button>
        {msg && <div className="mt-3"><Alert tone={msg.tone}>{msg.text}</Alert></div>}
      </div>
      <div>
        <h3 className="text-sm font-semibold text-white">Bets</h3>
        <p className="mb-3 text-xs text-muted">Grade props by hand; override anything else.</p>
        <ul className="max-h-[420px] space-y-1.5 overflow-y-auto pr-1">
          {board.bets.map((b) => (
            <li key={b.id} className="flex items-center gap-2 text-sm">
              <ResultBadge result={b.result} />
              <span className="min-w-0 flex-1 truncate"><span className="text-muted">{b.game}</span> · <span className="text-white">{betLabel(b)}</span> <span className="text-muted">{formatOdds(b.odds)} · {signedPct(b.edge)}</span></span>
              <select aria-label="Result" className="input w-20 py-1" value={b.result ?? ''} onChange={(e) => setResult(b, e.target.value)}>
                <option value="">—</option><option value="W">W</option><option value="L">L</option><option value="P">P</option>
              </select>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function OddsPanel({ odds, onChange, onLoad }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  if (!odds) return null;
  async function refresh(build = false) {
    setBusy(true); setMsg(null);
    try {
      const r = await api.post('/api/admin/odds/refresh', { build });
      onChange(r.odds);
      const x = r.result ?? {};
      const parts = [];
      if (x.build) parts.push(x.build.note || x.build.skipped || `Week ${x.build.week}: ${x.build.games} games, ${x.build.bets} lines${x.build.published ? ', published' : ''}, ${x.build.qualified} newly tracked`);
      if (x.kalshi) parts.push(`Kalshi: ${x.kalshi.priced} lines priced, ${x.kalshi.moved} moved`);
      if (x.grade) parts.push(`Graded ${x.grade.graded}`);
      setMsg({ tone: x.errors?.length ? 'error' : 'success', text: [...parts, ...(x.errors ?? [])].join(' · ') || 'Nothing due.' });
      onLoad?.();
    } catch (err) { setMsg({ tone: 'error', text: err.message }); }
    setBusy(false);
  }
  return (
    <section className="card flex flex-wrap items-center justify-between gap-4 p-5">
      <div className="text-sm">
        <h2 className="font-semibold text-white">Automation</h2>
        <p className="mt-1 text-muted">Boards build hourly from Kalshi ladders × nflverse hit rates, prices refresh on every visit (≤ every 90s), and games grade from nflverse finals.</p>
        {odds.enabled ? (
          <p className="mt-1 text-muted">
            Last run {odds.lastRunAt ? new Date(odds.lastRunAt).toLocaleString() : 'never'} ({odds.lastRunStatus ?? '—'})
            {odds.creditsRemaining != null && ` · ${odds.creditsRemaining} API credits left`}
          </p>
        ) : null}
        {!odds.draftkingsEnabled && <p className="mt-1 text-xs text-muted-dim">DraftKings re-pricing is off (no ODDS_API_KEY); pasted DK lines keep their posted price.</p>}
        {odds.lastError && <p className="mt-1 text-loss-text">{odds.lastError}</p>}
        {msg && <p className={`mt-1 ${msg.tone === 'error' ? 'text-loss-text' : 'text-win-text'}`}>{msg.text}</p>}
      </div>
      <div className="flex gap-2">
        <button type="button" className="btn-ghost" disabled={busy} onClick={() => refresh(false)}>
          {busy ? <Spinner className="h-4 w-4" /> : 'Refresh prices'}
        </button>
        <button type="button" className="btn-primary" disabled={busy} onClick={() => refresh(true)}>Build this week now</button>
      </div>
    </section>
  );
}
