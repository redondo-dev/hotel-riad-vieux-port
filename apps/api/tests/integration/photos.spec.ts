import sharp from 'sharp';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ADMIN, IdentityHarness, logIn } from '../support/identity-harness.ts';
import { hasTestDatabase } from '../support/test-database.ts';

/**
 * Photos of the categories against the test database and a temporary folder: sending (format
 * read from the content, size limit), the three WebP versions served to the public, the texts,
 * the order and the deletion. Skipped without TEST_DATABASE_URL.
 *
 * This file owns the category « photo-double ».
 */

type Session = Awaited<ReturnType<typeof logIn>>;

interface Photo {
  id: string;
  alt: { fr: string; en: string };
  position: number;
  width: number;
  height: number;
  sources: { width: number; url: string }[];
}

/** A plain picture made on the spot: 2000 × 1000 pixels, PNG. */
function picture(color: string): Promise<Buffer> {
  return sharp({ create: { width: 2000, height: 1000, channels: 3, background: color } })
    .png()
    .toBuffer();
}

describe.skipIf(!hasTestDatabase)('photos of the categories', () => {
  let harness: IdentityHarness;
  let app: ReturnType<IdentityHarness['app']>;
  let manager: Session;
  let reception: Session;
  let categoryId: string;
  let photos: Photo[] = [];

  function send(method: 'post' | 'put' | 'patch' | 'delete', path: string): request.Test {
    return manager.agent[method](`${ADMIN}/catalog${path}`).set('X-CSRF-Token', manager.csrfToken);
  }

  async function upload(file: Buffer, name: string): Promise<request.Response> {
    return send('post', `/categories/${categoryId}/photos`)
      .field('altFr', `Chambre ${name}`)
      .field('altEn', `Room ${name}`)
      .attach('file', file, { filename: `${name}.png`, contentType: 'image/png' });
  }

  beforeAll(async () => {
    harness = new IdentityHarness();
    app = harness.app();
    manager = await logIn(app, await harness.createStaff('direction'));
    reception = await logIn(app, await harness.createStaff('reception'));
    const rows = await harness.rows<{ id: string }>(
      `INSERT INTO room_categories (
         code, name_fr, name_en, description_fr, description_en, beds_fr, beds_en, area_sqm,
         max_occupancy, base_occupancy, base_price_cents)
       VALUES ('photo-double', 'Double photo', 'Double', 'D', 'D', 'L', 'B', 18, 2, 2, 9000)
       RETURNING id`,
    );
    categoryId = rows[0]?.id ?? '';
  });

  afterAll(async () => {
    await harness.close();
  });

  it('converts a photo into three WebP versions, served to the public for a year', async () => {
    const response = await upload(await picture('#1f4e6b'), 'bleue');
    expect(response.status).toBe(201);
    photos = response.body.items as Photo[];
    expect(photos).toHaveLength(1);
    // Never enlarged: 2000 pixels give 1600 at most, the proportions kept.
    expect([photos[0]?.width, photos[0]?.height]).toEqual([1600, 800]);
    expect(photos[0]?.alt).toEqual({ fr: 'Chambre bleue', en: 'Room bleue' });

    const url = photos[0]?.sources.find((source) => source.width === 400)?.url ?? '';
    const file = await request(app).get(url);
    expect(file.status).toBe(200);
    expect(file.headers['content-type']).toBe('image/webp');
    expect(file.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    const size = await sharp(file.body as Buffer).metadata();
    expect([size.format, size.width]).toEqual(['webp', 400]);
  });

  it('reads the format from the content, and refuses a photo too heavy', async () => {
    const text = await send('post', `/categories/${categoryId}/photos`)
      .field('altFr', 'Faux')
      .field('altEn', 'Fake')
      .attach('file', Buffer.from('pas une image'), { filename: 'faux.jpg' });
    expect(text.status).toBe(400);
    expect(text.body.errors[0].field).toBe('file');

    const heavy = await upload(Buffer.alloc(10 * 1024 * 1024 + 1), 'lourde');
    expect(heavy.status).toBe(413);
    expect(heavy.body.code).toBe('PHOTO_TOO_LARGE');
  });

  it('asks for both texts, and keeps the photos to the management', async () => {
    const missing = await send('post', `/categories/${categoryId}/photos`)
      .field('altFr', 'Seulement en français')
      .attach('file', await picture('#b4552f'), { filename: 'x.png' });
    expect(missing.status).toBe(400);

    const read = await reception.agent.get(`${ADMIN}/catalog/categories/${categoryId}/photos`);
    expect(read.status).toBe(200);
    const write = await reception.agent
      .post(`${ADMIN}/catalog/categories/${categoryId}/photos`)
      .set('X-CSRF-Token', reception.csrfToken);
    expect(write.status).toBe(403);
  });

  it('puts a new photo last, then lets the order and the texts change', async () => {
    const second = await upload(await picture('#2f5d50'), 'verte');
    photos = second.body.items as Photo[];
    expect(photos.map((photo) => photo.alt.fr)).toEqual(['Chambre bleue', 'Chambre verte']);

    const ids = photos.map((photo) => photo.id).reverse();
    const reordered = await send('put', `/categories/${categoryId}/photos/order`).send({ ids });
    expect(reordered.status).toBe(200);
    expect((reordered.body.items as Photo[]).map((photo) => photo.id)).toEqual(ids);

    const wrong = await send('put', `/categories/${categoryId}/photos/order`).send({
      ids: [ids[0]],
    });
    expect(wrong.status).toBe(400);

    const alt = { fr: 'Le lit, côté fenêtre', en: 'The bed, by the window' };
    const renamed = await send('patch', `/photos/${ids[0]}`).send({ alt });
    expect((renamed.body.items as Photo[])[0]?.alt).toEqual(alt);
  });

  it('deletes a photo and its files', async () => {
    const [first] = photos;
    const removed = await send('delete', `/photos/${first?.id}`);
    expect(removed.status).toBe(200);
    expect((removed.body.items as Photo[]).map((photo) => photo.id)).not.toContain(first?.id);

    const url = first?.sources[0]?.url ?? '';
    expect((await request(app).get(url)).status).toBe(404);
    expect((await request(app).get('/api/v1/public/media/secret.webp')).status).toBe(404);
  });
});
