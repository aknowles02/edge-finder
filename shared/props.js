// Player prop markets: one definition per Kalshi series, with how to read the stat from an nflverse
// weekly row and what counts as a game where the player had a real role (the sample).
//
// Same rules as spreads/totals: 75% 2025 + 25% 2026-to-date, edge = hit rate − implied, −200…−500 window.
// Sample rule (generalizing the original "QBs with 15+ attempts, 6+ starts"): only games where the player
// had a real role count, and a player needs MIN_GAMES such games or the line is skipped.

const n = (v) => Number(v) || 0;
const qb = (s) => n(s.attempts) >= 15;
const rusher = (s) => n(s.carries) >= 1;
const receiver = (s) => n(s.targets) >= 1;
const skill = (s) => n(s.carries) + n(s.targets) >= 1;

export const MIN_GAMES = 6;

export const PROP_STATS = {
  pass_yds:   { series: 'KXNFLPASSYDS',  label: 'Pass Yds',     group: 'passing',   value: (s) => n(s.passing_yards), active: qb },
  pass_tds:   { series: 'KXNFLPASSTDS',  label: 'Pass TDs',     group: 'passing',   value: (s) => n(s.passing_tds), active: qb },
  pass_att:   { series: 'KXNFLPASSATT',  label: 'Pass Att',     group: 'passing',   value: (s) => n(s.attempts), active: qb },
  pass_comp:  { series: 'KXNFLPASSCOMP', label: 'Completions',  group: 'passing',   value: (s) => n(s.completions), active: qb },
  pass_int:   { series: 'KXNFLPASSINT',  label: 'INTs',         group: 'passing',   value: (s) => n(s.passing_interceptions), active: qb },
  rush_yds:   { series: 'KXNFLRSHYDS',   label: 'Rush Yds',     group: 'rushing',   value: (s) => n(s.rushing_yards), active: rusher },
  rush_att:   { series: 'KXNFLRSHATT',   label: 'Rush Att',     group: 'rushing',   value: (s) => n(s.carries), active: rusher },
  rec_yds:    { series: 'KXNFLRECYDS',   label: 'Rec Yds',      group: 'receiving', value: (s) => n(s.receiving_yards), active: receiver },
  receptions: { series: 'KXNFLREC',      label: 'Receptions',   group: 'receiving', value: (s) => n(s.receptions), active: receiver },
  rush_rec:   { series: 'KXNFLRRYDS',    label: 'Rush+Rec Yds', group: 'rushing',   value: (s) => n(s.rushing_yards) + n(s.receiving_yards), active: skill },
  any_td:     { series: 'KXNFLTD',       label: 'TDs',          group: 'td',        value: (s) => n(s.rushing_tds) + n(s.receiving_tds) + n(s.special_teams_tds), active: skill },
};

export const PROP_GROUPS = { passing: 'Passing', rushing: 'Rushing', receiving: 'Receiving', td: 'Touchdowns' };

/** "Patrick Mahomes II", "A.J. Brown", "D'Andre Swift" → stable comparison key. */
export function nameKey(name) {
  return String(name).toLowerCase()
    .replace(/[.'’`-]/g, '')
    .replace(/\b(jr|sr|ii|iii|iv|v)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Hit rate for "player's stat > line" (Over) or "< line" (Under) over one season's role games.
 * `rows`: that player's nflverse weekly rows for the season.
 */
export function playerHitRate(rows, statKey, line, side) {
  const def = PROP_STATS[statKey];
  const games = rows.filter(def.active);
  if (!games.length) return { rate: null, n: 0 };
  const hits = games.filter((s) => (side === 'Over' ? def.value(s) > line : def.value(s) < line)).length;
  return { rate: hits / games.length, n: games.length };
}

/** Grade a prop from the player's row for that game. Returns W/L/P, or null if the player has no row. */
export function gradeProp(row, statKey, line, side) {
  if (!row) return null;
  const v = PROP_STATS[statKey].value(row);
  if (v === line) return 'P';
  return (side === 'Over' ? v > line : v < line) ? 'W' : 'L';
}

/** "Tanner McKee Pass Yds Over" — the board's selection text (rungs on the same side share it). */
export const propSelection = (player, statKey, side) => `${player} ${PROP_STATS[statKey].label} ${side}`;

/**
 * Touchdown and interception props hinge on one or two plays, so they're shown on the board with a
 * volatility warning but excluded from every Edge Finder record, ROI and CLV statistic.
 */
export const VOLATILE_PROPS = ['any_td', 'pass_tds', 'pass_int'];
export const isVolatile = (b) => VOLATILE_PROPS.includes(b.propKey ?? b.prop_key);
