import { displayPhone, hoursAndMinutes } from '../../catalog/domain/hotel-info.ts';
import type { RatePlan } from './reservation-rules.ts';

/**
 * The e-mail of confirmation of a booking of the website (step R-6), in French or in English
 * (the language chosen on the site), as plain text and as simple HTML. The texts are written
 * here (decision « Brevo a »), never in a template of Brevo. No card data: only what the hotel
 * and the customer need to know about the stay.
 */

export interface ConfirmationEmailData {
  language: 'fr' | 'en';
  firstName: string;
  reference: string;
  checkIn: string;
  checkOut: string;
  rooms: { nameFr: string; nameEn: string; count: number }[];
  ratePlan: RatePlan;
  totalCents: number;
  /** Received online (non-refundable rate); 0 for the flexible rate. */
  paidOnlineCents: number;
  touristTaxCents: number;
  /** Flexible rate only. */
  freeCancellationUntil: Date | null;
  cardGuarantee: boolean;
  /** « Gérer ma réservation » (step M): its secret link, or null. */
  manageUrl: string | null;
  hotel: {
    name: string;
    address: string;
    phone: string;
    email: string;
    checkInTime: string;
    checkOutTime: string;
  };
}

export interface ConfirmationEmail {
  subject: string;
  text: string;
  html: string;
}

const HOTEL_TIME_ZONE = 'Europe/Paris';

const WORDS = {
  fr: {
    locale: 'fr-FR',
    colon: ' : ',
    subject: 'Votre réservation {reference} est confirmée',
    hello: 'Bonjour {name},',
    intro: 'Merci pour votre réservation : elle est confirmée. Voici son récapitulatif.',
    reference: 'Référence',
    arrival: 'Arrivée',
    departure: 'Départ',
    from: 'à partir de',
    before: 'avant',
    stay: 'Séjour',
    nights: (count: number) => (count > 1 ? `${count} nuits` : '1 nuit'),
    room: 'Chambre',
    rooms: 'Chambres',
    rate: 'Tarif',
    flexible: 'Tarif flexible',
    nonRefundable: 'Non remboursable',
    paidOnline: 'Payé en ligne',
    dueAtHotel: 'À régler à l’hôtel',
    taxIncluded: 'dont taxe de séjour',
    touristTax: 'taxe de séjour',
    guarantee: 'Votre carte est enregistrée en garantie : rien n’a été débité.',
    freeCancellation:
      'Annulation gratuite jusqu’au {date} (heure de Marseille). Au-delà, les conditions de ' +
      'vente s’appliquent.',
    noCancellation: 'Ce tarif n’est ni annulable ni remboursable.',
    questions:
      'Pour toute question, appelez la réception au {phone} ou écrivez à {email}, en ' +
      'indiquant votre référence.',
    bye: 'À bientôt,',
    at: 'à',
    manage: 'Pour consulter ou annuler votre réservation, utilisez ce lien personnel :',
    manageButton: 'Gérer ma réservation',
    keepLink: 'Ne le transférez pas : il donne accès à votre réservation.',
  },
  en: {
    locale: 'en-GB',
    colon: ': ',
    subject: 'Your booking {reference} is confirmed',
    hello: 'Hello {name},',
    intro: 'Thank you for your booking: it is confirmed. Here is its summary.',
    reference: 'Reference',
    arrival: 'Arrival',
    departure: 'Departure',
    from: 'from',
    before: 'before',
    stay: 'Stay',
    nights: (count: number) => (count > 1 ? `${count} nights` : '1 night'),
    room: 'Room',
    rooms: 'Rooms',
    rate: 'Rate',
    flexible: 'Flexible rate',
    nonRefundable: 'Non-refundable',
    paidOnline: 'Paid online',
    dueAtHotel: 'To pay at the hotel',
    taxIncluded: 'including tourist tax',
    touristTax: 'tourist tax',
    guarantee: 'Your card is saved as a guarantee: nothing has been charged.',
    freeCancellation:
      'Free cancellation until {date} (Marseille time). After that, the terms and conditions ' +
      'of sale apply.',
    noCancellation: 'This rate can be neither cancelled nor refunded.',
    questions:
      'For any question, call the reception on {phone} or write to {email}, giving your ' +
      'reference.',
    bye: 'See you soon,',
    at: 'at',
    manage: 'To view or cancel your booking, use this personal link:',
    manageButton: 'Manage my booking',
    keepLink: 'Do not forward it: it gives access to your booking.',
  },
} as const;

type Words = (typeof WORDS)['fr' | 'en'];

function fill(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (whole, key: string) => values[key] ?? whole);
}

function dayOf(date: string, words: Words): string {
  const text = new Intl.DateTimeFormat(words.locale, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${date}T00:00:00Z`));
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function instantOf(instant: Date, words: Words): string {
  const day = new Intl.DateTimeFormat(words.locale, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: HOTEL_TIME_ZONE,
  }).format(instant);
  const time = new Intl.DateTimeFormat('fr-FR', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: HOTEL_TIME_ZONE,
  }).format(instant);
  return `${day} ${words.at} ${time}`;
}

function euros(cents: number, words: Words): string {
  const formatter = new Intl.NumberFormat(words.locale, { style: 'currency', currency: 'EUR' });
  return formatter.format(cents / 100);
}

/** « 04 65 71 00 00 » in French, « +33 4 65 71 00 00 » in English. */
export function phoneOf(international: string, language: 'fr' | 'en'): string {
  const national = displayPhone(international);
  if (language === 'fr' || !international.startsWith('+33') || !national.startsWith('0')) {
    return national;
  }
  return `+33 ${national.slice(1)}`;
}

function nightsBetween(checkIn: string, checkOut: string): number {
  const ms = Date.parse(`${checkOut}T00:00:00Z`) - Date.parse(`${checkIn}T00:00:00Z`);
  return Math.round(ms / 86_400_000);
}

/** Lines « label : value » of the summary, the same in the text and in the HTML. */
function summaryOf(data: ConfirmationEmailData, words: Words): [string, string][] {
  const rooms = data.rooms.map((room) => {
    const name = data.language === 'fr' ? room.nameFr : room.nameEn;
    return room.count > 1 ? `${room.count} × ${name}` : name;
  });
  const roomCount = data.rooms.reduce((sum, room) => sum + room.count, 0);
  const due = data.totalCents - data.paidOnlineCents;
  const lines: [string, string][] = [
    [words.reference, data.reference],
    [
      words.arrival,
      `${dayOf(data.checkIn, words)}, ${words.from} ${hoursAndMinutes(data.hotel.checkInTime)}`,
    ],
    [
      words.departure,
      `${dayOf(data.checkOut, words)}, ${words.before} ${hoursAndMinutes(data.hotel.checkOutTime)}`,
    ],
    [words.stay, words.nights(nightsBetween(data.checkIn, data.checkOut))],
    [roomCount > 1 ? words.rooms : words.room, rooms.join(', ')],
    [words.rate, data.ratePlan === 'flexible' ? words.flexible : words.nonRefundable],
  ];
  if (data.paidOnlineCents > 0) {
    lines.push([words.paidOnline, euros(data.paidOnlineCents, words)]);
  }
  if (due > 0) {
    let tax = '';
    if (data.touristTaxCents === due) {
      tax = ` (${words.touristTax})`;
    } else if (data.touristTaxCents > 0) {
      tax = ` (${words.taxIncluded} ${euros(data.touristTaxCents, words)})`;
    }
    lines.push([words.dueAtHotel, `${euros(due, words)}${tax}`]);
  }
  return lines;
}

/** The sentences after the summary: guarantee and cancellation. */
function conditionsOf(data: ConfirmationEmailData, words: Words): string[] {
  const sentences: string[] = [];
  if (data.cardGuarantee) {
    sentences.push(words.guarantee);
  }
  if (data.ratePlan === 'flexible' && data.freeCancellationUntil !== null) {
    const date = instantOf(data.freeCancellationUntil, words);
    sentences.push(fill(words.freeCancellation, { date }));
  } else if (data.ratePlan === 'non_refundable') {
    sentences.push(words.noCancellation);
  }
  return sentences;
}

export function confirmationEmail(data: ConfirmationEmailData): ConfirmationEmail {
  const words = WORDS[data.language];
  const subject = `${fill(words.subject, { reference: data.reference })} · ${data.hotel.name}`;
  const hello = fill(words.hello, { name: data.firstName });
  const summary = summaryOf(data, words);
  const conditions = conditionsOf(data, words);
  const questions = fill(words.questions, {
    phone: phoneOf(data.hotel.phone, data.language),
    email: data.hotel.email,
  });

  const text = [
    hello,
    '',
    words.intro,
    '',
    ...summary.map(([label, value]) => `${label}${words.colon}${value}`),
    '',
    ...conditions.flatMap((sentence) => [sentence, '']),
    ...(data.manageUrl === null ? [] : [words.manage, data.manageUrl, words.keepLink, '']),
    questions,
    '',
    words.bye,
    data.hotel.name,
    data.hotel.address,
  ].join('\n');

  const blocks = [
    paragraphHtml(hello),
    paragraphHtml(words.intro),
    tableHtml(summary),
    ...conditions.map(paragraphHtml),
    ...(data.manageUrl === null
      ? []
      : [
          paragraphHtml(words.manage),
          buttonHtml(words.manageButton, data.manageUrl),
          smallHtml(words.keepLink),
        ]),
    paragraphHtml(questions),
  ];
  const html = layoutHtml({
    language: data.language,
    title: data.reference,
    hotel: data.hotel,
    blocks,
    bye: words.bye,
  });
  return { subject, text, html };
}

export function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function paragraphHtml(sentence: string): string {
  return `<p style="margin:0 0 16px">${escapeHtml(sentence)}</p>`;
}

export function smallHtml(sentence: string): string {
  return `<p style="margin:0 0 16px;font-size:13px;color:#6b6259">${escapeHtml(sentence)}</p>`;
}

function rowHtml([label, value]: [string, string]): string {
  return (
    '<tr><td style="padding:6px 16px 6px 0;color:#6b6259;vertical-align:top">' +
    `${escapeHtml(label)}</td><td style="padding:6px 0;font-weight:600">` +
    `${escapeHtml(value)}</td></tr>`
  );
}

export function tableHtml(rows: [string, string][]): string {
  return (
    '<table role="presentation" style="border-collapse:collapse;margin:0 0 20px">' +
    `${rows.map(rowHtml).join('')}</table>`
  );
}

/** A link shaped like a button (terracotta), the only one of the e-mail. */
export function buttonHtml(label: string, url: string): string {
  return (
    '<p style="margin:0 0 12px"><a href="' +
    escapeHtml(url) +
    '" style="display:inline-block;padding:12px 20px;background:#a0522d;color:#ffffff;' +
    'border-radius:8px;text-decoration:none;font-weight:700">' +
    `${escapeHtml(label)}</a></p>`
  );
}

/**
 * The frame of every e-mail to the customers: colours of the site (sand background, ink text,
 * terracotta accent), inline styles for the mail programs. `blocks` are already escaped.
 */
export function layoutHtml(layout: {
  language: 'fr' | 'en';
  title: string;
  hotel: { name: string; address: string };
  blocks: string[];
  bye: string;
}): string {
  const { hotel } = layout;
  return (
    `<!doctype html><html lang="${layout.language}"><head><meta charset="utf-8">` +
    `<title>${escapeHtml(layout.title)}</title></head>` +
    '<body style="margin:0;padding:24px;background:#faf6f0;color:#1f1a17;' +
    'font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5">' +
    '<div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;' +
    'padding:28px">' +
    '<p style="margin:0 0 20px;color:#a0522d;font-weight:700;letter-spacing:1px">' +
    `${escapeHtml(hotel.name.toUpperCase())}</p>` +
    layout.blocks.join('') +
    `<p style="margin:0">${escapeHtml(layout.bye)}<br>${escapeHtml(hotel.name)}<br>` +
    `<span style="color:#6b6259">${escapeHtml(hotel.address)}</span></p>` +
    '</div></body></html>'
  );
}
