/**
 * Page to go back to after login (`?retour=` in the address). Only an address INSIDE the staff
 * tool is accepted: anything else could send the person to another site right after they typed
 * their password (open redirect). Returns undefined when the value cannot be trusted.
 */
export function safeReturnUrl(value: string | null | undefined): string | undefined {
  if (value === null || value === undefined || value === '') {
    return undefined;
  }
  // A single leading slash, no protocol, no « // » (another host), no backslash trick.
  if (!value.startsWith('/') || value.startsWith('//') || value.includes('\\')) {
    return undefined;
  }
  if (/^\/(connexion|mot-de-passe)/.test(value)) {
    return undefined;
  }
  return value;
}
