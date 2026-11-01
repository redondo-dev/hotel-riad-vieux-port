/**
 * Rules of the staff accounts (architecture, section 8 « Sécurité »). Pure values, no I/O.
 */

/** Staff roles, as stored in users.role. */
export const ROLES = ['direction', 'reception', 'housekeeping', 'technician'] as const;
export type Role = (typeof ROLES)[number];

/** Role allowed to manage the staff accounts. */
export const ACCOUNT_MANAGER_ROLE: Role = 'direction';

/** Password length: 12 characters minimum (architecture); 128 maximum, to bound hashing cost. */
export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;

/** After this many wrong passwords in a row, the account is locked for LOCK_DURATION_MINUTES. */
export const MAX_FAILED_LOGINS = 5;
export const LOCK_DURATION_MINUTES = 15;

/** Validity of the e-mailed links: forgotten password, and first password of a new account. */
export const RESET_LINK_MINUTES = 30;
export const INVITATION_LINK_MINUTES = 48 * 60;

/** A staff member as seen by the rest of the API once logged in. */
export interface StaffUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: Role;
}
