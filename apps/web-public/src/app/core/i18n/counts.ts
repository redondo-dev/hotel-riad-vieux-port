/**
 * Labels with a number ("1 nuit", "3 nuits"). Singular and plural are separate messages
 * so translators only handle plain sentences with a `{$count}` placeholder.
 */

export function nightsLabel(count: number): string {
  return count === 1
    ? $localize`:@@count.night.one:1 nuit`
    : $localize`:@@count.night.other:${count}:count: nuits`;
}

export function adultsLabel(count: number): string {
  return count === 1
    ? $localize`:@@count.adult.one:1 adulte`
    : $localize`:@@count.adult.other:${count}:count: adultes`;
}

export function childrenLabel(count: number): string {
  return count === 1
    ? $localize`:@@count.child.one:1 enfant`
    : $localize`:@@count.child.other:${count}:count: enfants`;
}

export function roomsLabel(count: number): string {
  return count === 1
    ? $localize`:@@count.room.one:1 chambre`
    : $localize`:@@count.room.other:${count}:count: chambres`;
}

export function guestsUpToLabel(count: number): string {
  return count === 1
    ? $localize`:@@count.guestsUpTo.one:1 personne`
    : $localize`:@@count.guestsUpTo.other:Jusqu'à ${count}:count: personnes`;
}

export function childAgeOptionLabel(age: number): string {
  if (age === 0) {
    return $localize`:@@count.age.zero:Moins de 1 an`;
  }
  return age === 1
    ? $localize`:@@count.age.one:1 an`
    : $localize`:@@count.age.other:${age}:count: ans`;
}

/** "2 adultes, 1 enfant" — children are omitted when there are none. */
export function partyLabel(adults: number, children: number): string {
  return children === 0
    ? adultsLabel(adults)
    : $localize`:@@count.party:${adultsLabel(adults)}:adults:, ${childrenLabel(children)}:children:`;
}
