import { describe, expect, it } from 'vitest';
import { manageLinkEmail } from './manage-link-email.ts';

const DATA = {
  language: 'fr' as const,
  firstName: 'Lina',
  reference: 'K7M2QX9A',
  manageUrl: 'https://riad.example/fr/gerer-ma-reservation#K7M2QX9A.jeton',
  hotel: {
    name: 'Hôtel Riad Vieux-Port',
    address: '12 quai du Port, 13002 Marseille',
    phone: '+33465710000',
  },
};

describe('manage link e-mail', () => {
  it('gives the new link in French, telling it replaces the previous ones', () => {
    const email = manageLinkEmail(DATA);

    expect(email.subject).toBe(
      'Votre lien pour gérer la réservation K7M2QX9A · Hôtel Riad Vieux-Port',
    );
    expect(email.text).toContain('Bonjour Lina,');
    expect(email.text).toContain('Il remplace les liens envoyés auparavant.');
    expect(email.text).toContain(DATA.manageUrl);
    expect(email.text).toContain('Si vous n’avez rien demandé, ignorez cet e-mail');
    expect(email.text).toContain('au 04 65 71 00 00');
    expect(email.html).toContain(`href="${DATA.manageUrl}"`);
  });

  it('writes it in English for an English booking', () => {
    const email = manageLinkEmail({ ...DATA, language: 'en', firstName: '<b>James</b>' });

    expect(email.subject).toBe('Your link to manage the booking K7M2QX9A · Hôtel Riad Vieux-Port');
    expect(email.text).toContain('If you did not ask for anything');
    expect(email.html).toContain('Hello &lt;b&gt;James&lt;/b&gt;,');
    expect(email.html).toContain('>Manage my booking</a>');
  });
});
