import { randomUUID } from 'node:crypto';
import type { Sequelize, Transaction } from 'sequelize';
import { ConflictError, NotFoundError, ValidationError } from '../../../shared/domain/errors.ts';
import { recordAudit } from '../../../shared/infrastructure/audit-log.ts';
import type { FileStorage } from '../../../shared/infrastructure/file-storage.ts';
import type { StaffUser } from '../../identity/domain/identity-rules.ts';
import {
  MAX_PHOTOS_PER_CATEGORY,
  orderProblem,
  PHOTO_WIDTHS,
  photoKey,
  type PhotoSource,
  photoSources,
} from '../domain/photo-rules.ts';
import type { LocalizedText } from '../infrastructure/catalog-repository.ts';
import { processPhoto } from '../infrastructure/photo-processor.ts';
import { type PhotoRecord, PhotoRepository } from '../infrastructure/photo-repository.ts';
import type { ActionOrigin } from './catalog-admin.ts';

/** A photo as the staff tool and the public site read it. */
export interface PhotoView {
  id: string;
  alt: LocalizedText;
  /** 0 for the main photo. */
  position: number;
  width: number | null;
  height: number | null;
  sources: PhotoSource[];
}

function viewOf(photo: PhotoRecord, position: number): PhotoView {
  return {
    id: photo.id,
    alt: photo.alt,
    position,
    width: photo.width,
    height: photo.height,
    sources: photoSources(photo.id),
  };
}

/**
 * The photos of the categories (module « Photos »): add (read, converted, stored), change the
 * texts, order, delete. Each change runs in one transaction with its line in the audit log.
 * The files are written before the row and removed after it: a failure never leaves a row
 * without its files (at worst, files without a row, which nobody can reach).
 */
export class CategoryPhotos {
  readonly #sequelize: Sequelize;
  readonly #repository: PhotoRepository;
  readonly #storage: FileStorage;

  constructor(sequelize: Sequelize, storage: FileStorage) {
    this.#sequelize = sequelize;
    this.#repository = new PhotoRepository(sequelize);
    this.#storage = storage;
  }

  async #audit(
    actor: StaffUser,
    action: string,
    categoryId: string,
    changes: Record<string, unknown>,
    origin: ActionOrigin,
    transaction: Transaction,
  ): Promise<void> {
    await recordAudit(
      this.#sequelize,
      {
        actorType: 'staff',
        actorUserId: actor.id,
        action,
        entityType: 'room_category',
        entityId: categoryId,
        changes,
        ipAddress: origin.ip,
      },
      transaction,
    );
  }

  async list(categoryId: string): Promise<PhotoView[]> {
    const photos = await this.#repository.ofCategory(categoryId);
    return photos.map(viewOf);
  }

  async #removeFiles(photoId: string): Promise<void> {
    for (const width of PHOTO_WIDTHS) {
      await this.#storage.remove(photoKey(photoId, width));
    }
  }

  async add(
    actor: StaffUser,
    categoryId: string,
    file: Buffer,
    alt: LocalizedText,
    origin: ActionOrigin,
  ): Promise<PhotoView[]> {
    const processed = await processPhoto(file);
    const id = randomUUID();
    for (const version of processed.versions) {
      await this.#storage.put(photoKey(id, version.width), version.data);
    }
    try {
      await this.#sequelize.transaction(async (transaction) => {
        if (!(await this.#repository.lockCategory(categoryId, transaction))) {
          throw new NotFoundError('Cette catégorie n’existe pas.');
        }
        const photos = await this.#repository.ofCategory(categoryId, transaction);
        if (photos.length >= MAX_PHOTOS_PER_CATEGORY) {
          throw new ConflictError(
            'TOO_MANY_PHOTOS',
            'Trop de photos',
            `${MAX_PHOTOS_PER_CATEGORY} photos au plus par catégorie : retirez-en une d’abord.`,
          );
        }
        const { width, height } = processed;
        await this.#repository.insert({ id, categoryId, alt, width, height }, transaction);
        const changes = { photoId: id, alt, width, height };
        await this.#audit(actor, 'photo.added', categoryId, changes, origin, transaction);
      });
    } catch (error) {
      await this.#removeFiles(id);
      throw error;
    }
    return this.list(categoryId);
  }

  async #photo(id: string, transaction: Transaction): Promise<PhotoRecord> {
    const photo = await this.#repository.find(id, transaction);
    if (photo === undefined) {
      throw new NotFoundError('Cette photo n’existe pas.');
    }
    return photo;
  }

  async changeAlt(
    actor: StaffUser,
    photoId: string,
    alt: LocalizedText,
    origin: ActionOrigin,
  ): Promise<PhotoView[]> {
    const categoryId = await this.#sequelize.transaction(async (transaction) => {
      const photo = await this.#photo(photoId, transaction);
      await this.#repository.updateAlt(photoId, alt, transaction);
      const changes = { photoId, alt: { from: photo.alt, to: alt } };
      await this.#audit(actor, 'photo.updated', photo.categoryId, changes, origin, transaction);
      return photo.categoryId;
    });
    return this.list(categoryId);
  }

  /** `ids`: every photo of the category in the new order; the first one is the main photo. */
  async reorder(
    actor: StaffUser,
    categoryId: string,
    ids: string[],
    origin: ActionOrigin,
  ): Promise<PhotoView[]> {
    await this.#sequelize.transaction(async (transaction) => {
      if (!(await this.#repository.lockCategory(categoryId, transaction))) {
        throw new NotFoundError('Cette catégorie n’existe pas.');
      }
      const current = await this.#repository.ofCategory(categoryId, transaction);
      const problem = orderProblem(
        current.map((photo) => photo.id),
        ids,
      );
      if (problem !== null) {
        throw new ValidationError([{ field: 'ids', message: problem }]);
      }
      await this.#repository.reorder(ids, transaction);
      await this.#audit(actor, 'photo.reordered', categoryId, { ids }, origin, transaction);
    });
    return this.list(categoryId);
  }

  async remove(actor: StaffUser, photoId: string, origin: ActionOrigin): Promise<PhotoView[]> {
    const categoryId = await this.#sequelize.transaction(async (transaction) => {
      const photo = await this.#photo(photoId, transaction);
      await this.#repository.delete(photoId, transaction);
      const changes = { photoId, alt: photo.alt };
      await this.#audit(actor, 'photo.deleted', photo.categoryId, changes, origin, transaction);
      return photo.categoryId;
    });
    // After the commit: a deletion rolled back keeps its files.
    await this.#removeFiles(photoId);
    return this.list(categoryId);
  }
}
