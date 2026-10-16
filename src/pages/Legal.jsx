import { Link } from 'react-router-dom';
import { PLANS, TRIAL_DAYS, priceLabel } from '../../shared/plans.js';

// Change this to a dedicated support address once you have a domain.
export const SUPPORT_EMAIL = 'aidan.knowles02@gmail.com';
const UPDATED = 'October 15, 2026';

function Doc({ title, children }) {
  return (
    <article className="mx-auto max-w-3xl px-4 py-10 sm:px-6 sm:py-14">
      <h1 className="text-3xl font-bold tracking-tight text-white">{title}</h1>
      <p className="mt-2 text-sm text-muted">Last updated {UPDATED}</p>
      <div className="legal mt-8 space-y-6 text-[15px] leading-relaxed text-slate-300">{children}</div>
    </article>
  );
}

const H = ({ children }) => <h2 className="pt-2 text-lg font-semibold text-white">{children}</h2>;
const Mail = () => <a className="text-win-text underline" href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>;

export function Terms() {
  const pro = PLANS.pro;
  return (
    <Doc title="Terms of Service">
      <p>These terms govern your use of Edge Finder (the "Service"). By creating an account or using the Service you agree to them. If you do not agree, do not use the Service.</p>

      <H>1. What Edge Finder is, and is not</H>
      <p>Edge Finder publishes statistical information about sports betting and prediction markets for informational and entertainment purposes. We are not a sportsbook, exchange, or broker. We do not accept, place, or facilitate wagers, and we never hold your money. Nothing on the Service is financial, investment, legal, or gambling advice, and no result is guaranteed. Estimated probabilities are based on past games and can be wrong. Any decision to bet is yours alone, and you are responsible for any losses.</p>

      <H>2. Eligibility and lawful use</H>
      <p>You must be at least 21 years old (or the legal gambling age where you live, if higher) to use the Service. You are responsible for complying with the laws that apply to you, including whether sports betting or prediction-market trading is legal where you are. Do not use the Service where it is prohibited.</p>

      <H>3. Your account</H>
      <p>You sign in with a one-time link sent to your email. Keep access to that email secure. Accounts are for one person and may not be shared, resold, or used by multiple people.</p>

      <H>4. Free trial, subscription, and cancellation</H>
      <p>New accounts receive a {TRIAL_DAYS}-day free trial that requires no payment method and ends automatically. {pro.name} costs {priceLabel(pro)}, billed in advance each month through our payment processor, Stripe, and <b>renews automatically every month until you cancel</b>. If you subscribe during your trial, your first charge happens when the trial ends.</p>
      <p>You can cancel anytime from <Link className="text-win-text underline" to="/account">your account page</Link> with one click. Cancellation stops future renewals; you keep access until the end of the period you already paid for. Except where required by law, payments are non-refundable and we do not provide partial-period refunds. We will give you advance notice of any price change, and the new price applies from your next billing period after the notice.</p>

      <H>5. Acceptable use and our content</H>
      <p>The boards, estimates, rankings, models, software, and design of the Service are our proprietary property and are licensed to you only for your personal, non-commercial use while your account is active. You may not copy, scrape, resell, redistribute, publish, or share Service content (including posting picks or boards publicly or in paid groups), and you may not reverse engineer, decompile, or attempt to derive our methods, models, or data, or use automated tools to access the Service. We may suspend or end accounts that break these rules.</p>

      <H>6. Third-party data</H>
      <p>Prices, game results, and player statistics come from third-party sources and may be delayed, incomplete, or inaccurate. Always confirm the current price with your sportsbook or exchange before acting. We are not affiliated with or endorsed by any sportsbook, exchange, league, or team.</p>

      <H>7. Disclaimers and limitation of liability</H>
      <p>The Service is provided "as is" and "as available" without warranties of any kind, express or implied, including accuracy, fitness for a particular purpose, and non-infringement. To the fullest extent permitted by law, Edge Finder and its operators are not liable for any indirect, incidental, special, consequential, or punitive damages, or for any gambling or trading losses, lost profits, or lost data, arising from your use of the Service. Our total liability for any claim is limited to the amount you paid us in the three months before the claim arose.</p>

      <H>8. Indemnity</H>
      <p>You agree to indemnify and hold harmless Edge Finder and its operators from claims arising out of your use of the Service, your wagers or trades, or your violation of these terms or any law.</p>

      <H>9. Changes and termination</H>
      <p>We may change the Service or these terms. If we make material changes we will update the date above and, where appropriate, notify you by email; continuing to use the Service after that means you accept the changes. You may stop using the Service and delete your account at any time.</p>

      <H>10. Responsible gambling</H>
      <p>Gambling involves risk. Only bet what you can afford to lose. If gambling is causing problems for you or someone you know, call or text 1-800-GAMBLER, or visit <a className="text-win-text underline" href="https://www.ncpgambling.org" target="_blank" rel="noreferrer">ncpgambling.org</a>.</p>

      <H>11. Contact</H>
      <p>Questions about these terms: <Mail />.</p>
    </Doc>
  );
}

export function Privacy() {
  return (
    <Doc title="Privacy Policy">
      <p>This policy explains what personal information Edge Finder collects, how we use it, and the choices you have. We keep it short because we collect very little.</p>

      <H>What we collect</H>
      <ul className="list-disc space-y-1.5 pl-5">
        <li><b>Your email address</b>, to create your account, send sign-in links, and (if you opt in) new-board alerts.</li>
        <li><b>Subscription details</b> such as your plan, status, and renewal date. Payments are processed by Stripe; we never see or store your full card number.</li>
        <li><b>Basic technical data</b> our hosting provider records automatically, such as IP address, browser type, and request logs, used for security and to keep the Service running.</li>
        <li><b>Your settings</b>, such as whether email alerts are on.</li>
      </ul>

      <H>How we use it</H>
      <p>To provide and secure the Service, process payments, send the emails you request or that are required (sign-in links, billing notices), prevent abuse, and comply with the law. We do not sell your personal information, share it for cross-context behavioral advertising, or use it to build advertising profiles.</p>

      <H>Who we share it with</H>
      <p>Only the service providers that run Edge Finder for us, under their own privacy and security terms: Vercel (hosting), Neon (database), Stripe (payments), and Resend (email delivery). We may also disclose information if required by law or to protect our rights and users.</p>

      <H>Cookies</H>
      <p>We use a single, strictly necessary cookie (<code className="text-slate-200">ef_session</code>) to keep you signed in for up to 30 days. It is HTTP-only, cannot be read by scripts, and is not used for tracking. We do not use analytics, advertising, or third-party tracking cookies, which is why there is no cookie consent banner. Stripe may set its own cookies on its checkout and billing pages to process payments and prevent fraud.</p>

      <H>Retention and deletion</H>
      <p>We keep your information while your account is active. You can delete your account at any time from the <Link className="text-win-text underline" to="/account">account page</Link>; this removes your account and email from our database and ends any subscription. Stripe retains payment records it is legally required to keep, and backups expire on a rolling basis.</p>

      <H>Your rights</H>
      <p>Depending on where you live (for example California, other US states with privacy laws, or the EU/UK), you may have the right to access, correct, delete, or receive a copy of your personal information, and to object to or restrict certain processing. You can exercise most of these yourself in your account, or by emailing <Mail />. We will not discriminate against you for exercising them.</p>

      <H>Security</H>
      <p>Sign-in links are single-use and expire in 15 minutes, sessions use secure HTTP-only cookies, and data is encrypted in transit. No system is perfectly secure, but we work to protect your information.</p>

      <H>Children</H>
      <p>The Service is only for adults of legal gambling age (21+). We do not knowingly collect information from anyone under 18 and will delete it if we learn we have.</p>

      <H>Changes and contact</H>
      <p>If we change this policy we will update the date above and notify you of material changes. Questions or requests: <Mail />.</p>
    </Doc>
  );
}
