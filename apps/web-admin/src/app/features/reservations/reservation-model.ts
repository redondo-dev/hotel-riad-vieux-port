import type { Role } from '../../core/auth/roles';

/**
 * Reservations as the API gives them (/api/v1/admin/reservations) and the pure rules of their
 * screens. Same rights as the API: hiding a button is a comfort, never a protection.
 */

export type ReservationStatus =
  | 'pending_payment'
  | 'confirmed'
  | 'checked_in'
  | 'checked_out'
  | 'cancelled'
  | 'no_show'
  | 'expired';

export type PaymentStatus =
  | 'unpaid'
  | 'partially_paid'
  | 'paid'
  | 'partially_refunded'
  | 'refunded';
export type RatePlan = 'flexible' | 'non_refundable';
export type Source = 'website' | 'phone' | 'desk';
export type SortOrder = 'checkIn' | 'created' | 'total';

export interface ReservationSummary {
  id: string;
  reference: string;
  customer: { id: string; firstName: string; lastName: string; email: string };
  checkIn: string;
  checkOut: string;
  nights: number;
  rooms: { categoryName: string; roomNumber: string | null }[];
  status: ReservationStatus;
  paymentStatus: PaymentStatus;
  totalCents: number;
  source: Source;
  createdAt: string;
}

export interface ReservationPage {
  items: ReservationSummary[];
  total: number;
  page: number;
  pageSize: number;
}

export interface Night {
  night: string;
  priceCents: number;
  rateLabel: string | null;
}

export interface ReservationRoom {
  id: string;
  category: { id: string; code: string; name: string };
  room: { id: string; number: string } | null;
  adults: number;
  childrenAges: number[];
  babyCot: boolean;
  subtotalCents: number;
  nights: Night[];
}

export interface Charge {
  id: string;
  kind: 'service' | 'tourist_tax' | 'cancellation_fee' | 'no_show_fee' | 'other';
  label: string;
  quantity: number;
  unitPriceCents: number;
  vatRate: number;
  totalCents: number;
}

export interface ReservationDetail {
  id: string;
  reference: string;
  status: ReservationStatus;
  paymentStatus: PaymentStatus;
  source: Source;
  ratePlan: RatePlan;
  checkIn: string;
  checkOut: string;
  nights: number;
  totalCents: number;
  freeCancellationUntil: string | null;
  customerMessage: string | null;
  internalNotes: string | null;
  cancelledAt: string | null;
  cancellationReason: string | null;
  cancellationFeeCents: number;
  version: number;
  createdAt: string;
  createdBy: { id: string; firstName: string; lastName: string } | null;
  customer: {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
    phone: string | null;
    preferredLanguage: 'fr' | 'en';
  };
  rooms: ReservationRoom[];
  charges: Charge[];
}

export interface ChangePreview {
  checkIn: string;
  checkOut: string;
  previousTotalCents: number;
  totalCents: number;
  differenceCents: number;
}

export interface CancellationQuote {
  feeCents: number;
  freeCancellationUntil: string | null;
  managementOnly: boolean;
}

export interface FreeRoom {
  id: string;
  number: string;
  floor: number;
  housekeepingStatus: 'clean' | 'dirty';
}

export const STATUS_LABELS: Record<ReservationStatus, string> = {
  pending_payment: 'En attente',
  confirmed: 'Confirmée',
  checked_in: 'Arrivé',
  checked_out: 'Parti',
  cancelled: 'Annulée',
  no_show: 'Non présenté',
  expired: 'Expirée',
};

export const PAYMENT_LABELS: Record<PaymentStatus, string> = {
  unpaid: 'Non payé',
  partially_paid: 'Acompte',
  paid: 'Payé',
  partially_refunded: 'Remboursé en partie',
  refunded: 'Remboursé',
};

export const SOURCE_LABELS: Record<Source, string> = {
  website: 'Site',
  phone: 'Téléphone',
  desk: 'Comptoir',
};

export const RATE_PLAN_LABELS: Record<RatePlan, string> = {
  flexible: 'Tarif flexible',
  non_refundable: 'Non remboursable',
};

/** Colours of the statuses (UI/UX specification, section 3). */
export function statusBadge(status: ReservationStatus): string {
  switch (status) {
    case 'pending_payment':
      return 'badge-warning';
    case 'confirmed':
      return 'badge-info';
    case 'checked_in':
      return 'badge-ok';
    case 'checked_out':
      return 'badge-neutral';
    default:
      return 'badge-off';
  }
}

export function paymentBadge(status: PaymentStatus): string {
  return status === 'paid' ? 'badge-ok' : status === 'unpaid' ? 'badge-warning' : 'badge-neutral';
}

// --- Rights ---

export function canChangeStay(detail: ReservationDetail, role: Role | undefined): boolean {
  if (detail.status !== 'confirmed') {
    return false;
  }
  return detail.ratePlan === 'flexible' || role === 'direction';
}

export function canCancel(detail: ReservationDetail, role: Role | undefined): boolean {
  if (detail.status !== 'confirmed' && detail.status !== 'pending_payment') {
    return false;
  }
  return detail.ratePlan === 'flexible' || role === 'direction';
}

export function canAssignRoom(detail: ReservationDetail): boolean {
  return detail.status === 'confirmed' || detail.status === 'checked_in';
}

/** Only the management waives a cancellation fee or touches a non-refundable stay (RM-18). */
export function isManagement(role: Role | undefined): boolean {
  return role === 'direction';
}

// --- Formatting ---

const EUROS = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' });

/** 9550 → « 95,50 € ». */
export function formatEuros(cents: number): string {
  return EUROS.format(cents / 100);
}

/** 16200 → « +162,00 € »; -2000 → « −20,00 € »; 0 → « aucun changement ». */
export function formatDifference(cents: number): string {
  if (cents === 0) {
    return 'aucun changement';
  }
  return `${cents > 0 ? '+' : '−'}${formatEuros(Math.abs(cents))}`;
}

/** « 2034-05-10 » → « 10 mai 2034 »; `short` → « 10 mai ». */
export function formatDay(date: string, short = false): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString('fr-FR', {
    day: 'numeric',
    month: 'long',
    ...(short ? {} : { year: 'numeric' }),
    timeZone: 'UTC',
  });
}

/** « du 10 au 12 mai 2034 · 2 nuits » (arrival day, departure day). */
export function stayText(checkIn: string, checkOut: string, nights: number): string {
  const sameMonth = checkIn.slice(0, 7) === checkOut.slice(0, 7);
  const first = sameMonth ? String(Number(checkIn.slice(8))) : formatDay(checkIn, true);
  return `du ${first} au ${formatDay(checkOut)} · ${nights} nuit${nights > 1 ? 's' : ''}`;
}

/** « 8 mai 2034 à 15:00 », in the hotel's time zone. */
export function formatDateTime(iso: string): string {
  const date = new Date(iso);
  const day = date.toLocaleDateString('fr-FR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'Europe/Paris',
  });
  const time = date.toLocaleTimeString('fr-FR', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Paris',
  });
  return `${day} à ${time}`;
}

/** « 2 adultes, 2 enfants (6 et 3 ans) », « 1 adulte, bébé (1 an) ». */
export function guestsText(room: Pick<ReservationRoom, 'adults' | 'childrenAges'>): string {
  const adults = `${room.adults} adulte${room.adults > 1 ? 's' : ''}`;
  const count = room.childrenAges.length;
  if (count === 0) {
    return adults;
  }
  const ages = room.childrenAges.map(String);
  const last = ages.pop() ?? '';
  const agesText = ages.length === 0 ? last : `${ages.join(', ')} et ${last}`;
  const unit = room.childrenAges.length === 1 && room.childrenAges[0] === 1 ? 'an' : 'ans';
  return `${adults}, ${count} enfant${count > 1 ? 's' : ''} (${agesText} ${unit})`;
}

/** « Double standard · 214 », or « Double standard · à attribuer ». */
export function roomText(room: { categoryName: string; roomNumber: string | null }): string {
  return `${room.categoryName} · ${room.roomNumber ?? 'à attribuer'}`;
}

/** « Martin Jeanne ». */
export function customerName(customer: { firstName: string; lastName: string }): string {
  return `${customer.lastName} ${customer.firstName}`;
}

// --- Reading what the staff types ---

/**
 * « 6, 3 » or « 6 3 » → [6, 3]; « » → []. null when an age is not a whole number from 0 to
 * 17, or when there are more than 3 children.
 */
export function parseAges(text: string): number[] | null {
  const parts = text.split(/[\s,;]+/).filter((part) => part !== '');
  if (parts.length > 3 || parts.some((part) => !/^\d{1,2}$/.test(part))) {
    return null;
  }
  const ages = parts.map(Number);
  return ages.every((age) => age <= 17) ? ages : null;
}
