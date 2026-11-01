import { describe, expect, it } from 'vitest';
import { CatalogSource } from './catalog-source';

/** A fake API: answers like the real one, or fails when `down` is true. */
function fakeApi(): { fetch: typeof fetch; calls: string[]; setDown: (down: boolean) => void } {
  const calls: string[] = [];
  let down = false;
  const bodies: Record<string, unknown> = {
    '/public/hotel': {
      name: 'Hôtel Riad Vieux-Port',
      address: 'Quai du Vieux-Port, 13002 Marseille',
      phone: { display: '04 65 71 00 00', international: '+33465710000' },
      email: 'contact@riad-vieux-port.example',
      checkInFrom: '15:00',
      checkOutBefore: '12:00',
      timeZone: 'Europe/Paris',
      bookingRules: {
        maxStayNights: 30,
        bookingHorizonDays: 365,
        sameDayCutoffMinutes: 1380,
        nonRefundableDiscountPercent: 10,
        freeCancellationHours: 48,
      },
    },
    '/public/room-categories': { items: [] },
    '/public/services': { items: [] },
  };
  const fakeFetch = (async (input: string | URL | Request) => {
    const url = String(input);
    calls.push(url);
    if (down) {
      throw new TypeError('fetch failed');
    }
    const path = url.replace('http://api.test/api/v1', '');
    return new Response(JSON.stringify(bodies[path]), { status: 200 });
  }) as typeof fetch;
  return {
    fetch: fakeFetch,
    calls,
    setDown: (value) => {
      down = value;
    },
  };
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

function sourceWith(api: ReturnType<typeof fakeApi>, clock: { now: number }): CatalogSource {
  return new CatalogSource({
    apiUrl: 'http://api.test/api/v1/',
    fetch: api.fetch,
    now: () => clock.now,
  });
}

describe('CatalogSource', () => {
  it('reads the three addresses of the public API, then keeps the answer one minute', async () => {
    const api = fakeApi();
    const clock = { now: 0 };
    const source = sourceWith(api, clock);

    const first = await source.get();
    expect(first?.hotel.name).toBe('Hôtel Riad Vieux-Port');
    expect(api.calls.sort()).toEqual([
      'http://api.test/api/v1/public/hotel',
      'http://api.test/api/v1/public/room-categories',
      'http://api.test/api/v1/public/services',
    ]);

    clock.now = 30_000;
    await source.get();
    expect(api.calls).toHaveLength(3);

    clock.now = 2 * MINUTE;
    await source.get();
    expect(api.calls).toHaveLength(6);
  });

  it('keeps showing the last data received while the API is down, for 24 hours', async () => {
    const api = fakeApi();
    const clock = { now: 0 };
    const source = sourceWith(api, clock);
    await source.get();

    api.setDown(true);
    clock.now = 23 * HOUR;
    expect((await source.get())?.hotel.name).toBe('Hôtel Riad Vieux-Port');

    clock.now = 25 * HOUR;
    expect(await source.get()).toBe(null);
  });

  it('gives nothing when the API never answered', async () => {
    const api = fakeApi();
    api.setDown(true);
    const errors: unknown[] = [];
    const source = new CatalogSource({
      apiUrl: 'http://api.test/api/v1',
      fetch: api.fetch,
      onError: (error) => errors.push(error),
    });

    expect(await source.get()).toBe(null);
    expect(errors).toHaveLength(1);
  });

  it('reads the API once for requests arriving together', async () => {
    const api = fakeApi();
    const source = sourceWith(api, { now: 0 });

    await Promise.all([source.get(), source.get(), source.get()]);
    expect(api.calls).toHaveLength(3);
  });
});
