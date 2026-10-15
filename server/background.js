// Page-view-driven freshness: no external scheduler required.
import { waitUntil } from '@vercel/functions';
import { runPipeline } from './pipeline.js';

let inflight = null;

/**
 * Kick the pipeline if it's due (the pipeline itself throttles to one run per 90s across all instances).
 * `waitMs`: how long the current request may wait for fresh prices before answering with what it has.
 */
export async function freshen({ waitMs = 0 } = {}) {
  if (!process.env.DATABASE_URL) return;
  inflight ??= runPipeline().catch((err) => console.error('[freshen]', err)).finally(() => { inflight = null; });
  const p = inflight;
  try { waitUntil(p); } catch { /* not on Vercel: the promise just runs */ }
  if (waitMs > 0) await Promise.race([p, new Promise((r) => setTimeout(r, waitMs))]);
}
