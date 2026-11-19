/** Title of the login page: « Bonjour » from 5 a.m., « Bonsoir » from 6 p.m. (local time). */
export function greetingAt(date: Date): 'Bonjour' | 'Bonsoir' {
  const hour = date.getHours();
  return hour >= 5 && hour < 18 ? 'Bonjour' : 'Bonsoir';
}

export const LOGIN_SUBTITLE =
  'Réception, ménage, réservations : connectez-vous à l’outil de l’hôtel.';
