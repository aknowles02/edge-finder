// Sportsbooks a customer can pick as "my book". Keys are The Odds API bookmaker keys.
export const BOOKS = [
  { key: 'draftkings', label: 'DraftKings' },
  { key: 'fanduel', label: 'FanDuel' },
  { key: 'betmgm', label: 'BetMGM' },
  { key: 'williamhill_us', label: 'Caesars' },
  { key: 'espnbet', label: 'ESPN BET' },
  { key: 'fanatics', label: 'Fanatics' },
  { key: 'betrivers', label: 'BetRivers' },
  { key: 'hardrockbet', label: 'Hard Rock Bet' },
];
export const DEFAULT_BOOK = 'draftkings';
// Kalshi is the fair-price reference, not a selectable book: its edges against its own ladder didn't
// survive backtesting (2025-26), so we don't show them.
export const bookLabel = (key) => (key === 'kalshi' ? 'Kalshi' : BOOKS.find((b) => b.key === key)?.label ?? key);
export const isBook = (key) => BOOKS.some((b) => b.key === key);

/** A line qualifies as a tracked opportunity when its edge clears this bar (inside the board's odds window). */
export const MIN_QUALIFY_EDGE = 0.01;
