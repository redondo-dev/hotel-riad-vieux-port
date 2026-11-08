import {
  ChangeDetectionStrategy,
  Component,
  type ElementRef,
  inject,
  input,
  type OnInit,
  signal,
  viewChild,
} from '@angular/core';
import {
  LucideChevronLeft,
  LucideChevronRight,
  LucideCircleAlert,
  LucidePencil,
  LucidePlus,
  LucideTrash2,
} from '@lucide/angular';
import { fieldMessage, type Problem, toProblem } from '../../core/api/problem';
import { NotifierService } from '../../core/notifier.service';
import { CatalogApi } from './catalog-api';
import type { LocalizedText } from './catalog-model';
import {
  ACCEPT_ATTRIBUTE,
  countText,
  fileProblem,
  mainFirstOrder,
  MAX_PHOTOS_PER_CATEGORY,
  movedOrder,
  type Photo,
  smallestUrl,
  srcsetOf,
} from './photo-model';

const NO_TEXT: LocalizedText = { fr: '', en: '' };

/**
 * The « Photos » card of a category (management only). Every action is saved at once, apart
 * from the form of the category: add (one photo with its two alternative texts), move, make
 * main, change the texts, delete after confirmation. The first photo is the main one on the
 * public site.
 */
@Component({
  selector: 'adm-category-photos-section',
  imports: [
    LucideChevronLeft,
    LucideChevronRight,
    LucideCircleAlert,
    LucidePencil,
    LucidePlus,
    LucideTrash2,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="card flex flex-col gap-5 p-5" aria-labelledby="titre-photos">
      <div class="flex flex-col gap-1">
        <h3 id="titre-photos" class="font-semibold">Photos</h3>
        <p class="text-sm text-muted">
          Enregistrées dès chaque action, sans le bouton « Enregistrer ». La première est la
          photo principale du site.
        </p>
        @if (photos(); as list) {
          <p class="text-sm font-semibold" role="status">{{ count(list.length) }}</p>
        }
      </div>

      @if (loadProblem(); as error) {
        <div class="alert-error" role="alert">
          <svg lucideCircleAlert class="mt-0.5 shrink-0 text-danger"></svg>
          <p>
            <span class="font-semibold">{{ error.title }}.</span> {{ error.detail }}
          </p>
        </div>
      } @else if (photos(); as list) {
        @if (list.length > 0) {
          <ol class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            @for (photo of list; track photo.id; let index = $index, last = $last) {
              <li class="flex flex-col gap-2 rounded-lg border border-black/10 p-2">
                <div class="relative">
                  <img
                    class="aspect-[4/3] w-full rounded-md bg-black/5 object-cover"
                    loading="lazy"
                    sizes="(min-width: 1024px) 280px, (min-width: 640px) 45vw, 90vw"
                    [src]="smallest(photo)"
                    [attr.srcset]="srcset(photo)"
                    [attr.width]="photo.width"
                    [attr.height]="photo.height"
                    [alt]="photo.alt.fr"
                  />
                  @if (index === 0) {
                    <span class="badge-info absolute top-2 left-2">Photo principale</span>
                  }
                </div>
                <p class="text-sm">{{ photo.alt.fr }}</p>
                <div class="flex flex-wrap items-center gap-1">
                  <button
                    type="button"
                    class="btn-icon"
                    [disabled]="busy() || index === 0"
                    (click)="move(list, index, -1)"
                  >
                    <svg lucideChevronLeft aria-hidden="true"></svg>
                    <span class="sr-only">Déplacer vers la gauche : {{ photo.alt.fr }}</span>
                  </button>
                  <button
                    type="button"
                    class="btn-icon"
                    [disabled]="busy() || last"
                    (click)="move(list, index, 1)"
                  >
                    <svg lucideChevronRight aria-hidden="true"></svg>
                    <span class="sr-only">Déplacer vers la droite : {{ photo.alt.fr }}</span>
                  </button>
                  @if (index > 0) {
                    <button
                      type="button"
                      class="btn-quiet text-sm"
                      [disabled]="busy()"
                      (click)="makeMain(list, index)"
                    >
                      Mettre en principale
                    </button>
                  }
                </div>
                <div class="flex flex-wrap gap-1">
                  <button
                    type="button"
                    class="btn-quiet text-sm"
                    [disabled]="busy()"
                    (click)="openTexts(photo)"
                  >
                    <svg lucidePencil></svg>
                    Textes
                    <span class="sr-only">: {{ photo.alt.fr }}</span>
                  </button>
                  <button
                    type="button"
                    class="btn-quiet text-sm"
                    [disabled]="busy()"
                    (click)="askRemove(photo)"
                  >
                    <svg lucideTrash2></svg>
                    Supprimer
                    <span class="sr-only">: {{ photo.alt.fr }}</span>
                  </button>
                </div>
              </li>
            }
          </ol>
        }

        @if (list.length < maxPhotos) {
          <form
            class="flex flex-col gap-4 border-t border-black/10 pt-5"
            novalidate
            (submit)="$event.preventDefault(); add()"
          >
            <h4 class="font-semibold">Ajouter une photo</h4>
            @if (addProblem(); as error) {
              @if (error.errors.length === 0) {
                <div class="alert-error" role="alert">
                  <svg lucideCircleAlert class="mt-0.5 shrink-0 text-danger"></svg>
                  <p>
                    <span class="font-semibold">{{ error.title }}.</span> {{ error.detail }}
                  </p>
                </div>
              }
            }
            <div class="flex flex-col gap-1.5">
              <label class="field-label" for="photo-fichier">
                Fichier (JPEG, PNG ou WebP, 10 Mo au plus)
              </label>
              <input
                #fileInput
                id="photo-fichier"
                type="file"
                class="field-control py-2"
                [accept]="accept"
                [attr.aria-invalid]="addError('file') ? true : null"
                (change)="chooseFile($event)"
              />
              @if (addError('file'); as message) {
                <p class="field-error">{{ message }}</p>
              }
            </div>
            <div class="grid gap-4 md:grid-cols-2">
              <div class="flex flex-col gap-1.5">
                <label class="field-label" for="photo-alt-fr">
                  Description de la photo (français)
                </label>
                <input
                  id="photo-alt-fr"
                  class="field-control"
                  maxlength="200"
                  placeholder="Ex. : lit double et fenêtre sur le port"
                  [attr.aria-invalid]="addError('altFr') ? true : null"
                  [value]="newAlt().fr"
                  (input)="setNewAlt('fr', valueOf($event))"
                />
                @if (addError('altFr'); as message) {
                  <p class="field-error">{{ message }}</p>
                }
              </div>
              <div class="flex flex-col gap-1.5">
                <label class="field-label" for="photo-alt-en">
                  Description de la photo (anglais)
                </label>
                <input
                  id="photo-alt-en"
                  class="field-control"
                  maxlength="200"
                  placeholder="E.g. double bed and window on the harbour"
                  [attr.aria-invalid]="addError('altEn') ? true : null"
                  [value]="newAlt().en"
                  (input)="setNewAlt('en', valueOf($event))"
                />
                @if (addError('altEn'); as message) {
                  <p class="field-error">{{ message }}</p>
                }
              </div>
            </div>
            <p class="-mt-2 text-sm text-muted">
              Lue à voix haute aux personnes aveugles et affichée si l’image ne charge pas.
            </p>
            <button type="submit" class="self-start btn-primary" [disabled]="busy()">
              <svg lucidePlus></svg>
              {{ uploading() ? 'Envoi en cours…' : 'Envoyer la photo' }}
            </button>
          </form>
        } @else {
          <p class="text-sm text-muted">
            {{ maxPhotos }} photos au plus : supprimez-en une pour en ajouter une autre.
          </p>
        }
      } @else {
        <p class="text-muted" role="status">Chargement des photos…</p>
      }
    </section>

    <dialog #textsDialog class="dialog-panel" aria-labelledby="titre-textes-photo">
      @if (editing(); as edited) {
        <form
          class="flex flex-col gap-4 p-6"
          novalidate
          (submit)="$event.preventDefault(); saveTexts(edited.photo)"
        >
          <h2 id="titre-textes-photo" class="text-lg font-semibold">Description de la photo</h2>
          @if (textsProblem(); as error) {
            @if (error.errors.length === 0) {
              <p class="field-error">{{ error.detail }}</p>
            }
          }
          <div class="flex flex-col gap-1.5">
            <label class="field-label" for="photo-edit-fr">Français</label>
            <input
              id="photo-edit-fr"
              class="field-control"
              maxlength="200"
              [attr.aria-invalid]="textsError('alt.fr') ? true : null"
              [value]="edited.alt.fr"
              (input)="setEditedAlt('fr', valueOf($event))"
            />
            @if (textsError('alt.fr'); as message) {
              <p class="field-error">{{ message }}</p>
            }
          </div>
          <div class="flex flex-col gap-1.5">
            <label class="field-label" for="photo-edit-en">Anglais</label>
            <input
              id="photo-edit-en"
              class="field-control"
              maxlength="200"
              [attr.aria-invalid]="textsError('alt.en') ? true : null"
              [value]="edited.alt.en"
              (input)="setEditedAlt('en', valueOf($event))"
            />
            @if (textsError('alt.en'); as message) {
              <p class="field-error">{{ message }}</p>
            }
          </div>
          <div class="flex flex-wrap justify-end gap-3">
            <button type="button" class="btn-quiet" (click)="textsDialog.close()">Retour</button>
            <button type="submit" class="btn-primary" [disabled]="busy()">Enregistrer</button>
          </div>
        </form>
      }
    </dialog>

    <dialog #removeDialog class="dialog-panel" aria-labelledby="titre-suppression-photo">
      @if (removal(); as photo) {
        <div class="flex flex-col gap-4 p-6">
          <h2 id="titre-suppression-photo" class="text-lg font-semibold">Supprimer cette photo ?</h2>
          <img
            class="aspect-[4/3] w-64 rounded-md object-cover"
            [src]="smallest(photo)"
            [alt]="photo.alt.fr"
          />
          <p>
            Elle disparaît du site et ses fichiers sont effacés. Pour la remettre, il faudra
            l’envoyer de nouveau.
          </p>
          <div class="flex flex-wrap justify-end gap-3">
            <button type="button" class="btn-quiet" (click)="removeDialog.close()">Retour</button>
            <button
              type="button"
              class="btn-danger"
              [disabled]="busy()"
              (click)="confirmRemove(photo)"
            >
              Supprimer la photo
            </button>
          </div>
        </div>
      }
    </dialog>
  `,
})
export class CategoryPhotosSection implements OnInit {
  private readonly catalog = inject(CatalogApi);
  private readonly notifier = inject(NotifierService);
  private readonly fileInput = viewChild<ElementRef<HTMLInputElement>>('fileInput');
  private readonly textsDialog = viewChild.required<ElementRef<HTMLDialogElement>>('textsDialog');
  private readonly removeDialog =
    viewChild.required<ElementRef<HTMLDialogElement>>('removeDialog');

  readonly categoryId = input.required<string>();

  protected readonly accept = ACCEPT_ATTRIBUTE;
  protected readonly maxPhotos = MAX_PHOTOS_PER_CATEGORY;

  protected readonly photos = signal<Photo[] | null>(null);
  protected readonly loadProblem = signal<Problem | null>(null);
  /** One action at a time: the buttons wait for the answer. */
  protected readonly busy = signal(false);
  protected readonly uploading = signal(false);

  // The form of a new photo.
  protected readonly file = signal<File | null>(null);
  protected readonly newAlt = signal<LocalizedText>(NO_TEXT);
  protected readonly addProblem = signal<Problem | null>(null);
  private readonly addLocalErrors = signal<Record<string, string>>({});

  // The two dialogs.
  protected readonly editing = signal<{ photo: Photo; alt: LocalizedText } | null>(null);
  protected readonly textsProblem = signal<Problem | null>(null);
  protected readonly removal = signal<Photo | null>(null);

  ngOnInit(): void {
    void this.load();
  }

  private async load(): Promise<void> {
    this.loadProblem.set(null);
    try {
      this.photos.set(await this.catalog.photos(this.categoryId()));
    } catch (error) {
      this.loadProblem.set(toProblem(error));
    }
  }

  protected count(length: number): string {
    return countText(length);
  }

  protected srcset(photo: Photo): string {
    return srcsetOf(photo.sources);
  }

  protected smallest(photo: Photo): string {
    return smallestUrl(photo.sources);
  }

  protected valueOf(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }

  /** Runs one change (the answer is the new list of the photos); null when it succeeded. */
  private async run(action: () => Promise<Photo[]>, success: string): Promise<Problem | null> {
    this.busy.set(true);
    try {
      this.photos.set(await action());
      this.notifier.success(success);
      return null;
    } catch (error) {
      const problem = toProblem(error);
      if (problem.status === 404) {
        // Deleted meanwhile (another tab, another person): show what remains.
        void this.load();
      }
      return problem;
    } finally {
      this.busy.set(false);
    }
  }

  // --- Order ---

  private async reorder(ids: string[], success: string): Promise<void> {
    const problem = await this.run(
      () => this.catalog.reorderPhotos(this.categoryId(), ids),
      success,
    );
    if (problem !== null) {
      this.notifier.error(problem.detail);
      // The list may have changed meanwhile: show the order actually stored.
      void this.load();
    }
  }

  protected move(list: readonly Photo[], index: number, offset: -1 | 1): void {
    const ids = movedOrder(
      list.map((photo) => photo.id),
      index,
      offset,
    );
    void this.reorder(ids, 'L’ordre des photos est enregistré.');
  }

  protected makeMain(list: readonly Photo[], index: number): void {
    const ids = mainFirstOrder(
      list.map((photo) => photo.id),
      index,
    );
    void this.reorder(ids, 'La photo principale est changée.');
  }

  // --- Adding ---

  protected chooseFile(event: Event): void {
    const chosen = (event.target as HTMLInputElement).files?.[0] ?? null;
    this.file.set(chosen);
    const problem = chosen === null ? null : fileProblem(chosen);
    this.addLocalErrors.update((errors) => {
      const others = Object.fromEntries(Object.entries(errors).filter(([key]) => key !== 'file'));
      return problem === null ? others : { ...others, file: problem };
    });
  }

  protected setNewAlt(language: keyof LocalizedText, value: string): void {
    this.newAlt.update((alt) => ({ ...alt, [language]: value }));
  }

  protected addError(field: string): string | undefined {
    return this.addLocalErrors()[field] ?? fieldMessage(this.addProblem(), field);
  }

  /** Checked here first: an upload of 10 MB refused for a missing text is a waste. */
  private addCheck(file: File | null, alt: LocalizedText): Record<string, string> {
    const errors: Record<string, string> = {};
    const problem = file === null ? 'Choisissez une photo.' : fileProblem(file);
    if (problem !== null) {
      errors['file'] = problem;
    }
    if (alt.fr.trim() === '') {
      errors['altFr'] = 'Décrivez la photo en français (accessibilité).';
    }
    if (alt.en.trim() === '') {
      errors['altEn'] = 'Décrivez la photo en anglais (accessibilité).';
    }
    return errors;
  }

  protected async add(): Promise<void> {
    const file = this.file();
    const alt = this.newAlt();
    this.addProblem.set(null);
    const errors = this.addCheck(file, alt);
    this.addLocalErrors.set(errors);
    if (file === null || Object.keys(errors).length > 0) {
      return;
    }
    this.uploading.set(true);
    const problem = await this.run(
      () => this.catalog.addPhoto(this.categoryId(), file, alt),
      'La photo est ajoutée.',
    );
    this.uploading.set(false);
    this.addProblem.set(problem);
    if (problem === null) {
      this.file.set(null);
      this.newAlt.set(NO_TEXT);
      const fileInput = this.fileInput()?.nativeElement;
      if (fileInput !== undefined) {
        fileInput.value = '';
      }
    }
  }

  // --- Texts ---

  protected openTexts(photo: Photo): void {
    this.textsProblem.set(null);
    this.editing.set({ photo, alt: { ...photo.alt } });
    this.textsDialog().nativeElement.showModal();
  }

  protected setEditedAlt(language: keyof LocalizedText, value: string): void {
    this.editing.update((edited) =>
      edited === null ? edited : { ...edited, alt: { ...edited.alt, [language]: value } },
    );
  }

  protected textsError(field: string): string | undefined {
    return fieldMessage(this.textsProblem(), field);
  }

  protected async saveTexts(photo: Photo): Promise<void> {
    const edited = this.editing();
    if (edited === null) {
      return;
    }
    const alt = { fr: edited.alt.fr.trim(), en: edited.alt.en.trim() };
    const problem = await this.run(
      () => this.catalog.changePhotoAlt(photo.id, alt),
      'La description de la photo est enregistrée.',
    );
    this.textsProblem.set(problem);
    if (problem === null) {
      this.textsDialog().nativeElement.close();
    }
  }

  // --- Deletion, after confirmation ---

  protected askRemove(photo: Photo): void {
    this.removal.set(photo);
    this.removeDialog().nativeElement.showModal();
  }

  protected async confirmRemove(photo: Photo): Promise<void> {
    const problem = await this.run(
      () => this.catalog.removePhoto(photo.id),
      'La photo est supprimée.',
    );
    this.removeDialog().nativeElement.close();
    if (problem !== null) {
      this.notifier.error(problem.detail);
    }
  }
}
