import { randomBytes } from 'node:crypto';
import argon2 from 'argon2';

/**
 * Password hashing with Argon2id, the method recommended today (architecture, section 6).
 * Only the hash is stored; it contains its own random salt and parameters.
 */

export function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, { type: argon2.argon2id });
}

/** False for a wrong password AND for an unreadable hash: never throws. */
export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}

/** Hash of a random secret nobody knows: the account cannot log in until a password is set. */
export function unusablePasswordHash(): Promise<string> {
  return hashPassword(randomBytes(48).toString('base64url'));
}

let dummyHash: Promise<string> | undefined;

/**
 * Spends the same time as a real check when the account does not exist or cannot log in, so
 * that the response time does not reveal which e-mail addresses have an account.
 */
export async function verifyAgainstDummy(password: string): Promise<void> {
  dummyHash ??= unusablePasswordHash();
  await verifyPassword(await dummyHash, password);
}
