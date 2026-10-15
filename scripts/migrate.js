import { readFile } from 'node:fs/promises';
import { getPool } from '../server/db.js';

const sql = await readFile(new URL('../db/schema.sql', import.meta.url), 'utf8');
const pool = getPool();
await pool.query(sql);
await pool.end();
console.log('Schema is up to date.');
