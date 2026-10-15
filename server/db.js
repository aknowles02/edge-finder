import pg from 'pg';
import { config } from './config.js';

// numeric -> JS number (values are small odds/probabilities; no precision concerns)
pg.types.setTypeParser(1700, (v) => (v == null ? null : parseFloat(v)));

let pool;

// One pool per serverless instance; keep it small — use a pooled connection string (Neon/Supabase) in prod.
export function getPool() {
  if (!pool) {
    const connectionString = config.databaseUrl();
    const local = /localhost|127\.0\.0\.1/.test(connectionString);
    pool = new pg.Pool({
      connectionString,
      max: Number(process.env.PG_POOL_MAX || 5),
      idleTimeoutMillis: 10_000,
      ssl: local ? false : { rejectUnauthorized: false },
    });
  }
  return pool;
}

export const query = (text, params) => getPool().query(text, params);

export async function tx(fn) {
  const client = await getPool().connect();
  try {
    await client.query('begin');
    const out = await fn(client);
    await client.query('commit');
    return out;
  } catch (err) {
    await client.query('rollback');
    throw err;
  } finally {
    client.release();
  }
}
