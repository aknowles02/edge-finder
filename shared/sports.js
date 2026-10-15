// Sports the board can carry. `oddsKey` is The Odds API sport key; `teams` maps board abbreviations
// to the full names the odds feed uses. Add a sport here (and a tier in plans.js if it's sold separately).

const NFL_TEAMS = {
  ARI: 'Arizona Cardinals', ATL: 'Atlanta Falcons', BAL: 'Baltimore Ravens', BUF: 'Buffalo Bills',
  CAR: 'Carolina Panthers', CHI: 'Chicago Bears', CIN: 'Cincinnati Bengals', CLE: 'Cleveland Browns',
  DAL: 'Dallas Cowboys', DEN: 'Denver Broncos', DET: 'Detroit Lions', GB: 'Green Bay Packers',
  HOU: 'Houston Texans', IND: 'Indianapolis Colts', JAX: 'Jacksonville Jaguars', KC: 'Kansas City Chiefs',
  LV: 'Las Vegas Raiders', LAC: 'Los Angeles Chargers', LAR: 'Los Angeles Rams', MIA: 'Miami Dolphins',
  MIN: 'Minnesota Vikings', NE: 'New England Patriots', NO: 'New Orleans Saints', NYG: 'New York Giants',
  NYJ: 'New York Jets', PHI: 'Philadelphia Eagles', PIT: 'Pittsburgh Steelers', SF: 'San Francisco 49ers',
  SEA: 'Seattle Seahawks', TB: 'Tampa Bay Buccaneers', TEN: 'Tennessee Titans', WAS: 'Washington Commanders',
  // common alternates
  JAC: 'Jacksonville Jaguars', WSH: 'Washington Commanders', LA: 'Los Angeles Rams', OAK: 'Las Vegas Raiders',
  GNB: 'Green Bay Packers', KAN: 'Kansas City Chiefs', NWE: 'New England Patriots', NOR: 'New Orleans Saints',
  SFO: 'San Francisco 49ers', TAM: 'Tampa Bay Buccaneers', LVR: 'Las Vegas Raiders',
};

export const SPORTS = {
  nfl: {
    id: 'nfl',
    label: 'NFL',
    oddsKey: 'americanfootball_nfl',
    markets: { spread: 'alternate_spreads', total: 'alternate_totals' },
    teams: NFL_TEAMS,
  },
};

export const sportLabel = (id) => SPORTS[id]?.label ?? id.toUpperCase();

/** Resolve a board team code (or a full name) to the feed's full team name. */
export function teamName(sport, code) {
  const teams = SPORTS[sport]?.teams ?? {};
  const key = String(code).trim().toUpperCase();
  return teams[key] ?? String(code).trim();
}
