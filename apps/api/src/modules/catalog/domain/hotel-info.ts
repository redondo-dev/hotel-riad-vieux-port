/**
 * Formatting of the hotel settings for the public site: the database keeps one canonical value,
 * the API derives what the pages display.
 */

/**
 * « +33465710000 » → « 04 65 71 00 00 » (French way of writing a French number). Any other
 * number is returned as stored.
 */
export function displayPhone(international: string): string {
  const match = /^\+33([1-9]\d{8})$/.exec(international);
  if (match?.[1] === undefined) {
    return international;
  }
  const national = `0${match[1]}`;
  return national.replace(/(\d{2})(?=\d)/g, '$1 ');
}

/** « 15:00:00 » (PostgreSQL time) → « 15:00 ». */
export function hoursAndMinutes(time: string): string {
  const match = /^(\d{2}):(\d{2})/.exec(time);
  if (match === null) {
    throw new Error(`heure invalide : ${time}`);
  }
  return `${match[1]}:${match[2]}`;
}

/** « 23:00:00 » → 1380 minutes after midnight. */
export function minutesAfterMidnight(time: string): number {
  const [hours, minutes] = hoursAndMinutes(time).split(':').map(Number);
  return (hours ?? 0) * 60 + (minutes ?? 0);
}
