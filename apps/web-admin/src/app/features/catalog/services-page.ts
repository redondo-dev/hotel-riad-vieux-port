import {
  ChangeDetectionStrategy,
  Component,
  computed,
  type ElementRef,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { LucideCircleAlert, LucidePencil } from '@lucide/angular';
import { fieldMessage, type Problem, toProblem } from '../../core/api/problem';
import { SessionService } from '../../core/auth/session.service';
import { NotifierService } from '../../core/notifier.service';
import { CatalogApi } from './catalog-api';
import {
  canEditCatalog,
  eurosInputValue,
  formatEuros,
  formatPercent,
  type HotelService,
  parseEuros,
  parsePercent,
  percentInputValue,
  PRICING_UNIT_LABELS,
  PRICING_UNITS,
  type PricingUnit,
} from './catalog-model';

interface Draft {
  nameFr: string;
  nameEn: string;
  price: string;
  pricingUnit: PricingUnit;
  vatRate: string;
  bookableOnline: boolean;
}

/**
 * Services and options sold by the hotel (UI/UX specification, section 5.K): price including
 * VAT, pricing unit, VAT rate, and whether guests can add them when booking online. The
 * management changes them and deactivates them after confirmation (never deleted: invoices
 * refer to them). The highlights of the hotel shown on the public site are not managed here.
 */
@Component({
  selector: 'adm-services-page',
  imports: [LucidePencil, LucideCircleAlert],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (problem(); as error) {
      <div class="alert-error" role="alert">
        <svg lucideCircleAlert class="mt-0.5 shrink-0 text-danger"></svg>
        <div>
          <p>
            <span class="font-semibold">{{ error.title }}.</span> {{ error.detail }}
          </p>
          <button type="button" class="-ml-3 btn-quiet" (click)="load()">Réessayer</button>
        </div>
      </div>
    } @else if (loading()) {
      <p class="text-muted" role="status">Chargement des services…</p>
    } @else {
      <p class="mb-4 text-muted">Prix TTC. Une modification ne touche que les prochaines ventes.</p>
      <div class="card overflow-x-auto">
        <table class="w-full text-left text-sm">
          <caption class="sr-only">
            Services et options
          </caption>
          <thead class="border-b border-line text-muted">
            <tr>
              <th scope="col" class="px-4 py-3 font-semibold">Service</th>
              <th scope="col" class="px-4 py-3 font-semibold">Prix</th>
              <th scope="col" class="px-4 py-3 font-semibold">TVA</th>
              <th scope="col" class="px-4 py-3 font-semibold">En ligne</th>
              <th scope="col" class="px-4 py-3 font-semibold">État</th>
              @if (canEdit()) {
                <th scope="col" class="px-4 py-3 font-semibold">
                  <span class="sr-only">Actions</span>
                </th>
              }
            </tr>
          </thead>
          <tbody>
            @for (service of services(); track service.id) {
              <tr class="border-b border-line last:border-0">
                <th scope="row" class="px-4 py-3">
                  <span class="block font-semibold">{{ service.name.fr }}</span>
                  <span class="block font-normal text-muted">{{ service.name.en }}</span>
                </th>
                <td class="px-4 py-3">
                  <span class="whitespace-nowrap">{{ euros(service.unitPriceCents) }}</span>
                  {{ unitLabel(service.pricingUnit) }}
                </td>
                <td class="px-4 py-3 whitespace-nowrap">{{ vat(service.vatRate) }}</td>
                <td class="px-4 py-3">{{ service.bookableOnline ? 'Oui' : 'Non' }}</td>
                <td class="px-4 py-3">
                  @if (service.isActive) {
                    <span class="badge-ok">Actif</span>
                  } @else {
                    <span class="badge-off">Désactivé</span>
                  }
                </td>
                @if (canEdit()) {
                  <td class="px-4 py-2 text-right whitespace-nowrap">
                    <button type="button" class="btn-quiet" (click)="openEdit(service)">
                      <svg lucidePencil></svg>
                      Modifier
                      <span class="sr-only">{{ service.name.fr }}</span>
                    </button>
                    <button type="button" class="btn-quiet" (click)="askToggle(service)">
                      {{ service.isActive ? 'Désactiver' : 'Réactiver' }}
                      <span class="sr-only">{{ service.name.fr }}</span>
                    </button>
                  </td>
                }
              </tr>
            } @empty {
              <tr>
                <td colspan="6" class="px-4 py-6 text-center text-muted">Aucun service.</td>
              </tr>
            }
          </tbody>
        </table>
      </div>
    }

    <!-- Edit -->
    <dialog
      #formDialog
      class="dialog-panel"
      aria-labelledby="titre-service"
      (close)="formProblem.set(null)"
    >
      @if (editing(); as service) {
        <form
          class="flex flex-col gap-5 p-6"
          novalidate
          (submit)="$event.preventDefault(); save(service)"
        >
          <h2 id="titre-service" class="text-lg font-semibold">
            Modifier « {{ service.name.fr }} »
          </h2>
          @if (formProblem(); as error) {
            @if (error.errors.length === 0) {
              <div class="alert-error" role="alert">
                <svg lucideCircleAlert class="mt-0.5 shrink-0 text-danger"></svg>
                <p>
                  <span class="font-semibold">{{ error.title }}.</span> {{ error.detail }}
                </p>
              </div>
            }
          }
          <div class="grid gap-4 sm:grid-cols-2">
            <div class="flex flex-col gap-1.5">
              <label class="field-label" for="service-nom-fr">Nom en français</label>
              <input
                id="service-nom-fr"
                class="field-control"
                autocomplete="off"
                [attr.aria-invalid]="error('name.fr') ? true : null"
                [value]="draft().nameFr"
                (input)="patch({ nameFr: valueOf($event) })"
              />
              @if (error('name.fr'); as message) {
                <p class="field-error">{{ message }}</p>
              }
            </div>
            <div class="flex flex-col gap-1.5">
              <label class="field-label" for="service-nom-en">Nom en anglais</label>
              <input
                id="service-nom-en"
                class="field-control"
                autocomplete="off"
                [attr.aria-invalid]="error('name.en') ? true : null"
                [value]="draft().nameEn"
                (input)="patch({ nameEn: valueOf($event) })"
              />
              @if (error('name.en'); as message) {
                <p class="field-error">{{ message }}</p>
              }
            </div>
            <div class="flex flex-col gap-1.5">
              <label class="field-label" for="service-prix">Prix TTC (€)</label>
              <input
                id="service-prix"
                class="field-control"
                inputmode="decimal"
                autocomplete="off"
                [attr.aria-invalid]="error('unitPriceCents') ? true : null"
                [value]="draft().price"
                (input)="patch({ price: valueOf($event) })"
              />
              @if (error('unitPriceCents'); as message) {
                <p class="field-error">{{ message }}</p>
              }
            </div>
            <div class="flex flex-col gap-1.5">
              <label class="field-label" for="service-unite">Unité de prix</label>
              <select id="service-unite" class="field-control" (change)="unitOf($event)">
                @for (unit of units; track unit) {
                  <option [value]="unit" [selected]="draft().pricingUnit === unit">
                    {{ unitLabel(unit) }}
                  </option>
                }
              </select>
            </div>
            <div class="flex flex-col gap-1.5">
              <label class="field-label" for="service-tva">Taux de TVA (%)</label>
              <input
                id="service-tva"
                class="field-control"
                inputmode="decimal"
                autocomplete="off"
                [attr.aria-invalid]="error('vatRate') ? true : null"
                [value]="draft().vatRate"
                (input)="patch({ vatRate: valueOf($event) })"
              />
              @if (error('vatRate'); as message) {
                <p class="field-error">{{ message }}</p>
              }
            </div>
          </div>
          <label class="flex min-h-11 items-center gap-3">
            <input
              type="checkbox"
              class="size-5 accent-port"
              [checked]="draft().bookableOnline"
              (change)="patch({ bookableOnline: !draft().bookableOnline })"
            />
            Proposé lors de la réservation en ligne
          </label>
          <div class="flex flex-wrap justify-end gap-3">
            <button type="button" class="btn-quiet" (click)="formDialog.close()">Retour</button>
            <button type="submit" class="btn-primary" [disabled]="saving()">Enregistrer</button>
          </div>
        </form>
      }
    </dialog>

    <!-- Confirmation: deactivate or reactivate -->
    <dialog #confirmDialog class="dialog-panel" aria-labelledby="titre-confirmation">
      @if (toggling(); as service) {
        <div class="flex flex-col gap-4 p-6">
          <h2 id="titre-confirmation" class="text-lg font-semibold">
            {{ service.isActive ? 'Désactiver' : 'Réactiver' }} « {{ service.name.fr }} » ?
          </h2>
          @if (service.isActive) {
            <p>Il ne sera plus vendu. Les ventes et factures passées ne changent pas.</p>
          } @else {
            <p>Il sera de nouveau vendu.</p>
          }
          <div class="flex flex-wrap justify-end gap-3">
            <button type="button" class="btn-quiet" (click)="confirmDialog.close()">Retour</button>
            <button
              type="button"
              [class]="service.isActive ? 'btn-danger' : 'btn-primary'"
              [disabled]="saving()"
              (click)="confirmToggle(service)"
            >
              {{ service.isActive ? 'Désactiver' : 'Réactiver' }}
            </button>
          </div>
        </div>
      }
    </dialog>
  `,
})
export class ServicesPage {
  private readonly catalog = inject(CatalogApi);
  private readonly session = inject(SessionService);
  private readonly notifier = inject(NotifierService);

  private readonly formDialog = viewChild.required<ElementRef<HTMLDialogElement>>('formDialog');
  private readonly confirmDialog =
    viewChild.required<ElementRef<HTMLDialogElement>>('confirmDialog');

  protected readonly units = PRICING_UNITS;
  protected readonly services = signal<HotelService[]>([]);
  protected readonly loading = signal(true);
  protected readonly problem = signal<Problem | null>(null);
  protected readonly canEdit = computed(() => canEditCatalog(this.session.user()?.role));

  protected readonly editing = signal<HotelService | null>(null);
  protected readonly draft = signal<Draft>({
    nameFr: '',
    nameEn: '',
    price: '',
    pricingUnit: 'per_unit',
    vatRate: '',
    bookableOnline: false,
  });
  protected readonly formProblem = signal<Problem | null>(null);
  protected readonly localErrors = signal<Record<string, string>>({});
  protected readonly toggling = signal<HotelService | null>(null);
  protected readonly saving = signal(false);

  constructor() {
    void this.load();
  }

  protected async load(): Promise<void> {
    this.loading.set(true);
    this.problem.set(null);
    try {
      this.services.set(await this.catalog.services());
    } catch (error) {
      this.problem.set(toProblem(error));
    } finally {
      this.loading.set(false);
    }
  }

  protected euros(cents: number): string {
    return formatEuros(cents);
  }

  protected vat(rate: number): string {
    return formatPercent(rate).replace('+', '');
  }

  protected unitLabel(unit: PricingUnit): string {
    return PRICING_UNIT_LABELS[unit];
  }

  protected valueOf(event: Event): string {
    return (event.target as HTMLInputElement | HTMLSelectElement).value;
  }

  protected unitOf(event: Event): void {
    const value = this.valueOf(event);
    const unit = PRICING_UNITS.find((item) => item === value);
    if (unit !== undefined) {
      this.patch({ pricingUnit: unit });
    }
  }

  protected error(field: string): string | undefined {
    return this.localErrors()[field] ?? fieldMessage(this.formProblem(), field);
  }

  protected patch(changes: Partial<Draft>): void {
    this.draft.update((draft) => ({ ...draft, ...changes }));
  }

  protected openEdit(service: HotelService): void {
    this.editing.set(service);
    this.draft.set({
      nameFr: service.name.fr,
      nameEn: service.name.en,
      price: eurosInputValue(service.unitPriceCents),
      pricingUnit: service.pricingUnit,
      vatRate: percentInputValue(service.vatRate),
      bookableOnline: service.bookableOnline,
    });
    this.localErrors.set({});
    this.formProblem.set(null);
    this.formDialog().nativeElement.showModal();
  }

  protected async save(service: HotelService): Promise<void> {
    const draft = this.draft();
    const unitPriceCents = parseEuros(draft.price);
    const vatRate = parsePercent(draft.vatRate);
    const errors: Record<string, string> = {};
    if (unitPriceCents === null) {
      errors['unitPriceCents'] = 'Montant attendu, par exemple 14 ou 14,50.';
    }
    if (vatRate === null) {
      errors['vatRate'] = 'Taux attendu, par exemple 10 ou 5,5.';
    }
    this.localErrors.set(errors);
    this.formProblem.set(null);
    if (unitPriceCents === null || vatRate === null) {
      return;
    }
    this.saving.set(true);
    try {
      await this.catalog.updateService(service.id, {
        name: { fr: draft.nameFr.trim(), en: draft.nameEn.trim() },
        unitPriceCents,
        pricingUnit: draft.pricingUnit,
        vatRate,
        bookableOnline: draft.bookableOnline,
      });
      this.notifier.success(`« ${draft.nameFr.trim()} » est enregistré.`);
      this.formDialog().nativeElement.close();
      await this.load();
    } catch (error) {
      this.formProblem.set(toProblem(error));
    } finally {
      this.saving.set(false);
    }
  }

  protected askToggle(service: HotelService): void {
    this.toggling.set(service);
    this.confirmDialog().nativeElement.showModal();
  }

  protected async confirmToggle(service: HotelService): Promise<void> {
    this.saving.set(true);
    try {
      await this.catalog.updateService(service.id, { isActive: !service.isActive });
      this.notifier.success(
        service.isActive
          ? `« ${service.name.fr} » est désactivé.`
          : `« ${service.name.fr} » est réactivé.`,
      );
      await this.load();
    } catch (error) {
      this.notifier.error(toProblem(error).detail);
    } finally {
      this.saving.set(false);
      this.confirmDialog().nativeElement.close();
    }
  }
}
