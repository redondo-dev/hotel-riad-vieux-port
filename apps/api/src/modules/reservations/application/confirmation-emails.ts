import type { Sequelize } from 'sequelize';
import { type Mailer, MailRejectedError } from '../../../shared/infrastructure/mailer.ts';
import { confirmationEmail } from '../domain/confirmation-email.ts';
import { manageBookingUrl, newManageToken } from '../domain/manage-booking-rules.ts';
import {
  ConfirmationEmailRepository,
  MAX_EMAIL_ATTEMPTS,
} from '../infrastructure/confirmation-email-repository.ts';
import { ManageBookingRepository } from '../infrastructure/manage-booking-repository.ts';
import type { PaymentLog } from './online-payments.ts';

/** E-mails sent in one run: the next run, a minute later, takes the following ones. */
export const EMAIL_BATCH_SIZE = 50;

/** The public site, for the link « Gérer ma réservation » (step M). */
export interface SiteAddress {
  url: string;
  /** The built site serves /fr/… and /en/…; the development server only French at the root. */
  localePrefix: boolean;
}

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
 * never marked sent, and given up after 10 refusals of the e-mail itself (address refused…);
 * when the service itself fails (key refused, outage), the run stops without counting. A stop
 * of the API between the sending and the commit, very rare, could send it twice: never zero
 * times.
 */
export class ConfirmationEmails {
  readonly #sequelize: Sequelize;
  readonly #repository: ConfirmationEmailRepository;
  readonly #links: ManageBookingRepository;
  readonly #mailer: Mailer;
  readonly #site: SiteAddress;
  readonly #now: () => Date;
  readonly #log: PaymentLog;

  constructor(options: {
    sequelize: Sequelize;
    mailer: Mailer;
    site: SiteAddress;
    now: () => Date;
    log: PaymentLog;
  }) {
    this.#sequelize = options.sequelize;
    this.#repository = new ConfirmationEmailRepository(options.sequelize);
    this.#links = new ManageBookingRepository(options.sequelize);
    this.#mailer = options.mailer;
    this.#site = options.site;
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
          // A new secret link, stored as its hash only; refused by Brevo, nothing is kept.
          const { token, hash } = newManageToken();
          await this.#links.issueToken(id, hash, transaction);
          const manageUrl = manageBookingUrl({
            siteUrl: this.#site.url,
            language: booking.data.language,
            localePrefix: this.#site.localePrefix,
            reference: booking.data.reference,
            token,
          });
          const email = confirmationEmail({ ...booking.data, manageUrl });
          await this.#mailer.send({ to: booking.to, ...email });
          await this.#repository.markSent(id, this.#now(), transaction);
          return true;
        });
        if (sent) {
          report.sent += 1;
        }
      } catch (error) {
        report.failed += 1;
        if (!(error instanceof MailRejectedError)) {
          // Key refused, server not allowed, service out of order: every e-mail would fail the
          // same way. Nothing is counted against the customers, and the run stops here.
          this.#log.error(
            { err: error },
            'service d’envoi des e-mails indisponible ou mal configuré : envois suspendus ' +
              'jusqu’à la prochaine minute',
          );
          break;
        }
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
