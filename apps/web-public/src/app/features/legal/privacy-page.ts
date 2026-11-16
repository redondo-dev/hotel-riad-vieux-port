import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { CatalogService } from '../../core/data/catalog.service';
import { Notice } from '../../shared/ui/notice';

/**
 * Privacy policy (step L-1, GDPR): the data a booking needs, why, how long, who receives it
 * (Stripe, Brevo), the cookies (none for tracking) and the rights of the guests. To be reviewed
 * by a lawyer for a real hotel.
 */
@Component({
  selector: 'rvp-privacy-page',
  imports: [Notice],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <article class="container-page max-w-3xl py-8 sm:py-12">
      <h1 class="font-display text-h1-m font-semibold sm:text-h1" i18n="@@privacy.title">
        Politique de confidentialité
      </h1>
      <div class="mt-6">
        <rvp-notice tone="info">
          <p i18n="@@privacy.fictional">
            Hôtel fictif : cette politique décrit un site de démonstration.
          </p>
        </rvp-notice>
      </div>

      <section class="mt-8 flex flex-col gap-3" aria-labelledby="privacy-controller">
        <h2 id="privacy-controller" class="section-title" i18n="@@privacy.controllerTitle">
          Responsable du traitement
        </h2>
        <p i18n="@@privacy.controller">
          Le responsable du traitement est l'Hôtel Riad Vieux-Port, établissement fictif. Pour toute
          question sur vos données ou pour exercer vos droits, écrivez à :
        </p>
        <p>
          <a class="text-port underline" [href]="'mailto:' + hotel.email">{{ hotel.email }}</a>
        </p>
      </section>

      <section class="mt-8 flex flex-col gap-3" aria-labelledby="privacy-data">
        <h2 id="privacy-data" class="section-title" i18n="@@privacy.dataTitle">
          Données collectées
        </h2>
        <p i18n="@@privacy.dataIntro">
          Lors d'une réservation, nous demandons seulement ce qui est utile au séjour :
        </p>
        <ul class="flex list-disc flex-col gap-2 pl-6">
          <li i18n="@@privacy.dataIdentity">
            vos nom et prénom, votre e-mail, votre téléphone et votre pays ;
          </li>
          <li i18n="@@privacy.dataStay">
            les dates, les chambres, le nombre de voyageurs et l'âge des enfants ;
          </li>
          <li i18n="@@privacy.dataMessage">
            votre langue et, si vous en écrivez un, votre message à l'hôtel.
          </li>
        </ul>
        <p i18n="@@privacy.dataCard">
          Votre carte bancaire est saisie sur la page sécurisée de Stripe : l'hôtel ne la reçoit pas
          et ne la conserve jamais.
        </p>
      </section>

      <section class="mt-8 flex flex-col gap-3" aria-labelledby="privacy-purposes">
        <h2 id="privacy-purposes" class="section-title" i18n="@@privacy.purposesTitle">
          Finalités et bases légales
        </h2>
        <ul class="flex list-disc flex-col gap-2 pl-6">
          <li i18n="@@privacy.purposeBooking">
            gérer votre réservation et votre séjour, et vous écrire à leur sujet : exécution du
            contrat ;
          </li>
          <li i18n="@@privacy.purposePayment">
            encaisser le paiement, les frais d'annulation ou de non-présentation : exécution du
            contrat ;
          </li>
          <li i18n="@@privacy.purposeLaw">
            tenir la comptabilité et répondre aux obligations légales de l'hôtel : obligation
            légale.
          </li>
        </ul>
        <p i18n="@@privacy.noMarketing">
          Vos données ne servent à aucune publicité et ne sont jamais vendues.
        </p>
      </section>

      <section class="mt-8 flex flex-col gap-3" aria-labelledby="privacy-retention">
        <h2 id="privacy-retention" class="section-title" i18n="@@privacy.retentionTitle">
          Durée de conservation
        </h2>
        <p i18n="@@privacy.retention">
          Les données d'une réservation sont conservées 3 ans après le séjour, puis archivées. Les
          pièces comptables, comme les factures, sont gardées 10 ans, comme la loi l'exige.
        </p>
      </section>

      <section class="mt-8 flex flex-col gap-3" aria-labelledby="privacy-recipients">
        <h2 id="privacy-recipients" class="section-title" i18n="@@privacy.recipientsTitle">
          Destinataires
        </h2>
        <ul class="flex list-disc flex-col gap-2 pl-6">
          <li i18n="@@privacy.recipientStaff">
            le personnel de l'hôtel, selon son rôle (réception, direction) ;
          </li>
          <li i18n="@@privacy.recipientStripe">
            Stripe, pour le paiement et la carte de garantie ;
          </li>
          <li i18n="@@privacy.recipientBrevo">
            Brevo, pour l'envoi des e-mails de confirmation et d'annulation.
          </li>
        </ul>
        <p i18n="@@privacy.transfers">
          Brevo traite les données dans l'Union européenne. Stripe peut les traiter aux États-Unis :
          ce transfert est encadré par les garanties prévues par le RGPD (clauses contractuelles
          types de la Commission européenne).
        </p>
      </section>

      <section class="mt-8 flex flex-col gap-3" aria-labelledby="privacy-cookies">
        <h2 id="privacy-cookies" class="section-title" i18n="@@privacy.cookiesTitle">
          Cookies et stockage
        </h2>
        <p i18n="@@privacy.cookies">
          Le site ne dépose aucun cookie de publicité ni de mesure d'audience. Pendant une
          réservation, vos coordonnées sont gardées dans l'onglet de votre navigateur pour ne pas
          avoir à les retaper ; elles s'effacent à sa fermeture. La page de paiement de Stripe
          utilise ses propres cookies, nécessaires à la sécurité du paiement.
        </p>
      </section>

      <section class="mt-8 flex flex-col gap-3" aria-labelledby="privacy-rights">
        <h2 id="privacy-rights" class="section-title" i18n="@@privacy.rightsTitle">Vos droits</h2>
        <p i18n="@@privacy.rights">
          Vous pouvez accéder à vos données, les faire corriger ou effacer, en limiter l'usage, vous
          y opposer et les recevoir dans un format courant. Écrivez à l'adresse ci-dessus : nous
          répondons sous un mois.
        </p>
        <p i18n="@@privacy.cnil">
          Si vous estimez que vos droits ne sont pas respectés, vous pouvez saisir la CNIL :
        </p>
        <p>
          <a class="text-port underline" href="https://www.cnil.fr" rel="noopener">www.cnil.fr</a>
        </p>
      </section>

      <section class="mt-8 flex flex-col gap-3" aria-labelledby="privacy-security">
        <h2 id="privacy-security" class="section-title" i18n="@@privacy.securityTitle">Sécurité</h2>
        <p i18n="@@privacy.security">
          Le site est servi en HTTPS. Le lien « Gérer ma réservation » envoyé par e-mail est secret
          et personnel : l'hôtel n'en garde qu'une empreinte, jamais le lien lui-même.
        </p>
      </section>
    </article>
  `,
})
export class PrivacyPage {
  private readonly catalog = inject(CatalogService);

  protected readonly hotel = this.catalog.hotel;
}
