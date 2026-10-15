import { config } from './config.js';

const RESEND = 'https://api.resend.com';

function layout(title, body) {
  return `<!doctype html><html><body style="margin:0;background:#0F1419;font-family:Inter,Segoe UI,Arial,sans-serif;color:#E6EBF0">
  <div style="max-width:520px;margin:0 auto;padding:40px 24px">
    <div style="font-weight:700;font-size:18px;letter-spacing:-0.01em;margin-bottom:28px">Edge<span style="color:#3FBF7F">Finder</span></div>
    <h1 style="font-size:22px;margin:0 0 16px">${title}</h1>
    ${body}
    <p style="color:#6B7885;font-size:12px;margin-top:40px">Edge Finder publishes data, not guarantees. Bet responsibly. 21+. Gambling problem? Call 1-800-GAMBLER.</p>
  </div></body></html>`;
}

const button = (href, label) =>
  `<a href="${href}" style="display:inline-block;background:#1E6B45;color:#fff;text-decoration:none;padding:12px 20px;border-radius:10px;font-weight:600">${label}</a>`;

async function resend(path, payload) {
  const key = config.resendKey();
  if (!key) {
    console.info('[email:dev] RESEND_API_KEY not set — would send:', JSON.stringify(payload, null, 2).slice(0, 2000));
    return;
  }
  const res = await fetch(`${RESEND}${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`Resend ${res.status}: ${await res.text()}`);
}

export async function sendMagicLink(email, url) {
  await resend('/emails', {
    from: config.emailFrom(),
    to: [email],
    subject: 'Your Edge Finder sign-in link',
    text: `Sign in to Edge Finder: ${url}\n\nThis link expires in 15 minutes. If you didn't request it, ignore this email.`,
    html: layout('Sign in to Edge Finder', `
      <p style="color:#9AA7B4;line-height:1.6">Click below to sign in. This link expires in 15 minutes and works once.</p>
      <p style="margin:28px 0">${button(url, 'Sign in')}</p>
      <p style="color:#6B7885;font-size:13px">If you didn't request this, you can ignore it.</p>`),
  });
}

/** One email per recipient (never expose the list), sent through Resend's batch endpoint 100 at a time. */
export async function sendBoardAlert(emails, { season, week, count, url }) {
  const subject = `Week ${week} board is live — ${count} edges`;
  const html = layout(`Week ${week} board is live`, `
    <p style="color:#9AA7B4;line-height:1.6">${count} alt lines cleared the edge bar for Week ${week} of the ${season} season.</p>
    <p style="margin:28px 0">${button(url, 'View the board')}</p>
    <p style="color:#6B7885;font-size:13px">You're getting this because alerts are on. Turn them off in your account settings.</p>`);
  for (let i = 0; i < emails.length; i += 100) {
    await resend('/emails/batch', emails.slice(i, i + 100).map((to) => ({
      from: config.emailFrom(), to: [to], subject, html,
      text: `Week ${week} board is live with ${count} edges: ${url}`,
    })));
  }
}
