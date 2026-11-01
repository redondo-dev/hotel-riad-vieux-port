/** Same limits as the API (modules/identity/domain/identity-rules.ts). */
export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;

export interface PasswordCheck {
  id: 'length' | 'max' | 'match';
  label: string;
  met: boolean;
}

/**
 * Rules shown live under the « new password » fields (UI/UX specification, section 5.A). The
 * maximum length only appears once exceeded, to keep the list short.
 */
export function passwordChecks(password: string, confirmation: string): PasswordCheck[] {
  const checks: PasswordCheck[] = [
    {
      id: 'length',
      label: `Au moins ${PASSWORD_MIN_LENGTH} caractères`,
      met: password.length >= PASSWORD_MIN_LENGTH,
    },
  ];
  if (password.length > PASSWORD_MAX_LENGTH) {
    checks.push({
      id: 'max',
      label: `Au plus ${PASSWORD_MAX_LENGTH} caractères`,
      met: false,
    });
  }
  checks.push({
    id: 'match',
    label: 'Les deux saisies sont identiques',
    met: password !== '' && password === confirmation,
  });
  return checks;
}

export function passwordAcceptable(password: string, confirmation: string): boolean {
  return passwordChecks(password, confirmation).every((check) => check.met);
}
