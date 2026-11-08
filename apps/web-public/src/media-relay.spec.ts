import { describe, expect, it } from 'vitest';
import { MediaRelay } from './media-relay';

const FILE = '0b9f6a3e-2c4d-4e8f-9a1b-3c5d7e9f1a2b-800.webp';

interface Harness {
  relay: MediaRelay;
  calls: string[];
  errors: unknown[];
}

/** A fake API that answers `status` (and three bytes when 200), or fails when `status` is 0. */
function relayAnswering(status: number): Harness {
  const calls: string[] = [];
  const errors: unknown[] = [];
  const fakeFetch = (async (input: string | URL | Request) => {
    calls.push(String(input));
    if (status === 0) {
      throw new TypeError('fetch failed');
    }
    return new Response(status === 200 ? new Uint8Array([1, 2, 3]) : null, { status });
  }) as typeof fetch;
  const relay = new MediaRelay({
    apiUrl: 'http://api.test/api/v1/',
    fetch: fakeFetch,
    onError: (error) => {
      errors.push(error);
    },
  });
  return { relay, calls, errors };
}

describe('MediaRelay', () => {
  it('reads the file from the public media of the API', async () => {
    const { relay, calls } = relayAnswering(200);

    const answer = await relay.read(FILE);

    expect(calls).toEqual([`http://api.test/api/v1/public/media/${FILE}`]);
    expect(answer).toEqual({ status: 200, body: new Uint8Array([1, 2, 3]) });
  });

  it('never asks the API for a name it does not make', async () => {
    const { relay, calls } = relayAnswering(200);

    for (const name of ['../session', `${FILE}?x=1`, 'photo.jpg', FILE.replace('800', '900')]) {
      expect(await relay.read(name)).toEqual({ status: 404 });
    }
    expect(calls).toEqual([]);
  });

  it('answers 404 for a missing file and 502 when the API fails', async () => {
    expect(await relayAnswering(404).relay.read(FILE)).toEqual({ status: 404 });

    const down = relayAnswering(0);
    expect(await down.relay.read(FILE)).toEqual({ status: 502 });
    expect(down.errors).toHaveLength(1);

    expect(await relayAnswering(500).relay.read(FILE)).toEqual({ status: 502 });
  });
});
