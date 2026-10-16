import { PLANS } from '../shared/plans.js';
import { config } from './config.js';
import { query } from './db.js';
import { sendAdminAlert, sendBoardAlert } from './email.js';

/**
 * Email Pro members (alerts on) that a board is live. Claims the board first, so it sends at most once
 * even if the pipeline and an admin publish race.
 */
export async function alertBoardOnce(boardId) {
  const { rows: [board] } = await query(
    `update boards set alerted_at = now() where id = $1 and alerted_at is null and status = 'published' and kind = 'live' returning *`,
    [boardId],
  );
  if (!board) return 0;
  const { rows: recipients } = await query(
    `select email from users
      where alerts_opt_in and subscription_status in ('active', 'trialing', 'past_due')
        and coalesce(plan_id, 'pro') = any($1)
        and (current_period_end is null or current_period_end > now())`,
    [Object.values(PLANS).filter((p) => p.entitlements.includes('alerts')).map((p) => p.id)],
  );
  const { rows: [{ count }] } = await query('select count(*)::int as count from bets where board_id = $1 and qualified_at is not null', [boardId]);
  try {
    await sendBoardAlert(recipients.map((r) => r.email), { season: board.season, week: board.week, count, url: `${config.appUrl()}/board` });
  } catch (err) {
    await query('update boards set alerted_at = null where id = $1', [boardId]); // retry next run
    throw err;
  }
  return recipients.length;
}

/** Tell admins the automation is failing — at most once every 3 hours. */
export async function alertAdminsOfErrors(errors) {
  const admins = [...config.adminEmails()];
  if (!admins.length || !errors.length) return;
  const { rows } = await query(
    `insert into pipeline_state (key, at, info) values ('alert:errors', now(), $1)
     on conflict (key) do update set at = now(), info = excluded.info
       where pipeline_state.at < now() - interval '3 hours'
     returning key`,
    [JSON.stringify(errors)],
  );
  if (!rows[0]) return;
  await sendAdminAlert(admins, 'Edge Finder automation error', errors);
}
