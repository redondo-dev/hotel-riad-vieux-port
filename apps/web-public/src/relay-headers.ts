/**
 * Headers of every call of this server to the public routes of the API (step S-1, security
 * review R-1 « M-2 »): the secret shared with the API (RELAY_SECRET) proves the call comes from
 * the site; with it, the API counts the visitor's address sent here for its limits. Without the
 * secret (development), the API ignores the address. Same names in apps/api (shared/http/relay).
 */
export const RELAY_SECRET_HEADER = 'X-Riad-Relay-Secret';
export const VISITOR_IP_HEADER = 'X-Riad-Visitor-Ip';

export function relayHeaders(
  secret: string | undefined,
  visitorIp?: string,
): Record<string, string> {
  return {
    ...(secret === undefined ? {} : { [RELAY_SECRET_HEADER]: secret }),
    ...(visitorIp === undefined ? {} : { [VISITOR_IP_HEADER]: visitorIp }),
  };
}
