import { isPlatformServer } from '@angular/common';
import { inject, makeStateKey, PLATFORM_ID, REQUEST_CONTEXT, TransferState } from '@angular/core';
import {
  AVAILABILITY_RELAY_PATH,
  type AvailabilityQuery,
  type RelayAnswer,
} from '../../../booking-relay';
import { type AvailabilityResult, availabilityResultOf } from './availability-result';

const UNREACHABLE: RelayAnswer = { status: 502, body: null };

/** What server.ts gives each page, besides the catalogue. */
type SearchOnServer = (query: AvailabilityQuery) => Promise<RelayAnswer>;

function searchOnServerOf(context: unknown): SearchOnServer | undefined {
  if (typeof context === 'object' && context !== null && 'searchAvailability' in context) {
    return context.searchAvailability as SearchOnServer;
  }
  return undefined;
}

async function searchFromBrowser(query: AvailabilityQuery): Promise<RelayAnswer> {
  try {
    const response = await fetch(`${AVAILABILITY_RELAY_PATH}?${new URLSearchParams({ ...query })}`);
    return { status: response.status, body: (await response.json()) as unknown };
  } catch {
    return UNREACHABLE;
  }
}

/**
 * Reads the availability of a search (must be called in an injection context; the function it
 * returns can be called later):
 *  - on the server, through server.ts, which calls the API with the visitor's address; the
 *    answer is then written into the page, so that the browser does not ask again;
 *  - in the browser, from the page when it is there, otherwise from the relay of the site
 *    (a new search made on the page).
 */
export function availabilityReader(): (query: AvailabilityQuery) => Promise<AvailabilityResult> {
  const transferState = inject(TransferState);
  const onServer = isPlatformServer(inject(PLATFORM_ID));
  const searchOnServer = searchOnServerOf(inject(REQUEST_CONTEXT, { optional: true }));

  return async (query) => {
    const key = makeStateKey<RelayAnswer>(`availability?${new URLSearchParams({ ...query })}`);
    let answer: RelayAnswer;
    if (onServer) {
      answer = searchOnServer === undefined ? UNREACHABLE : await searchOnServer(query);
      transferState.set(key, answer);
    } else if (transferState.hasKey(key)) {
      answer = transferState.get(key, UNREACHABLE);
      // Read once: a later search with the same criteria asks again (the stock changes).
      transferState.remove(key);
    } else {
      answer = await searchFromBrowser(query);
    }
    return availabilityResultOf(answer);
  };
}
