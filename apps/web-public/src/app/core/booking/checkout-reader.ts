import { isPlatformServer } from '@angular/common';
import { inject, makeStateKey, PLATFORM_ID, REQUEST_CONTEXT, TransferState } from '@angular/core';
import { BOOKING_RELAY_PATH, type RelayAnswer } from '../../../booking-relay';

const UNREACHABLE: RelayAnswer = { status: 502, body: null };

/** What server.ts gives each page, besides the catalogue. */
type ReadOnServer = (sessionId: string) => Promise<RelayAnswer>;

function readOnServerOf(context: unknown): ReadOnServer | undefined {
  if (typeof context === 'object' && context !== null && 'readCheckout' in context) {
    return context.readCheckout as ReadOnServer;
  }
  return undefined;
}

async function readFromBrowser(sessionId: string): Promise<RelayAnswer> {
  try {
    const response = await fetch(`${BOOKING_RELAY_PATH}/checkout/${encodeURIComponent(sessionId)}`);
    return { status: response.status, body: (await response.json()) as unknown };
  } catch {
    return UNREACHABLE;
  }
}

/**
 * Reads the booking of a payment page, for the confirmation page (same way as the
 * availability: on the server for the first display, written into the page; in the browser
 * otherwise). Must be called in an injection context.
 */
export function checkoutReader(): (sessionId: string) => Promise<RelayAnswer> {
  const transferState = inject(TransferState);
  const onServer = isPlatformServer(inject(PLATFORM_ID));
  const readOnServer = readOnServerOf(inject(REQUEST_CONTEXT, { optional: true }));

  return async (sessionId) => {
    const key = makeStateKey<RelayAnswer>(`checkout:${sessionId}`);
    if (onServer) {
      const answer = readOnServer === undefined ? UNREACHABLE : await readOnServer(sessionId);
      transferState.set(key, answer);
      return answer;
    }
    if (transferState.hasKey(key)) {
      const answer = transferState.get(key, UNREACHABLE);
      transferState.remove(key);
      return answer;
    }
    return readFromBrowser(sessionId);
  };
}
