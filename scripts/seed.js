// Demo data: two published weeks (one graded) so the UI has something to show locally.
// Usage: npm run seed   (refuses to run against a production DATABASE_URL unless FORCE_SEED=1)
import { gradeBet, parseBoardInput } from '../shared/edge.js';
import { getPool, tx } from '../server/db.js';
import { qualifyBets } from '../server/boards.js';

if (process.env.VERCEL_ENV === 'production' && !process.env.FORCE_SEED) {
  console.error('Refusing to seed production.');
  process.exit(1);
}

const header = 'game,market,selection,line,odds,hit_2025,n_2025,hit_2026,n_2026';
const weeks = {
  5: {
    scores: { 'BUF @ MIA': [27, 17], 'KC @ LV': [31, 20], 'PHI @ NYG': [24, 21], 'DET @ CHI': [20, 23], 'SF @ ARI': [26, 13] },
    props: { W: ['Josh Allen Pass Yds Over'], L: [] },
    csv: `${header}
BUF @ MIA,spread,BUF,+2.5,-310,0.86,17,0.67,3
BUF @ MIA,spread,BUF,-0.5,-220,0.79,17,0.67,3
BUF @ MIA,total,Over,37.5,-360,0.88,17,1.00,3
KC @ LV,spread,KC,+3.5,-400,0.91,17,1.00,3
KC @ LV,total,Under,55.5,-450,0.94,17,1.00,3
PHI @ NYG,spread,PHI,+4.5,-380,0.88,17,0.67,3
PHI @ NYG,total,Over,34.5,-330,0.84,17,0.67,3
DET @ CHI,spread,DET,+6.5,-420,0.88,17,1.00,3
DET @ CHI,total,Over,40.5,-250,0.76,17,0.67,3
SF @ ARI,spread,SF,+1.5,-240,0.82,17,0.67,3
SF @ ARI,total,Under,52.5,-410,0.94,17,1.00,3
BUF @ MIA,prop,Josh Allen Pass Yds Over,189.5,-280,0.82,11,1.00,3`,
  },
  6: {
    scores: {},
    props: { W: [], L: [] },
    csv: `${header}
GB @ MIN,spread,GB,+5.5,-360,0.88,17,0.67,3
GB @ MIN,spread,GB,+3.5,-280,0.82,17,0.67,3
GB @ MIN,total,Over,36.5,-390,0.94,17,0.67,3
BAL @ CIN,spread,BAL,+2.5,-260,0.82,17,1.00,3
BAL @ CIN,total,Over,40.5,-340,0.88,17,0.67,3
LAR @ SEA,spread,SEA,+6.5,-300,0.82,17,1.00,3
LAR @ SEA,total,Under,53.5,-420,0.94,17,1.00,3
DAL @ WAS,spread,WAS,+7.5,-480,0.94,17,1.00,3
DAL @ WAS,total,Over,38.5,-310,0.82,17,1.00,3
HOU @ JAX,spread,HOU,+3.5,-235,0.76,17,0.67,3
BAL @ CIN,prop,Lamar Jackson Pass Att Over,22.5,-300,0.83,12,0.67,3
GB @ MIN,prop,Jordan Love Pass Yds Over,179.5,-450,0.94,16,1.00,3`,
  },
};

await tx(async (db) => {
  for (const [week, spec] of Object.entries(weeks)) {
    const { rows, errors } = parseBoardInput(spec.csv);
    if (errors.length) throw new Error(JSON.stringify(errors));
    const { rows: [board] } = await db.query(
      `insert into boards (season, week, status, published_at) values (2026, $1, 'published', now())
       on conflict (sport, kind, season, week) do update set status = 'published' returning id`,
      [week],
    );
    await db.query(`update boards set status = 'draft' where id = $1`, [board.id]);
    await db.query('delete from games where board_id = $1', [board.id]); // fresh seed only: locked bets would refuse this
    const gameIds = new Map();
    for (const r of rows.filter((x) => x.edge > 0)) {
      if (!gameIds.has(r.game)) {
        const [a, h] = spec.scores[r.game] ?? [null, null];
        const { rows: [g] } = await db.query(
          'insert into games (board_id, label, away, home, away_score, home_score) values ($1,$2,$3,$4,$5,$6) returning id',
          [board.id, r.game, r.away, r.home, a, h],
        );
        gameIds.set(r.game, g.id);
      }
      const [a, h] = spec.scores[r.game] ?? [null, null];
      let result = gradeBet(r, { away: r.away, home: r.home, awayScore: a, homeScore: h });
      if (r.market === 'prop') result = spec.props.W.includes(r.selection) ? 'W' : spec.props.L.includes(r.selection) ? 'L' : null;
      await db.query(
        `insert into bets (board_id, game_id, market, selection, line, odds, hit_2025, n_2025, hit_2026, n_2026,
                           blended, implied, edge, sample_size, result, graded_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15, case when $15::char is null then null else now() end)`,
        [board.id, gameIds.get(r.game), r.market, r.selection, r.line, r.odds, r.hit2025, r.n2025, r.hit2026, r.n2026,
          r.blended, r.implied, r.edge, r.sampleSize, result],
      );
    }
    await db.query(`update boards set status = 'published' where id = $1`, [board.id]);
    await qualifyBets(db, board.id);
  }
});
await getPool().end();
console.log('Seeded 2026 weeks 5 (graded) and 6 (open).');
