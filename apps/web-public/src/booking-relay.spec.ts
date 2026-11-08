import { describe, expect, it } from 'vitest';
import { availabilityQueryOf, BookingRelay } from './booking-relay';

const QUERY = { checkIn: '2027-05-12', checkOut: '2027-05-15', guests: '2-6_2' };

interface Call {
  url: string;
  headers: unknown;
}

/** A fake API answering `status` with a small JSON body, or failing when `status` is 0. */
function relayAnswering(status: number): { relay: BookingRelay; calls: Call[] } {
  const calls: Call[] = [];
  const fakeFetch = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), headers: init?.headers });
    if (status === 0) {
      throw new TypeError('fetch failed');
    }
    return new Response(JSON.stringify({ status }), { status });
  }) as typeof fetch;
  const relay = new BookingRelay({ apiUrl: 'http://api.test/api/v1/', fetch: fakeFetch });
  return { relay, calls };
}

describe('availabilityQueryOf', () => {
  it('keeps the three parameters of a search, and nothing else', () => {
    const values: Record<string, unknown> = { ...QUERY, extra: 'x' };
    expect(availabilityQueryOf((name) => values[name])).toEqual(QUERY);
  });

  it('refuses a missing parameter or an unexpected shape', () => {
    for (const changes of [
      { checkIn: undefined },
      { checkIn: '12/05/2027' },
      { guests: '2&admin=1' },
      { guests: ['2', '3'] },
    ]) {
      const values: Record<string, unknown> = { ...QUERY, ...changes };
      expect(availabilityQueryOf((name) => values[name])).toBeNull();
    }
  });
});

describe('BookingRelay', () => {
  it('asks the public availability of the API, with the address of the visitor', async () => {
    const { relay, calls } = relayAnswering(200);

    const answer = await relay.availability(QUERY, '203.0.113.7');

    expect(calls).toEqual([
      {
        url: 'http://api.test/api/v1/public/availability?checkIn=2027-05-12&checkOut=2027-05-15&guests=2-6_2',
        headers: { 'X-Forwarded-For': '203.0.113.7' },
      },
    ]);
    expect(answer).toEqual({ status: 200, body: { status: 200 } });
  });

  it('passes on the refusals of the API, and refuses a bad query without calling it', async () => {
    expect((await relayAnswering(429).relay.availability(QUERY, undefined)).status).toBe(429);

    const { relay, calls } = relayAnswering(200);
    expect((await relay.availability(null, undefined)).status).toBe(400);
    expect(calls).toEqual([]);
  });

  it('answers 502 when the API fails or answers something unexpected', async () => {
    expect((await relayAnswering(0).relay.availability(QUERY, undefined)).status).toBe(502);
    expect((await relayAnswering(500).relay.availability(QUERY, undefined)).status).toBe(502);
  });
});
