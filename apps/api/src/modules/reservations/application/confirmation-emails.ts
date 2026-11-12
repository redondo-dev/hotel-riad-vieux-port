import type { Sequelize } from 'sequelize';
import type { Mailer } from '../../../shared/infrastructure/mailer.ts';
import { confirmationEmail } from '../domain/confirmation-email.ts';
import {
  ConfirmationEmailRepository,
  MAX_EMAIL_ATTEMPTS,
} from '../infrastructure/confirmation-email-repository.ts';
import type { PaymentLog } from './online-payments.ts';

/** E-mails sent in one run: the next run, a minute later, takes the following ones. */
export const EMAIL_BATCH_SIZE = 50;

export interface EmailReport {
  sent: number;
  /** Refused by the sending service, or unreadable: tried again next time. */
  failed: number;
}

/**
 * E-mail of confirmation of the bookings of the website (step R-6), run every minute by the
 * task of main.ts: whatever confirmed the booking (notification of Stripe, task of the end of
 * the hold, « ← Retour »), it is sent once. Each booking is locked while its e-mail is sent and
 * marked sent in the same transaction: an e-mail refused by Brevo is tried again next time,
 * never marked sent, and given up after 10 failures (address refused…). A stop of the API
 * between the sending and the commit, very rare, could send it twice: never zero times.
 */
export class ConfirmationEmails {
  readonly #sequelize: Sequelize;
  readonly #repository: ConfirmationEmailRepository;
  readonly #mailer: Mailer;
  readonly #now: () => Date;
  readonly #log: PaymentLog;

  constructor(options: { sequelize: Sequelize; mailer: Mailer; now: () => Date; log: PaymentLog }) {
    this.#sequelize = options.sequelize;
    this.#repository = new ConfirmationEmailRepository(options.sequelize);
    this.#mailer = options.mailer;
    this.#now = options.now;
    this.#log = options.log;
  }

  async run(): Promise<EmailReport> {
    const report: EmailReport = { sent: 0, failed: 0 };
    const ids = await this.#repository.unsent(this.#now(), EMAIL_BATCH_SIZE);
    for (const id of ids) {
      try {
        const sent = await this.#sequelize.transaction(async (transaction) => {
          const booking = await this.#repository.lockUnsent(id, transaction);
          if (booking === undefined) {
            return false;
          }
          const email = confirmationEmail(booking.data);
          await this.#mailer.send({ to: booking.to, ...email });
          await this.#repository.markSent(id, this.#now(), transaction);
          return true;
        });
        if (sent) {
          report.sent += 1;
        }
      } catch (error) {
        report.failed += 1;
        const attempts = await this.#repository.countFailure(id);
        // The reservation only: never the address nor the content of the e-mail.
        this.#log.error(
          { err: error, reservationId: id, attempts },
          attempts >= MAX_EMAIL_ATTEMPTS
            ? 'e-mail de confirmation abandonné après 10 essais : prévenir le client par téléphone'
            : 'e-mail de confirmation non envoyé, nouvel essai à la prochaine minute',
        );
      }
    }
    return report;
  }
}
