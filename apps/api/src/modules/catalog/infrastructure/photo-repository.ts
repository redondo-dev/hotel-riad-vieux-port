import { QueryTypes, type Sequelize, type Transaction } from 'sequelize';
import type { LocalizedText } from './catalog-repository.ts';

/** A photo of a category as stored; its files are « photos/<id>-<width>.webp ». */
export interface PhotoRecord {
  id: string;
  categoryId: string;
  alt: LocalizedText;
  sortOrder: number;
  width: number | null;
  height: number | null;
}

interface PhotoRow {
  id: string;
  categoryId: string;
  altFr: string;
  altEn: string;
  sortOrder: number;
  width: number | null;
  height: number | null;
}

const SELECT = `
  SELECT id, category_id AS "categoryId", alt_fr AS "altFr", alt_en AS "altEn",
         sort_order AS "sortOrder", width, height
    FROM category_photos`;

function recordOf(row: PhotoRow): PhotoRecord {
  const { altFr, altEn, ...rest } = row;
  return { ...rest, alt: { fr: altFr, en: altEn } };
}

/** The photos of the categories in plain SQL with bound parameters. */
export class PhotoRepository {
  readonly #sequelize: Sequelize;

  constructor(sequelize: Sequelize) {
    this.#sequelize = sequelize;
  }

  async #select(sql: string, bind: unknown[], transaction?: Transaction): Promise<PhotoRecord[]> {
    const rows = await this.#sequelize.query<PhotoRow>(sql, {
      bind,
      type: QueryTypes.SELECT,
      ...(transaction === undefined ? {} : { transaction }),
    });
    return rows.map(recordOf);
  }

  /** In display order: the first one is the main photo. */
  ofCategory(categoryId: string, transaction?: Transaction): Promise<PhotoRecord[]> {
    return this.#select(
      `${SELECT} WHERE category_id = $1 ORDER BY sort_order, created_at, id`,
      [categoryId],
      transaction,
    );
  }

  /** The photos of every active category, for the public site, in display order. */
  ofActiveCategories(): Promise<PhotoRecord[]> {
    return this.#select(
      `${SELECT}
        WHERE category_id IN (SELECT id FROM room_categories WHERE is_active)
        ORDER BY category_id, sort_order, created_at, id`,
      [],
    );
  }

  /** The photo, locked until the end of the transaction. */
  async find(id: string, transaction: Transaction): Promise<PhotoRecord | undefined> {
    const rows = await this.#select(`${SELECT} WHERE id = $1 FOR UPDATE`, [id], transaction);
    return rows[0];
  }

  /** Locks the category: two photos added at once get two different places. */
  async lockCategory(categoryId: string, transaction: Transaction): Promise<boolean> {
    const rows = await this.#sequelize.query<{ id: string }>(
      'SELECT id FROM room_categories WHERE id = $1 FOR UPDATE',
      { bind: [categoryId], type: QueryTypes.SELECT, transaction },
    );
    return rows.length > 0;
  }

  /** Put last: the photo added is shown after the others until the order is changed. */
  async insert(
    photo: { id: string; categoryId: string; alt: LocalizedText; width: number; height: number },
    transaction: Transaction,
  ): Promise<void> {
    // The key of the files, « {width} » standing for 400, 800 or 1600.
    const storageKey = `photos/${photo.id}-{width}.webp`;
    const { id, categoryId, alt, width, height } = photo;
    await this.#sequelize.query(
      `INSERT INTO category_photos (id, category_id, storage_key, alt_fr, alt_en, sort_order,
                                    width, height)
       SELECT $1::uuid, $2::uuid, $3::text, $4::text, $5::text,
              coalesce(max(sort_order) + 1, 0), $6::int, $7::int
         FROM category_photos WHERE category_id = $2::uuid`,
      { bind: [id, categoryId, storageKey, alt.fr, alt.en, width, height], transaction },
    );
  }

  async updateAlt(id: string, alt: LocalizedText, transaction: Transaction): Promise<void> {
    await this.#sequelize.query(
      'UPDATE category_photos SET alt_fr = $2, alt_en = $3 WHERE id = $1',
      { bind: [id, alt.fr, alt.en], transaction },
    );
  }

  /** `ids` in the new order: the first one becomes the main photo. */
  async reorder(ids: readonly string[], transaction: Transaction): Promise<void> {
    await this.#sequelize.query(
      `UPDATE category_photos p SET sort_order = o.position - 1
         FROM unnest($1::uuid[]) WITH ORDINALITY AS o (id, position)
        WHERE p.id = o.id`,
      { bind: [ids], transaction },
    );
  }

  async delete(id: string, transaction: Transaction): Promise<void> {
    await this.#sequelize.query('DELETE FROM category_photos WHERE id = $1', {
      bind: [id],
      transaction,
    });
  }
}
