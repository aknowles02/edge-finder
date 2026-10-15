import { readFile } from 'node:fs/promises';

// Runs during every Vercel build (see vercel.json). Schema is idempotent, so re-running is safe.
if (!process.env.DATABASE_URL) {
  console.log('DATABASE_URL not set — skipping migration.');
  process.exit(0);
}

const { getPool } = await import('../server/db.js');
const sql = await readFile(new URL('../db/schema.sql', import.meta.url), 'utf8');
const pool = getPool();
await pool.query(sql);
await pool.end();
console.log('Schema is up to date.');
