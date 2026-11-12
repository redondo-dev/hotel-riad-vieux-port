import { randomBytes } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Sending of e-mails, behind an interface so that the actual service can change without
 * touching the code that sends: the local outbox in development, Brevo otherwise (step R-6).
 */
export interface MailMessage {
  to: string;
  subject: string;
  /** Plain-text body. */
  text: string;
  /** HTML body, sent with the text one: the mail program of the reader chooses. */
  html?: string;
}

export interface Mailer {
  send(message: MailMessage): Promise<void>;
}

/**
 * This message itself is refused (address or content): sending it again will not help, its
 * failures are counted. Any other error (key refused, address of the server not allowed,
 * service out of order…) concerns every e-mail and is not counted against any of them.
 */
export class MailRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MailRejectedError';
  }
}

/**
 * DEVELOPMENT ONLY: writes each e-mail as a text file in `directory` (ignored by Git) instead of
 * sending it, and its HTML version next to it, to open in a browser. Refused in production by
 * main.ts: the messages contain secret links.
 */
export function outboxMailer(directory: string): Mailer {
  return {
    async send(message) {
      await mkdir(directory, { recursive: true });
      const stamp = new Date().toISOString().replaceAll(':', '-');
      const name = `${stamp}-${randomBytes(3).toString('hex')}`;
      const content = `À : ${message.to}\nObjet : ${message.subject}\n\n${message.text}\n`;
      await writeFile(join(directory, `${name}.txt`), content, { encoding: 'utf8', flag: 'wx' });
      if (message.html !== undefined) {
        await writeFile(join(directory, `${name}.html`), message.html, {
          encoding: 'utf8',
          flag: 'wx',
        });
      }
    },
  };
}

/** Transactional e-mails of Brevo (API v3). */
export const BREVO_SEND_URL = 'https://api.brevo.com/v3/smtp/email';

/** Brevo answers within a few hundred milliseconds; beyond, the sending is tried again later. */
const BREVO_TIMEOUT_MS = 10_000;

export interface BrevoOptions {
  apiKey: string;
  from: { email: string; name: string };
  /** Development only: every e-mail goes to this address, its real one written in the subject. */
  redirectTo?: string;
  /** The fetch of Node; a fake in the tests. */
  fetch?: typeof fetch;
}

/**
 * Sends through the API of Brevo. The key travels in the header « api-key » only, and is never
 * written to a log or an error message. Any answer other than 201 is an error: the caller tries
 * again later. 400 is the refusal of this message (MailRejectedError); 401 and 403 mean the key
 * or the address of the server is not allowed (Brevo → Sécurité → IP autorisées).
 */
export function brevoMailer(options: BrevoOptions): Mailer {
  const send = options.fetch ?? fetch;
  return {
    async send(message) {
      const to = options.redirectTo ?? message.to;
      const subject =
        options.redirectTo === undefined
          ? message.subject
          : `[pour ${message.to}] ${message.subject}`;
      const response = await send(BREVO_SEND_URL, {
        method: 'POST',
        headers: {
          'api-key': options.apiKey,
          'content-type': 'application/json',
          accept: 'application/json',
        },
        body: JSON.stringify({
          sender: options.from,
          to: [{ email: to }],
          subject,
          textContent: message.text,
          // Brevo requires an HTML body: the text one, escaped, when there is none.
          htmlContent: message.html ?? `<pre>${escapeHtml(message.text)}</pre>`,
        }),
        signal: AbortSignal.timeout(BREVO_TIMEOUT_MS),
      });
      if (response.status !== 201) {
        const code = await errorCodeOf(response);
        const reason = `Brevo a refusé l’e-mail (HTTP ${response.status}${code})`;
        throw response.status === 400 ? new MailRejectedError(reason) : new Error(reason);
      }
    },
  };
}

/** « invalid_parameter », … from the answer of Brevo, without anything else of it. */
async function errorCodeOf(response: Response): Promise<string> {
  try {
    const body: unknown = await response.json();
    if (typeof body === 'object' && body !== null && 'code' in body) {
      const { code } = body;
      return typeof code === 'string' && /^[a-z_]{1,40}$/.test(code) ? `, ${code}` : '';
    }
  } catch {
    // Not JSON: only the status is told.
  }
  return '';
}

export function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
