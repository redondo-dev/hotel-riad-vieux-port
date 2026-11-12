import { describe, expect, it } from 'vitest';
import { type ConfirmationEmailData, confirmationEmail } from './confirmation-email.ts';

/** Intl writes narrow non-breaking spaces: compared here with plain spaces. */
function plain(text: string): string {
  return text.replace(/[  ]/g, ' ');
}

const HOTEL = {
  name: 'Hôtel Riad Vieux-Port',
  address: '12 quai du Port, 13002 Marseille',
  phone: '+33465710000',
  email: 'contact@riad.example',
  checkInTime: '15:00:00',
  checkOutTime: '12:00:00',
};

const FLEXIBLE: ConfirmationEmailData = {
  language: 'fr',
  firstName: 'Lina',
  reference: 'K7M2QX9A',
  checkIn: '2026-11-17',
  checkOut: '2026-11-20',
  rooms: [{ nameFr: 'Chambre familiale', nameEn: 'Family room', count: 1 }],
  ratePlan: 'flexible',
  totalCents: 64_500,
  paidOnlineCents: 0,
  touristTaxCents: 1500,
  freeCancellationUntil: new Date('2026-11-15T14:00:00Z'),
  cardGuarantee: true,
  hotel: HOTEL,
};

const NON_REFUNDABLE: ConfirmationEmailData = {
  ...FLEXIBLE,
  language: 'en',
  firstName: 'James',
  rooms: [{ nameFr: 'Double standard', nameEn: 'Standard double', count: 2 }],
  ratePlan: 'non_refundable',
  totalCents: 39_300,
  paidOnlineCents: 37_800,
  touristTaxCents: 1500,
  freeCancellationUntil: null,
  cardGuarantee: false,
};

describe('confirmation e-mail', () => {
  it('sums up a flexible stay in French: due at the hotel, guarantee, free cancellation', () => {
    const email = confirmationEmail(FLEXIBLE);
    const text = plain(email.text);

    expect(email.subject).toBe('Votre réservation K7M2QX9A est confirmée · Hôtel Riad Vieux-Port');
    expect(text).toContain('Bonjour Lina,');
    expect(text).toContain('Arrivée : Mardi 17 novembre 2026, à partir de 15:00');
    expect(text).toContain('Départ : Vendredi 20 novembre 2026, avant 12:00');
    expect(text).toContain('Séjour : 3 nuits');
    expect(text).toContain('Chambre : Chambre familiale');
    expect(text).toContain('Tarif : Tarif flexible');
    expect(text).toContain('À régler à l’hôtel : 645,00 € (dont taxe de séjour 15,00 €)');
    expect(text).not.toContain('Payé en ligne');
    expect(text).toContain('rien n’a été débité');
    expect(text).toContain('Annulation gratuite jusqu’au dimanche 15 novembre 2026 à 15:00');
    expect(text).toContain('au 04 65 71 00 00 ou écrivez à contact@riad.example');
  });

  it('sums up a non-refundable stay in English: paid online, the tax left for the hotel', () => {
    const email = confirmationEmail(NON_REFUNDABLE);
    const text = plain(email.text);

    expect(email.subject).toBe('Your booking K7M2QX9A is confirmed · Hôtel Riad Vieux-Port');
    expect(text).toContain('Hello James,');
    expect(text).toContain('Arrival: Tuesday, 17 November 2026, from 15:00');
    expect(text).toContain('Rooms: 2 × Standard double');
    expect(text).toContain('Paid online: €378.00');
    expect(text).toContain('To pay at the hotel: €15.00 (tourist tax)');
    expect(text).toContain('can be neither cancelled nor refunded');
    expect(text).toContain('on +33 4 65 71 00 00');
    expect(text).not.toContain('guarantee');
  });

  it('escapes in the HTML what the customer typed', () => {
    const email = confirmationEmail({ ...FLEXIBLE, firstName: '<script>Lina</script>' });

    expect(email.html).toContain('Bonjour &lt;script&gt;Lina&lt;/script&gt;,');
    expect(email.html).not.toContain('<script>');
    expect(email.html).toContain('<html lang="fr">');
    expect(plain(email.html)).toContain('645,00 €');
  });
});
