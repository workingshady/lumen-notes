/**
 * Accounts: sending email (verification, magic link, password reset) behind one small interface.
 *
 * Provider: Resend (HTTPS API, works from Workers on the free plan) when `RESEND_API_KEY` + `MAIL_FROM` are set
 * (`wrangler secret put RESEND_API_KEY`; MAIL_FROM like "Lumen <hello@your-domain>" in wrangler vars).
 * Another provider (Cloudflare Email Service, MailChannels, SES …) = another `Mailer` in `pickMailer`.
 *
 * No provider configured:
 *  - local dev only (request to localhost / 127.0.0.1): the message is printed as "[auth] would send …" so the flow can
 *    be clicked through;
 *  - anywhere else: no mailer → the routes answer "Email isn't set up on this server" and NOTHING is logged.
 */

export interface Mail { to: string; subject: string; text: string; html: string }
export interface Mailer { name: string; send(m: Mail): Promise<void> }
export type MailEnv = { RESEND_API_KEY?: string; MAIL_FROM?: string; BLOG_NAME?: string };

const T = {
  verifySubject: "Confirm your email for Lumen",
  verifyBody: "Confirm your email to finish creating your Lumen account. The link works for 24 hours.",
  verifyButton: "Confirm email",
  magicSubject: "Your Lumen sign-in link",
  magicBody: "Use this link to sign in to Lumen. It works once, for 15 minutes.",
  magicButton: "Sign in to Lumen",
  resetSubject: "Reset your Lumen password",
  resetBody: "Someone asked to reset the password for this email. The link works once, for 30 minutes.",
  resetButton: "Choose a new password",
  ignore: "If you didn't ask for this, you can ignore this email.",
} as const;

export type MailKind = "verify" | "magic" | "reset";
const esc = (s: string) => s.replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" })[c]!);
export function composeMail(kind: MailKind, to: string, link: string): Mail {
  const [subject, body, button] = kind === "verify" ? [T.verifySubject, T.verifyBody, T.verifyButton]
    : kind === "magic" ? [T.magicSubject, T.magicBody, T.magicButton] : [T.resetSubject, T.resetBody, T.resetButton];
  return {
    to, subject,
    text: `${body}\n\n${link}\n\n${T.ignore}\n`,
    html: `<div style="font:15px/1.5 system-ui,sans-serif;color:#1f1f1f;max-width:480px"><p>${esc(body)}</p>` +
      `<p><a href="${esc(link)}" style="display:inline-block;background:#c8792a;color:#fff;padding:10px 18px;border-radius:10px;text-decoration:none;font-weight:600">${esc(button)}</a></p>` +
      `<p style="color:#6b6b6b;font-size:13px">${esc(T.ignore)}</p></div>`,
  };
}

function resend(key: string, from: string): Mailer {
  return {
    name: "resend",
    async send(m) {
      const r = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
        body: JSON.stringify({ from, to: [m.to], subject: m.subject, text: m.text, html: m.html }),
      });
      if (!r.ok) throw new Error(`mail provider answered ${r.status}`); // the body may echo addresses: not logged
    },
  };
}

/** Local dev = the request itself targets this machine. Production hostnames never qualify. */
export const isLocalRequest = (url: string) => {
  try { return ["localhost", "127.0.0.1", "[::1]", "::1"].includes(new URL(url).hostname); } catch { return false; }
};
const devLogger: Mailer = {
  name: "dev-log",
  async send(m) { console.log(`[auth] would send "${m.subject}" to ${m.to}\n${m.text}`); },
};

export function pickMailer(env: MailEnv, requestUrl: string): Mailer | null {
  if (env.RESEND_API_KEY && env.MAIL_FROM) return resend(env.RESEND_API_KEY, env.MAIL_FROM);
  return isLocalRequest(requestUrl) ? devLogger : null;
}
