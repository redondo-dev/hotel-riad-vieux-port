import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ADMIN_API } from '../../core/api/api';
import type {
  AmenityCode,
  Category,
  HotelService,
  LocalizedText,
  PricingUnit,
  RatePeriod,
  RatePeriodKind,
  Room,
  SalesClosure,
} from './catalog-model';
import type { Photo } from './photo-model';

export interface CategoryChanges {
  name?: LocalizedText;
  description?: LocalizedText;
  beds?: LocalizedText;
  areaSqm?: number;
  maxOccupancy?: number;
  baseOccupancy?: number;
  basePriceCents?: number;
  extraAdultCents?: number;
  extraChildCents?: number;
  amenities?: AmenityCode[];
  sortOrder?: number;
  isActive?: boolean;
}

export interface RoomInput {
  number: string;
  floor: number;
  categoryId: string;
}

export interface RatePeriodInput {
  name: string;
  kind: RatePeriodKind;
  firstNight: string;
  lastNight: string;
  adjustmentPct: number;
  categoryId: string | null;
}

export interface SalesClosureInput {
  categoryId: string;
  firstNight: string;
  lastNight: string;
  reason: string | null;
}

export interface ServiceChanges {
  name?: LocalizedText;
  unitPriceCents?: number;
  pricingUnit?: PricingUnit;
  vatRate?: number;
  bookableOnline?: boolean;
  isActive?: boolean;
}

interface Items<T> {
  items: T[];
}

/**
 * Calls of the catalogue management (API: /api/v1/admin/catalog). The session cookie and the
 * anti-CSRF token are added by the interceptor. Errors are thrown as they come: the screens turn
 * them into messages with toProblem().
 */
@Injectable({ providedIn: 'root' })
export class CatalogApi {
  private readonly http = inject(HttpClient);
  private readonly base = `${inject(ADMIN_API)}/catalog`;

  async categories(): Promise<Category[]> {
    const result = await firstValueFrom(this.http.get<Items<Category>>(`${this.base}/categories`));
    return result.items;
  }

  updateCategory(id: string, changes: CategoryChanges): Promise<Category> {
    return firstValueFrom(this.http.patch<Category>(`${this.base}/categories/${id}`, changes));
  }

  async rooms(): Promise<Room[]> {
    const result = await firstValueFrom(this.http.get<Items<Room>>(`${this.base}/rooms`));
    return result.items;
  }

  createRoom(input: RoomInput): Promise<Room> {
    return firstValueFrom(this.http.post<Room>(`${this.base}/rooms`, input));
  }

  updateRoom(id: string, changes: Partial<RoomInput> & { isActive?: boolean }): Promise<Room> {
    return firstValueFrom(this.http.patch<Room>(`${this.base}/rooms/${id}`, changes));
  }

  async ratePeriods(includePast: boolean): Promise<RatePeriod[]> {
    const query = includePast ? '?includePast=true' : '';
    const result = await firstValueFrom(
      this.http.get<Items<RatePeriod>>(`${this.base}/rate-periods${query}`),
    );
    return result.items;
  }

  createRatePeriod(input: RatePeriodInput): Promise<RatePeriod> {
    return firstValueFrom(this.http.post<RatePeriod>(`${this.base}/rate-periods`, input));
  }

  updateRatePeriod(id: string, input: RatePeriodInput): Promise<RatePeriod> {
    return firstValueFrom(this.http.patch<RatePeriod>(`${this.base}/rate-periods/${id}`, input));
  }

  async deleteRatePeriod(id: string): Promise<void> {
    await firstValueFrom(this.http.delete(`${this.base}/rate-periods/${id}`));
  }

  async salesClosures(): Promise<SalesClosure[]> {
    const result = await firstValueFrom(
      this.http.get<Items<SalesClosure>>(`${this.base}/sales-closures`),
    );
    return result.items;
  }

  createSalesClosure(input: SalesClosureInput): Promise<SalesClosure> {
    return firstValueFrom(this.http.post<SalesClosure>(`${this.base}/sales-closures`, input));
  }

  async deleteSalesClosure(id: string): Promise<void> {
    await firstValueFrom(this.http.delete(`${this.base}/sales-closures/${id}`));
  }

  async services(): Promise<HotelService[]> {
    const result = await firstValueFrom(
      this.http.get<Items<HotelService>>(`${this.base}/services`),
    );
    return result.items;
  }

  updateService(id: string, changes: ServiceChanges): Promise<HotelService> {
    return firstValueFrom(this.http.patch<HotelService>(`${this.base}/services/${id}`, changes));
  }

  // --- Photos of a category: every call answers the photos of the category, in order ---

  async photos(categoryId: string): Promise<Photo[]> {
    const result = await firstValueFrom(
      this.http.get<Items<Photo>>(`${this.base}/categories/${categoryId}/photos`),
    );
    return result.items;
  }

  /** Multipart: the browser sets the content type (with its boundary) itself. */
  async addPhoto(categoryId: string, file: File, alt: LocalizedText): Promise<Photo[]> {
    const form = new FormData();
    form.append('altFr', alt.fr);
    form.append('altEn', alt.en);
    form.append('file', file);
    const result = await firstValueFrom(
      this.http.post<Items<Photo>>(`${this.base}/categories/${categoryId}/photos`, form),
    );
    return result.items;
  }

  /** `ids`: every photo of the category in the new order; the first one is the main photo. */
  async reorderPhotos(categoryId: string, ids: string[]): Promise<Photo[]> {
    const result = await firstValueFrom(
      this.http.put<Items<Photo>>(`${this.base}/categories/${categoryId}/photos/order`, { ids }),
    );
    return result.items;
  }

  async changePhotoAlt(photoId: string, alt: LocalizedText): Promise<Photo[]> {
    const result = await firstValueFrom(
      this.http.patch<Items<Photo>>(`${this.base}/photos/${photoId}`, { alt }),
    );
    return result.items;
  }

  async removePhoto(photoId: string): Promise<Photo[]> {
    const result = await firstValueFrom(
      this.http.delete<Items<Photo>>(`${this.base}/photos/${photoId}`),
    );
    return result.items;
  }
}
