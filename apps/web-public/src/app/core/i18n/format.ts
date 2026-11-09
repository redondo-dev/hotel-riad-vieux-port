import { isoDateToUtc, type IsoDate, type Locale } from '@riad/shared';
import { INTL_LOCALE } from './locale';

/** Price in euros, without decimals when the amount is round: « 95 € », « 67,50 € ». */
export function formatPrice(cents: number, locale: Locale): string {
  return new Intl.NumberFormat(INTL_LOCALE[locale], {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

/** Calendar date, read in UTC so it is never shifted by the visitor's time zone. */
export function formatDate(
  date: IsoDate,
  locale: Locale,
  options: Intl.DateTimeFormatOptions,
): string {
  return new Intl.DateTimeFormat(INTL_LOCALE[locale], { ...options, timeZone: 'UTC' }).format(
    isoDateToUtc(date),
  );
}

/** Time of day from `HH:mm`: « 15:00 ». */
export function formatTime(time: string, locale: Locale): string {
  const [hours = 0, minutes = 0] = time.split(':').map(Number);
  return new Intl.DateTimeFormat(INTL_LOCALE[locale], {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(1970, 0, 1, hours, minutes)));
}

/** An instant shown at the hotel's time: « lundi 10 mai à 15:00 ». */
export function formatInstant(
  instant: string,
  locale: Locale,
  timeZone: string,
  options: Intl.DateTimeFormatOptions,
): string {
  return new Intl.DateTimeFormat(INTL_LOCALE[locale], { ...options, timeZone }).format(
    new Date(instant),
  );
}
