import {
  buttonHtml,
  type ConfirmationEmail,
  layoutHtml,
  paragraphHtml,
  phoneOf,
  smallHtml,
} from './confirmation-email.ts';

/**
 * E-mail « Votre lien pour gérer la réservation » (step M, decision « 3a »): sent when the
 * customer asks for a new link with his reference and his e-mail. It replaces the previous
 * links. In French or in English, as plain text and as HTML.
 */
export interface ManageLinkEmailData {
  language: 'fr' | 'en';
  firstName: string;
  reference: string;
  manageUrl: string;
  hotel: { name: string; address: string; phone: string };
}

const WORDS = {
  fr: {
    subject: 'Votre lien pour gérer la réservation {reference}',
    hello: 'Bonjour {name},',
    intro:
      'Voici un nouveau lien pour consulter ou annuler votre réservation {reference}. Il ' +
      'remplace les liens envoyés auparavant.',
    button: 'Gérer ma réservation',
    keepLink: 'Ne le transférez pas : il donne accès à votre réservation.',
    notYou:
      'Si vous n’avez rien demandé, ignorez cet e-mail : votre réservation n’est pas modifiée. ' +
      'Pour toute question, appelez la réception au {phone}.',
    bye: 'À bientôt,',
  },
  en: {
    subject: 'Your link to manage the booking {reference}',
    hello: 'Hello {name},',
    intro:
      'Here is a new link to view or cancel your booking {reference}. It replaces the links ' +
      'sent before.',
    button: 'Manage my booking',
    keepLink: 'Do not forward it: it gives access to your booking.',
    notYou:
      'If you did not ask for anything, ignore this e-mail: your booking is not changed. For ' +
      'any question, call the reception on {phone}.',
    bye: 'See you soon,',
  },
} as const;

function fill(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (whole, key: string) => values[key] ?? whole);
}

export function manageLinkEmail(data: ManageLinkEmailData): ConfirmationEmail {
  const words = WORDS[data.language];
  const values = {
    reference: data.reference,
    name: data.firstName,
    phone: phoneOf(data.hotel.phone, data.language),
  };
  const subject = `${fill(words.subject, values)} · ${data.hotel.name}`;
  const hello = fill(words.hello, values);
  const intro = fill(words.intro, values);
  const notYou = fill(words.notYou, values);

  const text = [
    hello,
    '',
    intro,
    '',
    data.manageUrl,
    words.keepLink,
    '',
    notYou,
    '',
    words.bye,
    data.hotel.name,
    data.hotel.address,
  ].join('\n');

  const html = layoutHtml({
    language: data.language,
    title: data.reference,
    hotel: data.hotel,
    blocks: [
      paragraphHtml(hello),
      paragraphHtml(intro),
      buttonHtml(words.button, data.manageUrl),
      smallHtml(words.keepLink),
      paragraphHtml(notYou),
    ],
    bye: words.bye,
  });
  return { subject, text, html };
}
