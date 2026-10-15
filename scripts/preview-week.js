// Dry run of the automated board with live data, no database: node scripts/preview-week.js [week]
import { bestPerSide } from '../shared/edge.js';
import { fetchAllLadders } from '../server/kalshi.js';
import { currentWeek, loadGames } from '../server/nflverse.js';
import { scoreWeek } from '../server/pipeline.js';

const games = await loadGames();
const week = Number(process.argv[2]) || currentWeek(games, 2026);
const ladders = await fetchAllLadders();
const { gameRows, rows } = scoreWeek({ games, ladders, week });
const inWindow = rows.filter((r) => r.edge > 0 && r.odds >= -500 && r.odds <= -200)
  .map((r) => ({ ...r, game: r.label }));
const best = bestPerSide(inWindow).sort((a, b) => b.edge - a.edge);
console.log(`Week ${week}: ${ladders.length} Kalshi markets, ${gameRows.length} games matched, ${rows.length} rungs stored, ${inWindow.length} qualify, ${best.length} best-per-side`);
for (const g of gameRows) if (g.flags) console.log('  flag:', g.label, '—', g.flags);
for (const r of best.slice(0, 15)) {
  console.log(`  ${r.label.padEnd(10)} ${r.market.padEnd(6)} ${`${r.selection} ${r.line > 0 && r.market === 'spread' ? '+' : ''}${r.line}`.padEnd(14)} ${String(r.odds).padStart(5)}  hit ${(r.blended * 100).toFixed(1)}% (n=${r.sample})  implied ${(r.implied * 100).toFixed(1)}%  edge +${(r.edge * 100).toFixed(1)}%`);
}
