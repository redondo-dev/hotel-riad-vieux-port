import {
  addDays,
  addMonths,
  isIsoDate,
  isoDateToUtc,
  startOfMonth,
  utcToIsoDate,
  type IsoDate,
} from '@riad/shared';

/** One month of the calendar, weeks starting on Monday; `null` = empty cell. */
export interface CalendarMonth {
  start: IsoDate;
  weeks: (IsoDate | null)[][];
}

export function buildMonth(anyDayOfMonth: IsoDate): CalendarMonth {
  const first = isoDateToUtc(startOfMonth(anyDayOfMonth));
  const year = first.getUTCFullYear();
  const month = first.getUTCMonth();
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const leadingBlanks = (first.getUTCDay() + 6) % 7;

  const cells: (IsoDate | null)[] = Array.from({ length: leadingBlanks }, () => null);
  for (let day = 1; day <= daysInMonth; day++) {
    cells.push(utcToIsoDate(new Date(Date.UTC(year, month, day))));
  }
  while (cells.length % 7 !== 0) {
    cells.push(null);
  }

  const weeks: (IsoDate | null)[][] = [];
  for (let index = 0; index < cells.length; index += 7) {
    weeks.push(cells.slice(index, index + 7));
  }
  return { start: utcToIsoDate(first), weeks };
}

/** Weekday names from Monday, in the given regional format. */
export function weekdayNames(intlLocale: string): { short: string; long: string }[] {
  const short = new Intl.DateTimeFormat(intlLocale, { weekday: 'short', timeZone: 'UTC' });
  const long = new Intl.DateTimeFormat(intlLocale, { weekday: 'long', timeZone: 'UTC' });
  // 1 January 2024 was a Monday.
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(Date.UTC(2024, 0, 1 + index));
    return { short: short.format(date), long: long.format(date) };
  });
}

/** Reads a date typed as DD/MM/YYYY (also accepts `.` or `-` as separators). */
export function parseTypedDate(text: string): IsoDate | null {
  const match = /^\s*(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})\s*$/.exec(text);
  if (!match) {
    return null;
  }
  const iso = `${match[3] ?? ''}-${(match[2] ?? '').padStart(2, '0')}-${(match[1] ?? '').padStart(2, '0')}`;
  return isIsoDate(iso) ? iso : null;
}

/** Writes a date as DD/MM/YYYY, the format expected in the text fields. */
export function formatTypedDate(date: IsoDate): string {
  return `${date.slice(8, 10)}/${date.slice(5, 7)}/${date.slice(0, 4)}`;
}

/**
 * Keyboard navigation in the calendar grid (WAI-ARIA date picker pattern).
 * Returns the newly focused day, or `null` when the key is not handled.
 */
export function dateAfterKey(date: IsoDate, key: string): IsoDate | null {
  const mondayBased = (isoDateToUtc(date).getUTCDay() + 6) % 7;
  switch (key) {
    case 'ArrowLeft':
      return addDays(date, -1);
    case 'ArrowRight':
      return addDays(date, 1);
    case 'ArrowUp':
      return addDays(date, -7);
    case 'ArrowDown':
      return addDays(date, 7);
    case 'PageUp':
      return addMonths(date, -1);
    case 'PageDown':
      return addMonths(date, 1);
    case 'Home':
      return addDays(date, -mondayBased);
    case 'End':
      return addDays(date, 6 - mondayBased);
    default:
      return null;
  }
}
