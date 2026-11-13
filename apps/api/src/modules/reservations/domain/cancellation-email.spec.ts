import { describe, expect, it } from 'vitest';
import { type CancellationEmailData, cancellationEmail } from './cancellation-email.ts';

function plain(text: string): string {
  return text.replace(/[  ]/g, ' ');
}

const DATA: CancellationEmailData = {
  language: 'fr',
  firstName: 'Lina',
  reference: 'K7M2QX9A',
  checkIn: '2026-11-17',
  checkOut: '2026-11-20',
  rooms: [{ nameFr: 'Chambre familiale', nameEn: 'Family room', count: 1 }],
  ratePlan: 'flexible',
  feeCents: 0,
  hotel: {
    name: 'Hôtel Riad Vieux-Port',
    address: '12 quai du Port, 13002 Marseille',
    phone: '+33465710000',
    email: 'contact@riad.example',
  },
};

describe('cancellation e-mail', () => {
  it('tells in French that a flexible stay is cancelled and that nothing was charged', () => {
    const email = cancellationEmail(DATA);
    const text = plain(email.text);

    expect(email.subject).toBe('Votre réservation K7M2QX9A est annulée · Hôtel Riad Vieux-Port');
    expect(text).toContain('Bonjour Lina,');
    expect(text).toContain('Arrivée : Mardi 17 novembre 2026');
    expect(text).toContain('Chambre : Chambre familiale');
    expect(text).toContain('Aucuns frais : rien n’a été débité.');
    expect(text).toContain('au 04 65 71 00 00');
  });

  it('tells in English the fee of a late cancellation, escaped in the HTML', () => {
    const email = cancellationEmail({
      ...DATA,
      language: 'en',
      firstName: '<i>James</i>',
      feeCents: 21_500,
    });

    expect(email.subject).toBe('Your booking K7M2QX9A is cancelled · Hôtel Riad Vieux-Port');
    expect(plain(email.text)).toContain('A cancellation fee of €215.00 applies');
    expect(email.html).toContain('Hello &lt;i&gt;James&lt;/i&gt;,');
    expect(email.html).not.toContain('<i>');
  });

  it('says only « no fee » for a non-refundable stay cancelled at no cost', () => {
    const text = cancellationEmail({ ...DATA, ratePlan: 'non_refundable' }).text;

    expect(text).toContain('Aucuns frais d’annulation.');
    expect(text).not.toContain('rien n’a été débité');
  });
});
