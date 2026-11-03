import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';

/**
 * Storage of the files the staff sends (photos), behind an interface so that the actual service
 * can change without touching the code that stores: a local folder today, an S3-compatible
 * storage when the site goes online (architecture, section 9).
 *
 * Keys are chosen by the API, never by the person who sends the file: « photos/<uuid>-800.webp ».
 */
export interface FileStorage {
  put(key: string, data: Buffer): Promise<void>;
  /** undefined when there is no such file. */
  get(key: string): Promise<Buffer | undefined>;
  /** Nothing happens when there is no such file. */
  remove(key: string): Promise<void>;
}

const KEY = /^[a-z0-9]+(\/[a-z0-9][a-z0-9.-]*)+$/;

/** A key of the API, checked again here: never a path that leaves the storage folder. */
export function assertStorageKey(key: string): void {
  if (!KEY.test(key) || key.includes('..')) {
    throw new Error(`clé de stockage invalide : ${key}`);
  }
}

function isMissing(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}

/**
 * Files kept in `directory` (ignored by Git). For development and the tests; in production only
 * on a persistent disk, set with STORAGE_DIR.
 */
export function localFileStorage(directory: string): FileStorage {
  const root = resolve(directory);
  const pathOf = (key: string): string => {
    assertStorageKey(key);
    const path = resolve(join(root, key));
    if (!path.startsWith(root + sep)) {
      throw new Error(`clé de stockage hors du dossier : ${key}`);
    }
    return path;
  };
  return {
    async put(key, data) {
      const path = pathOf(key);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, data);
    },
    async get(key) {
      try {
        return await readFile(pathOf(key));
      } catch (error) {
        if (isMissing(error)) {
          return undefined;
        }
        throw error;
      }
    },
    async remove(key) {
      await rm(pathOf(key), { force: true });
    },
  };
}
