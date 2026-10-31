import {
  ChangeDetectionStrategy,
  Component,
  computed,
  type ElementRef,
  input,
  model,
  signal,
  viewChild,
} from '@angular/core';
import { OCCUPANCY_LIMITS, type RoomDraft, type StaySearchError } from '@riad/shared';
import { LucideAngularModule, Plus, Trash2, Users, X } from 'lucide-angular';
import { childAgeOptionLabel, partyLabel, roomsLabel } from '../../../core/i18n/counts';
import { Counter } from '../counter';

/**
 * Rooms and guests field (UI/UX specification 4.A): 1 to 5 rooms; per room 1 to 4 adults
 * and 0 to 3 children whose age is required (supplements and tourist tax depend on it).
 */
@Component({
  selector: 'rvp-guests-picker',
  imports: [LucideAngularModule, Counter],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './guests-picker.html',
})
export class GuestsPicker {
  readonly fieldId = input.required<string>();
  readonly rooms = model.required<RoomDraft[]>();
  /** Errors of the search form; those concerning rooms and ages are highlighted here. */
  readonly errors = input<StaySearchError[]>([]);
  readonly invalid = input(false);
  readonly describedBy = input<string | null>(null);

  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');
  private readonly trigger = viewChild.required<ElementRef<HTMLButtonElement>>('trigger');

  protected readonly limits = OCCUPANCY_LIMITS;
  protected readonly icons = { users: Users, close: X, add: Plus, remove: Trash2 };
  protected readonly isOpen = signal(false);
  protected readonly ageOptions = Array.from(
    { length: OCCUPANCY_LIMITS.maxChildAge + 1 },
    (_, age) => ({
      age,
      label: childAgeOptionLabel(age),
    }),
  );

  protected readonly summary = computed(() => {
    const rooms = this.rooms();
    const adults = rooms.reduce((total, room) => total + room.adults, 0);
    const children = rooms.reduce((total, room) => total + room.childrenAges.length, 0);
    return `${partyLabel(adults, children)} · ${roomsLabel(rooms.length)}`;
  });

  protected readonly adultsLabel = $localize`:@@guests.adults:Adultes`;
  protected readonly childrenLabel = $localize`:@@guests.children:Enfants (0 à 17 ans)`;
  protected readonly removeAdultLabel = $localize`:@@guests.removeAdult:Retirer un adulte`;
  protected readonly addAdultLabel = $localize`:@@guests.addAdult:Ajouter un adulte`;
  protected readonly removeChildLabel = $localize`:@@guests.removeChild:Retirer un enfant`;
  protected readonly addChildLabel = $localize`:@@guests.addChild:Ajouter un enfant`;

  focus(): void {
    this.trigger().nativeElement.focus();
  }

  protected open(): void {
    this.dialog().nativeElement.showModal();
    this.isOpen.set(true);
  }

  protected close(): void {
    this.dialog().nativeElement.close();
  }

  protected onClosed(): void {
    this.isOpen.set(false);
    this.trigger().nativeElement.focus();
  }

  protected onDialogClick(event: MouseEvent): void {
    if (event.target === this.dialog().nativeElement) {
      this.close();
    }
  }

  protected roomTitle(index: number): string {
    return $localize`:@@guests.roomTitle:Chambre ${index + 1}:number:`;
  }

  protected removeRoomLabel(index: number): string {
    return $localize`:@@guests.removeRoom:Retirer la chambre ${index + 1}:number:`;
  }

  protected childAgeLabel(childIndex: number): string {
    return $localize`:@@guests.childAge:Âge de l'enfant ${childIndex + 1}:number:`;
  }

  protected childAgeId(roomIndex: number, childIndex: number): string {
    return `${this.fieldId()}-room${roomIndex}-child${childIndex}`;
  }

  protected roomError(roomIndex: number): string | null {
    const error = this.errors().find(
      (candidate) => candidate.field === 'room' && candidate.roomIndex === roomIndex,
    );
    if (error?.field !== 'room') {
      return null;
    }
    return error.code === 'tooManyGuests'
      ? $localize`:@@guests.roomTooManyGuests:Nos chambres accueillent au maximum 4 personnes (bébés de moins de 2 ans non comptés). Répartissez les voyageurs dans une chambre supplémentaire.`
      : $localize`:@@guests.roomInvalid:Vérifiez le nombre de voyageurs de cette chambre.`;
  }

  protected hasAgeError(roomIndex: number, childIndex: number): boolean {
    return this.errors().some(
      (error) =>
        error.field === 'childAge' &&
        error.roomIndex === roomIndex &&
        error.childIndex === childIndex,
    );
  }

  protected setAdults(roomIndex: number, adults: number): void {
    this.updateRoom(roomIndex, (room) => ({ ...room, adults }));
  }

  protected setChildrenCount(roomIndex: number, count: number): void {
    this.updateRoom(roomIndex, (room) => {
      const ages = room.childrenAges.slice(0, count);
      while (ages.length < count) {
        ages.push(null);
      }
      return { ...room, childrenAges: ages };
    });
  }

  protected setChildAge(roomIndex: number, childIndex: number, value: string): void {
    this.updateRoom(roomIndex, (room) => ({
      ...room,
      childrenAges: room.childrenAges.map((age, index) =>
        index === childIndex ? (value === '' ? null : Number(value)) : age,
      ),
    }));
  }

  protected addRoom(): void {
    if (this.rooms().length < OCCUPANCY_LIMITS.maxRooms) {
      this.rooms.update((rooms) => [...rooms, { adults: 2, childrenAges: [] }]);
    }
  }

  protected removeRoom(roomIndex: number): void {
    if (this.rooms().length > 1) {
      this.rooms.update((rooms) => rooms.filter((_, index) => index !== roomIndex));
    }
  }

  private updateRoom(roomIndex: number, change: (room: RoomDraft) => RoomDraft): void {
    this.rooms.update((rooms) =>
      rooms.map((room, index) => (index === roomIndex ? change(room) : room)),
    );
  }
}
