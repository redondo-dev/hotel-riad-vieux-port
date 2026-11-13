import type { Sequelize } from 'sequelize';
import { type Mailer, MailRejectedError } from '../../../shared/infrastructure/mailer.ts';
import { cancellationEmail } from '../domain/cancellation-email.ts';
import {
  ConfirmationEmailRepository,
  MAX_EMAIL_ATTEMPTS,
} from '../infrastructure/confirmation-email-repository.ts';
import { EMAIL_BATCH_SIZE, type EmailReport } from './confirmation-emails.ts';
import type { PaymentLog } from './online-payments.ts';

/**
 * E-mail of cancellation of the bookings of the website (step M, decision « 4a »), run every
 * minute by the task of main.ts, like the e-mail of confirmation and with the same rules: sent
 * once, the booking locked meanwhile; a refusal of the e-mail itself is counted (given up
 * after 10), an outage of the service suspends the sending without counting anything.
 */
export class CancellationEmails {
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
    const ids = await this.#repository.unsentCancellations(this.#now(), EMAIL_BATCH_SIZE);
    for (const id of ids) {
      try {
        const sent = await this.#sequelize.transaction(async (transaction) => {
          const booking = await this.#repository.lockUnsentCancellation(id, transaction);
          if (booking === undefined) {
            return false;
          }
          await this.#mailer.send({ to: booking.to, ...cancellationEmail(booking.data) });
          await this.#repository.markCancellationSent(id, this.#now(), transaction);
          return true;
        });
        if (sent) {
          report.sent += 1;
        }
      } catch (error) {
        report.failed += 1;
        if (!(error instanceof MailRejectedError)) {
          this.#log.error(
            { err: error },
            'service d’envoi des e-mails indisponible ou mal configuré : envois suspendus ' +
              'jusqu’à la prochaine minute',
          );
          break;
        }
        const attempts = await this.#repository.countCancellationFailure(id);
        this.#log.error(
          { err: error, reservationId: id, attempts },
          attempts >= MAX_EMAIL_ATTEMPTS
            ? 'e-mail d’annulation abandonné après 10 essais : prévenir le client par téléphone'
            : 'e-mail d’annulation non envoyé, nouvel essai à la prochaine minute',
        );
      }
    }
    return report;
  }
}
