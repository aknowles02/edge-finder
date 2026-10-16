// Anonymous daily counters for the sign-up funnel. Nothing personal is stored: no IP, no user id, no cookie.
import { query } from './db.js';

const KINDS = new Set(['view', 'signup_start', 'signup', 'checkout', 'subscribe', 'cancel']);
const clean = (s, n) => String(s ?? '').slice(0, n).replace(/[^\w\-./:]/g, '');

export function track(kind, { path = '', ref = '' } = {}) {
  if (!KINDS.has(kind)) return Promise.resolve();
  return query(
    `insert into funnel_daily (kind, path, ref, count) values ($1, $2, $3, 1)
     on conflict (day, kind, path, ref) do update set count = funnel_daily.count + 1`,
    [kind, clean(path, 80), clean(ref, 60)],
  ).catch((err) => console.error('[funnel]', err.message));
}

export async function funnelReport(days = 14) {
  const { rows } = await query(
    `select kind, sum(count)::int as n from funnel_daily where day > current_date - $1::int group by kind`, [days]);
  const { rows: pages } = await query(
    `select path, sum(count)::int as n from funnel_daily where kind = 'view' and day > current_date - $1::int
      group by path order by n desc limit 10`, [days]);
  const { rows: refs } = await query(
    `select ref, sum(count)::int as n from funnel_daily where kind = 'view' and ref <> '' and day > current_date - $1::int
      group by ref order by n desc limit 10`, [days]);
  return { days, totals: Object.fromEntries(rows.map((r) => [r.kind, r.n])), pages, refs };
}
