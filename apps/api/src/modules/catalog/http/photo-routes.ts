import {
  type NextFunction,
  type Request,
  type RequestHandler,
  type Response,
  Router,
} from 'express';
import multer from 'multer';
import { z } from 'zod';
import { AppError, ValidationError } from '../../../shared/domain/errors.ts';
import { validated } from '../../../shared/http/validate.ts';
import type { FileStorage } from '../../../shared/infrastructure/file-storage.ts';
import type { StaffUser } from '../../identity/domain/identity-rules.ts';
import { requireCsrf, requireRole } from '../../identity/http/guards.ts';
import type { CategoryPhotos } from '../application/category-photos.ts';
import { CATALOG_READ_ROLES, CATALOG_WRITE_ROLES } from '../domain/catalog-admin-rules.ts';
import {
  MAX_PHOTO_BYTES,
  MAX_PHOTOS_PER_CATEGORY,
  MEDIA_FILE,
  type PhotoWidth,
  photoKey,
} from '../domain/photo-rules.ts';

/**
 * Photos of the categories, under /api/v1/admin/catalog (staff session):
 *
 *   GET    /categories/:id/photos          in display order       (management, reception)
 *   POST   /categories/:id/photos          multipart: file, altFr, altEn       (management)
 *   PUT    /categories/:id/photos/order    { ids }: the new order              (management)
 *   PATCH  /photos/:photoId                { alt: { fr, en } }                 (management)
 *   DELETE /photos/:photoId                the row and its files               (management)
 *
 * And the files themselves, under /api/v1/public (no session, cached for a year):
 *
 *   GET    /media/<uuid>-<400|800|1600>.webp
 */

const id = z.uuid({ error: 'Identifiant invalide.' });
const categoryParams = z.strictObject({ id });
const photoParams = z.strictObject({ photoId: id });

function altText(): z.ZodString {
  return z
    .string()
    .trim()
    .min(1, { error: 'Texte alternatif obligatoire (accessibilité).' })
    .max(200, { error: '200 caractères au maximum.' });
}

const alt = z.strictObject({ fr: altText(), en: altText() });
/** The form fields that come with the file (multipart: every value is a text). */
const uploadFields = z.strictObject({ altFr: altText(), altEn: altText() });
const altChange = z.strictObject({ alt });
const order = z.strictObject({ ids: z.array(id).min(1).max(MAX_PHOTOS_PER_CATEGORY) });

class PhotoTooLargeError extends AppError {
  constructor() {
    super({
      status: 413,
      code: 'PHOTO_TOO_LARGE',
      title: 'Photo trop lourde',
      detail: `Une photo pèse ${MAX_PHOTO_BYTES / 1024 / 1024} Mo au plus.`,
    });
  }
}

/** One file, kept in memory (10 MB at most), and nothing else than the two texts. */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_PHOTO_BYTES, files: 1, fields: 2, fieldSize: 1024 },
}).single('file');

/** Turns the errors of multer into the errors of the API (413, 400). */
function receivePhoto(req: Request, res: Response, next: NextFunction): void {
  upload(req, res, (error: unknown) => {
    if (error instanceof multer.MulterError) {
      next(
        error.code === 'LIMIT_FILE_SIZE'
          ? new PhotoTooLargeError()
          : new ValidationError([{ field: 'file', message: 'Envoyez une seule photo.' }]),
      );
      return;
    }
    next(error);
  });
}

function actorOf(req: Request): StaffUser {
  const user = req.staffUser;
  if (user === undefined) {
    throw new Error('requireStaff doit précéder cette route');
  }
  return user;
}

function noStore(res: Response): void {
  res.set('Cache-Control', 'no-store');
}

/** `requireStaff` comes from the staff part of the API, which owns the sessions. */
export function photoAdminRouter(photos: CategoryPhotos, requireStaff: RequestHandler): Router {
  const router = Router();
  const readers = [requireStaff, requireRole(...CATALOG_READ_ROLES)];
  const writers = [requireStaff, requireRole(...CATALOG_WRITE_ROLES), requireCsrf];

  router.get(
    '/categories/:id/photos',
    ...readers,
    validated({ params: categoryParams }, async ({ params }, _req, res) => {
      noStore(res);
      res.json({ items: await photos.list(params.id) });
    }),
  );

  router.post(
    '/categories/:id/photos',
    ...writers,
    receivePhoto,
    validated(
      { params: categoryParams, body: uploadFields },
      async ({ params, body }, req, res) => {
        const file = req.file;
        if (file === undefined) {
          throw new ValidationError([{ field: 'file', message: 'Choisissez une photo.' }]);
        }
        const texts = { fr: body.altFr, en: body.altEn };
        const origin = { ip: req.ip };
        const items = await photos.add(actorOf(req), params.id, file.buffer, texts, origin);
        noStore(res);
        res.status(201).json({ items });
      },
    ),
  );

  router.put(
    '/categories/:id/photos/order',
    ...writers,
    validated({ params: categoryParams, body: order }, async ({ params, body }, req, res) => {
      const items = await photos.reorder(actorOf(req), params.id, body.ids, { ip: req.ip });
      noStore(res);
      res.json({ items });
    }),
  );

  router.patch(
    '/photos/:photoId',
    ...writers,
    validated({ params: photoParams, body: altChange }, async ({ params, body }, req, res) => {
      const items = await photos.changeAlt(actorOf(req), params.photoId, body.alt, { ip: req.ip });
      noStore(res);
      res.json({ items });
    }),
  );

  router.delete(
    '/photos/:photoId',
    ...writers,
    validated({ params: photoParams }, async ({ params }, req, res) => {
      const items = await photos.remove(actorOf(req), params.photoId, { ip: req.ip });
      noStore(res);
      res.json({ items });
    }),
  );

  return router;
}

/** A stored file never changes (a new photo has a new name): cached for a year. */
const MEDIA_CACHE = 'public, max-age=31536000, immutable';

/** The files of the photos, for the public site and the staff tool. */
export function mediaRouter(storage: FileStorage): Router {
  const router = Router();

  router.get('/media/:file', async (req, res) => {
    const match = MEDIA_FILE.exec(req.params['file'] ?? '');
    const data =
      match === null
        ? undefined
        : await storage.get(photoKey(match[1] ?? '', Number(match[2]) as PhotoWidth));
    if (data === undefined) {
      res.status(404).set('Cache-Control', 'no-store').end();
      return;
    }
    res.set({ 'Content-Type': 'image/webp', 'Cache-Control': MEDIA_CACHE }).send(data);
  });

  return router;
}
