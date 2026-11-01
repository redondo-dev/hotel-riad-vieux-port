import { randomBytes } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Sending of e-mails, behind an interface so that the actual service can change without
 * touching the code that sends: today the local outbox (development), Brevo later (phase 6).
 */
export interface MailMessage {
  to: string;
  subject: string;
  /** Plain-text body. */
  text: string;
}

export interface Mailer {
  send(message: MailMessage): Promise<void>;
}

/**
 * DEVELOPMENT ONLY: writes each e-mail as a text file in `directory` (ignored by Git) instead of
 * sending it. Open the file to follow the link it contains. Refused in production by main.ts:
 * the messages contain secret links.
 */
export function outboxMailer(directory: string): Mailer {
  return {
    async send(message) {
      await mkdir(directory, { recursive: true });
      const stamp = new Date().toISOString().replaceAll(':', '-');
      const name = `${stamp}-${randomBytes(3).toString('hex')}.txt`;
      const content = `À : ${message.to}\nObjet : ${message.subject}\n\n${message.text}\n`;
      await writeFile(join(directory, name), content, { encoding: 'utf8', flag: 'wx' });
    },
  };
}
