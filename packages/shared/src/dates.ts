/**
 * Calendar dates without time or time zone, formatted `YYYY-MM-DD`.
 *
 * Hotel stays are counted in nights between two calendar dates, so the code never
 * manipulates local `Date` objects for them: every computation goes through UTC midnight,
 * which avoids off-by-one errors around daylight saving time changes.
 */
export type IsoDate = string;

const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_IN_MS = 86_400_000;

function readParts(value: string): [number, number, number] | null {
  const match = ISO_DATE_PATTERN.exec(value);
  if (!match) {
    return null;
  }
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/** True when the value is a real calendar date written `YYYY-MM-DD` (2026-02-30 is rejected). */
export function isIsoDate(value: unknown): value is IsoDate {
  if (typeof value !== 'string') {
    return false;
  }
  const parts = readParts(value);
  if (!parts) {
    return false;
  }
  const [year, month, day] = parts;
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

/** Converts an ISO date to a `Date` at UTC midnight. Throws on an invalid date. */
export function isoDateToUtc(value: IsoDate): Date {
  const parts = readParts(value);
  if (!parts || !isIsoDate(value)) {
    throw new RangeError(`Invalid ISO date: ${value}`);
  }
  const [year, month, day] = parts;
  return new Date(Date.UTC(year, month - 1, day));
}

/** Converts a `Date` (read in UTC) to an ISO date. */
export function utcToIsoDate(date: Date): IsoDate {
  return date.toISOString().slice(0, 10);
}

export function addDays(value: IsoDate, days: number): IsoDate {
  return utcToIsoDate(new Date(isoDateToUtc(value).getTime() + days * DAY_IN_MS));
}

/** Adds calendar months, keeping the day when possible (31 January + 1 month = 28 or 29 February). */
export function addMonths(value: IsoDate, months: number): IsoDate {
  const date = isoDateToUtc(value);
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + months;
  const lastDayOfTargetMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return utcToIsoDate(
    new Date(Date.UTC(year, month, Math.min(date.getUTCDate(), lastDayOfTargetMonth))),
  );
}

/** Number of days from `from` to `to`; for a stay, this is the number of nights. */
export function daysBetween(from: IsoDate, to: IsoDate): number {
  return Math.round((isoDateToUtc(to).getTime() - isoDateToUtc(from).getTime()) / DAY_IN_MS);
}

export function startOfMonth(value: IsoDate): IsoDate {
  return `${value.slice(0, 7)}-01`;
}

/** Current date and time of day in a given time zone (the hotel's, not the visitor's). */
export interface ZonedNow {
  date: IsoDate;
  /** Minutes elapsed since midnight, from 0 to 1439. */
  minutesOfDay: number;
}

export function nowInTimeZone(timeZone: string, now: Date = new Date()): ZonedNow {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const parts: Record<string, string> = {};
  for (const part of formatter.formatToParts(now)) {
    parts[part.type] = part.value;
  }
  return {
    date: `${parts['year'] ?? ''}-${parts['month'] ?? ''}-${parts['day'] ?? ''}`,
    minutesOfDay: Number(parts['hour']) * 60 + Number(parts['minute']),
  };
}
