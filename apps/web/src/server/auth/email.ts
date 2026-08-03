import 'server-only';
import { createTransport } from 'nodemailer';

export interface VerificationEmailParams {
  identifier: string;
  url: string;
  from: string;
  host: string;
  smtp: {
    host: string;
    port: number;
    auth?: { user: string; pass: string };
  };
}

/**
 * Magic-link email.
 *
 * Written as a security notice rather than a marketing email: the recipient's decision
 * is "did I ask for this?", so the sending address, the expiry and the "ignore this if
 * it wasn't you" line matter more than branding. The plaintext part carries the same
 * URL because a meaningful share of accounting-firm mail clients strip HTML.
 */
export async function sendVerificationRequest(params: VerificationEmailParams): Promise<void> {
  const { identifier, url, from, host, smtp } = params;
  const transport = createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.port === 465,
    ...(smtp.auth ? { auth: smtp.auth } : {}),
  });

  const result = await transport.sendMail({
    to: identifier,
    from,
    subject: `Sign in to QUORUM`,
    text: [
      `Sign in to QUORUM`,
      ``,
      `Open this link to sign in as ${identifier}:`,
      url,
      ``,
      `This link works once and expires in 15 minutes.`,
      `If you did not request it, you can ignore this message — no one can sign in without it.`,
      ``,
      host,
    ].join('\n'),
    html: renderHtml({ identifier, url, host }),
  });

  // nodemailer reports rejected recipients as either a bare address or an address
  // object, so they are normalised before being read back to the caller.
  const failed = [...result.rejected, ...result.pending].map((recipient) =>
    typeof recipient === 'string' ? recipient : recipient.address,
  );
  if (failed.length > 0) {
    // Surfacing this as an error means the user sees "we could not send the email"
    // instead of a "check your inbox" page for a message that will never arrive.
    throw new Error(`Magic-link email could not be delivered to ${failed.join(', ')}`);
  }
}

function renderHtml({
  identifier,
  url,
  host,
}: {
  identifier: string;
  url: string;
  host: string;
}): string {
  const escaped = identifier.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `<!doctype html>
<html lang="en">
  <body style="margin:0;padding:32px;background:#0A0A0B;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Inter,sans-serif;color:#FAFAFA">
    <table role="presentation" cellpadding="0" cellspacing="0" style="max-width:520px;margin:0 auto">
      <tr><td style="padding-bottom:24px;font-size:14px;letter-spacing:0.08em;color:#5B8DEF">&#9670; QUORUM</td></tr>
      <tr><td style="font-size:20px;font-weight:600;padding-bottom:8px">Sign in to QUORUM</td></tr>
      <tr><td style="font-size:14px;line-height:22px;color:#A1A1AA;padding-bottom:24px">
        You asked to sign in as <strong style="color:#FAFAFA">${escaped}</strong>.
      </td></tr>
      <tr><td style="padding-bottom:24px">
        <a href="${url}" style="display:inline-block;background:#5B8DEF;color:#fff;text-decoration:none;font-size:14px;font-weight:500;padding:12px 20px;border-radius:6px">Sign in</a>
      </td></tr>
      <tr><td style="font-size:12px;line-height:20px;color:#6B6B75;border-top:1px solid rgba(255,255,255,0.08);padding-top:16px">
        This link works once and expires in 15 minutes.<br />
        If you did not request it you can ignore this message &mdash; no one can sign in without it.<br /><br />
        <span style="color:#52525B">${host}</span>
      </td></tr>
    </table>
  </body>
</html>`;
}
