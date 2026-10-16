import { useCallback, useEffect, useState } from 'react';
import { BOOKS, DEFAULT_BOOK, bookLabel } from '../../shared/books.js';
import { formatOdds } from '../../shared/edge.js';
import { api, pct, signedPct } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { Alert, ResultBadge, Spinner } from '../components/ui.jsx';

const label = (b) => `${b.selection}${b.line != null ? ` ${b.market === 'spread' && b.line > 0 ? '+' : ''}${b.line}` : ''}`;

export default function MyBets() {
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [adding, setAdding] = useState(false);
  const load = useCallback(() => api.get('/api/my-bets').then(setData).catch((e) => setError(e.message)), []);
  useEffect(() => { load(); }, [load]);

  async function setResult(b, result) {
    try { await api.patch(`/api/my-bets/${b.id}`, { result: result || null }); load(); } catch (e) { setError(e.message); }
  }
  async function remove(b) {
    if (!window.confirm(`Delete ${label(b)}?`)) return;
    try { await api.del(`/api/my-bets/${b.id}`); load(); } catch (e) { setError(e.message); }
  }

  if (!data && !error) return <div className="grid min-h-[50vh] place-items-center"><Spinner /></div>;
  const s = data?.summary;

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white sm:text-3xl">My bets</h1>
          <p className="mt-1 text-sm text-muted">Log what you actually bet. It grades itself and shows whether you beat the sharp closing price.</p>
        </div>
        <button type="button" className="btn-primary" onClick={() => setAdding((v) => !v)}>{adding ? 'Close' : 'Log a bet'}</button>
      </div>
      {error && <div className="mt-4"><Alert>{error}</Alert></div>}
      {adding && <AddBet defaultBook={user?.book || DEFAULT_BOOK} onDone={() => { setAdding(false); load(); }} />}

      {s && (
        <section className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-5" aria-label="Your results">
          {[
            ['Record', s.wins + s.losses + s.pushes ? `${s.wins}-${s.losses}${s.pushes ? `-${s.pushes}` : ''}` : '0-0', s.pending ? `${s.pending} pending` : null],
            ['Units', `${s.units >= 0 ? '+' : ''}${s.units.toFixed(2)}u`, 'at your stakes'],
            ['ROI', signedPct(s.roi), null],
            ['Beat the close', pct(s.beatClose, 0), s.clvCount ? `${s.clvCount} with closing data` : 'tracked board lines only'],
            ['Avg CLV', signedPct(s.avgClv), 'vs sharp closing price'],
          ].map(([k, v, sub]) => (
            <div key={k} className="card p-4">
              <div className="text-[11px] font-medium uppercase tracking-wide text-muted">{k}</div>
              <div className="mt-1 text-xl font-bold tabular-nums text-white">{v}</div>
              {sub && <div className="mt-0.5 text-xs text-muted-dim">{sub}</div>}
            </div>
          ))}
        </section>
      )}

      {data?.bets.length === 0 ? (
        <div className="card mt-5 p-10 text-center text-sm text-muted">No bets yet. Tap <b className="text-slate-200">Track</b> on any board line, or log one here.</div>
      ) : (
        <ul className="mt-5 space-y-2">
          {data?.bets.map((b) => (
            <li key={b.id} className="card flex flex-wrap items-center gap-3 p-4">
              <ResultBadge result={b.result} />
              <div className="min-w-0 flex-1">
                <div className="truncate font-semibold text-white">{label(b)} <span className="font-normal tabular-nums text-muted">{formatOdds(b.odds)}</span></div>
                <div className="text-xs text-muted">{b.game} · {bookLabel(b.book)} · {b.stake}u{b.clv != null && <> · CLV <span className={b.clv > 0 ? 'text-win-text' : 'text-loss-text'}>{signedPct(b.clv)}</span></>}</div>
              </div>
              {!b.betId && b.market === 'prop' && (
                <select aria-label="Result" className="input w-20 py-1" value={b.result ?? ''} onChange={(e) => setResult(b, e.target.value)}>
                  <option value="">-</option><option value="W">W</option><option value="L">L</option><option value="P">P</option>
                </select>
              )}
              <button type="button" className="text-xs text-muted hover:text-loss-text" onClick={() => remove(b)}>Delete</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function AddBet({ defaultBook, onDone }) {
  const [games, setGames] = useState([]);
  const [f, setF] = useState({ book: defaultBook, gameId: '', market: 'spread', selection: '', line: '', odds: '', stake: '1' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { api.get(`/api/boards/current?book=${defaultBook}`).then((d) => setGames(d.board.games)).catch(() => {}); }, [defaultBook]);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));

  async function submit(e) {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      await api.post('/api/my-bets', { ...f, gameId: f.gameId ? Number(f.gameId) : null, game: games.find((g) => String(g.id) === f.gameId)?.label, odds: Number(f.odds), stake: Number(f.stake) });
      onDone();
    } catch (err) { setError(err.message); }
    setBusy(false);
  }
  const game = games.find((g) => String(g.id) === f.gameId);
  return (
    <form onSubmit={submit} className="card mt-4 grid gap-3 p-5 sm:grid-cols-3">
      <label className="block"><span className="label">Sportsbook</span>
        <select className="input" value={f.book} onChange={set('book')}>{BOOKS.map((b) => <option key={b.key} value={b.key}>{b.label}</option>)}</select></label>
      <label className="block"><span className="label">Game</span>
        <select className="input" value={f.gameId} onChange={set('gameId')}><option value="">Other / not listed</option>{games.map((g) => <option key={g.id} value={g.id}>{g.label}</option>)}</select></label>
      <label className="block"><span className="label">Market</span>
        <select className="input" value={f.market} onChange={set('market')}><option value="spread">Spread</option><option value="total">Total</option><option value="prop">Player prop</option></select></label>
      <label className="block"><span className="label">{f.market === 'spread' ? 'Team' : f.market === 'total' ? 'Over / Under' : 'Bet'}</span>
        {f.market === 'spread' && game ? (
          <select className="input" value={f.selection} onChange={set('selection')} required><option value="">Pick a team</option><option>{game.away}</option><option>{game.home}</option></select>
        ) : f.market === 'total' ? (
          <select className="input" value={f.selection} onChange={set('selection')} required><option value="">Pick</option><option>Over</option><option>Under</option></select>
        ) : <input className="input" value={f.selection} onChange={set('selection')} placeholder={f.market === 'prop' ? 'Josh Allen Pass Yds Over' : 'Team code, e.g. BUF'} required />}
      </label>
      <label className="block"><span className="label">Line</span><input className="input" inputMode="decimal" value={f.line} onChange={set('line')} placeholder="e.g. +3.5" /></label>
      <label className="block"><span className="label">Odds</span><input className="input" inputMode="numeric" value={f.odds} onChange={set('odds')} placeholder="-150" required /></label>
      <label className="block"><span className="label">Stake (units)</span><input className="input" inputMode="decimal" value={f.stake} onChange={set('stake')} /></label>
      <div className="flex items-end sm:col-span-2">
        <button className="btn-primary" disabled={busy}>{busy ? <Spinner className="h-4 w-4" /> : 'Save bet'}</button>
        {error && <span className="ml-3 text-sm text-loss-text">{error}</span>}
      </div>
    </form>
  );
}
