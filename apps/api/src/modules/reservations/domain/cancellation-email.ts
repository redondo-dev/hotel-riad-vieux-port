import {
  type ConfirmationEmail,
  type ConfirmationEmailData,
  dayIn,
  eurosIn,
  layoutHtml,
  paragraphHtml,
  phoneOf,
  tableHtml,
} from './confirmation-email.ts';

/**
 * E-mail « Votre réservation est annulée » (step M), sent to the customer of a booking of the
 * website once cancelled, by himself (« Gérer ma réservation ») or by the reception. In French
 * or in English, as plain text and as HTML. It tells the fee when there is one; no card data.
 */
export interface CancellationEmailData {
  language: 'fr' | 'en';
  firstName: string;
  reference: string;
  checkIn: string;
  checkOut: string;
  rooms: ConfirmationEmailData['rooms'];
  ratePlan: ConfirmationEmailData['ratePlan'];
  feeCents: number;
  hotel: { name: string; address: string; phone: string; email: string };
}

const WORDS = {
  fr: {
    colon: ' : ',
    subject: 'Votre réservation {reference} est annulée',
    hello: 'Bonjour {name},',
    intro: 'Votre réservation est annulée. Voici ce qu’elle concernait.',
    reference: 'Référence',
    arrival: 'Arrivée',
    departure: 'Départ',
    room: 'Chambre',
    rooms: 'Chambres',
    fee: 'Des frais d’annulation de {amount} s’appliquent, selon les conditions de vente.',
    nothingCharged: 'Aucuns frais : rien n’a été débité.',
    noFee: 'Aucuns frais d’annulation.',
    welcome: 'Nous espérons vous accueillir une prochaine fois.',
    questions:
      'Pour toute question, appelez la réception au {phone} ou écrivez à {email}, en ' +
      'indiquant votre référence.',
    bye: 'À bientôt,',
  },
  en: {
    colon: ': ',
    subject: 'Your booking {reference} is cancelled',
    hello: 'Hello {name},',
    intro: 'Your booking is cancelled. Here is what it was about.',
    reference: 'Reference',
    arrival: 'Arrival',
    departure: 'Departure',
    room: 'Room',
    rooms: 'Rooms',
    fee: 'A cancellation fee of {amount} applies, according to the terms and conditions of sale.',
    nothingCharged: 'No fee: nothing has been charged.',
    noFee: 'No cancellation fee.',
    welcome: 'We hope to welcome you another time.',
    questions:
      'For any question, call the reception on {phone} or write to {email}, giving your ' +
      'reference.',
    bye: 'See you soon,',
  },
} as const;

function fill(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (whole, key: string) => values[key] ?? whole);
}

export function cancellationEmail(data: CancellationEmailData): ConfirmationEmail {
  const words = WORDS[data.language];
  const subject = `${fill(words.subject, { reference: data.reference })} · ${data.hotel.name}`;
  const hello = fill(words.hello, { name: data.firstName });
  const rooms = data.rooms.map((room) => {
    const name = data.language === 'fr' ? room.nameFr : room.nameEn;
    return room.count > 1 ? `${room.count} × ${name}` : name;
  });
  const roomCount = data.rooms.reduce((sum, room) => sum + room.count, 0);
  const summary: [string, string][] = [
    [words.reference, data.reference],
    [words.arrival, dayIn(data.checkIn, data.language)],
    [words.departure, dayIn(data.checkOut, data.language)],
    [roomCount > 1 ? words.rooms : words.room, rooms.join(', ')],
  ];
  let fee: string = words.noFee;
  if (data.feeCents > 0) {
    fee = fill(words.fee, { amount: eurosIn(data.feeCents, data.language) });
  } else if (data.ratePlan === 'flexible') {
    fee = words.nothingCharged;
  }
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
    fee,
    '',
    words.welcome,
    questions,
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
      paragraphHtml(words.intro),
      tableHtml(summary),
      paragraphHtml(fee),
      paragraphHtml(words.welcome),
      paragraphHtml(questions),
    ],
    bye: words.bye,
  });
  return { subject, text, html };
}
