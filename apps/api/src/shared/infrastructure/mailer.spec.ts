import { describe, expect, it } from 'vitest';
import { BREVO_SEND_URL, brevoMailer, escapeHtml } from './mailer.ts';

/** Sending through Brevo with a fake fetch: Brevo is never called by the tests. */

const KEY = 'xkeysib-cle-factice-des-tests-0123456789';

function fakeFetch(status: number, body: unknown = { messageId: '<1@relay.test>' }) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetcher = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(JSON.stringify(body), { status });
  }) as typeof fetch;
  return { calls, fetcher };
}

const message = {
  to: 'lina.client@test.example',
  subject: 'Votre réservation K7M2QX9A est confirmée',
  text: 'Bonjour Lina',
  html: '<p>Bonjour Lina</p>',
};

describe('brevoMailer', () => {
  it('sends the text and HTML bodies, the key in the header only', async () => {
    const { calls, fetcher } = fakeFetch(201);
    const mailer = brevoMailer({
      apiKey: KEY,
      from: { email: 'reservations@riad.example', name: 'Hôtel Riad Vieux-Port' },
      fetch: fetcher,
    });

    await mailer.send(message);

    expect(calls).toHaveLength(1);
    const call = calls[0];
    expect(call?.url).toBe(BREVO_SEND_URL);
    expect(call?.init.method).toBe('POST');
    expect((call?.init.headers as Record<string, string>)['api-key']).toBe(KEY);
    const body = JSON.parse(String(call?.init.body)) as Record<string, unknown>;
    expect(body).toEqual({
      sender: { email: 'reservations@riad.example', name: 'Hôtel Riad Vieux-Port' },
      to: [{ email: 'lina.client@test.example' }],
      subject: 'Votre réservation K7M2QX9A est confirmée',
      textContent: 'Bonjour Lina',
      htmlContent: '<p>Bonjour Lina</p>',
    });
    expect(String(call?.init.body)).not.toContain(KEY);
  });

  it('sends every e-mail to the developer, the real address in the subject', async () => {
    const { calls, fetcher } = fakeFetch(201);
    const mailer = brevoMailer({
      apiKey: KEY,
      from: { email: 'reservations@riad.example', name: 'Riad' },
      redirectTo: 'dev@riad.example',
      fetch: fetcher,
    });

    await mailer.send({ to: 'lina.client@test.example', subject: 'Objet', text: '<b>&' });

    const body = JSON.parse(String(calls[0]?.init.body)) as Record<string, unknown>;
    expect(body['to']).toEqual([{ email: 'dev@riad.example' }]);
    expect(body['subject']).toBe('[pour lina.client@test.example] Objet');
    expect(body['htmlContent']).toBe('<pre>&lt;b&gt;&amp;</pre>');
  });

  it('fails on a refusal of Brevo, telling its code but never the key', async () => {
    const { fetcher } = fakeFetch(401, { code: 'unauthorized', message: `clé ${KEY} refusée` });
    const mailer = brevoMailer({
      apiKey: KEY,
      from: { email: 'a@b.example', name: 'R' },
      fetch: fetcher,
    });

    const error = await mailer.send(message).then(() => null, (reason: unknown) => reason);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe('Brevo a refusé l’e-mail (HTTP 401, unauthorized)');
  });

  it('escapes the characters of HTML', () => {
    expect(escapeHtml(`<a href="x">L'été & co</a>`)).toBe(
      '&lt;a href=&quot;x&quot;&gt;L&#39;été &amp; co&lt;/a&gt;',
    );
  });
});
