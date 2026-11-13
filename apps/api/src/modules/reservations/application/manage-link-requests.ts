import type { Sequelize } from 'sequelize';
import type { Mailer } from '../../../shared/infrastructure/mailer.ts';
import { manageBookingUrl, newManageToken } from '../domain/manage-booking-rules.ts';
import { manageLinkEmail } from '../domain/manage-link-email.ts';
import { ManageBookingRepository } from '../infrastructure/manage-booking-repository.ts';
import type { SiteAddress } from './confirmation-emails.ts';
import type { PaymentLog } from './online-payments.ts';

/** At most one link e-mailed on request every 10 minutes per booking. */
export const LINK_REQUEST_INTERVAL_MS = 10 * 60_000;

export interface LinkRequest {
  reference: string;
  email: string;
}

/**
 * « Lien perdu » (step M, decision « 3a »): the customer gives his reference and his e-mail;
 * when they match a booking of the website, a new secret link is e-mailed to the address of
 * the booking, and the previous links stop working. The answer to the visitor never depends on
 * it (see the route): nothing tells whether a booking exists.
 */
export class ManageLinkRequests {
  readonly #sequelize: Sequelize;
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
    this.#links = new ManageBookingRepository(options.sequelize);
    this.#mailer = options.mailer;
    this.#site = options.site;
    this.#now = options.now;
    this.#log = options.log;
  }

  /**
   * « sent » or « ignored » (no such booking, wrong e-mail, asked less than 10 minutes ago,
   * or the e-mail refused: then nothing is kept, the previous link still works). Never throws.
   */
  async request(request: LinkRequest): Promise<'sent' | 'ignored'> {
    try {
      return await this.#sequelize.transaction(async (transaction) => {
        const now = this.#now();
        const found = await this.#links.forLinkRequest(
          request.reference,
          request.email,
          new Date(now.getTime() - LINK_REQUEST_INTERVAL_MS),
          transaction,
        );
        if (found === undefined) {
          return 'ignored';
        }
        const { token, hash } = newManageToken();
        await this.#links.issueToken(found.id, hash, transaction);
        await this.#links.markLinkSent(found.id, now, transaction);
        const email = manageLinkEmail({
          language: found.language,
          firstName: found.firstName,
          reference: found.reference,
          manageUrl: manageBookingUrl({
            siteUrl: this.#site.url,
            language: found.language,
            localePrefix: this.#site.localePrefix,
            reference: found.reference,
            token,
          }),
          hotel: { name: found.hotelName, address: found.hotelAddress, phone: found.hotelPhone },
        });
        // To the address of the booking, never to the one typed (they match, whatever the case).
        await this.#mailer.send({ to: found.email, ...email });
        return 'sent';
      });
    } catch (error) {
      // The reference only: never the address typed.
      this.#log.error(
        { err: error, reference: request.reference },
        'nouveau lien « Gérer ma réservation » non envoyé',
      );
      return 'ignored';
    }
  }
}
