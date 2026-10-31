import type { StaySearchError } from '@riad/shared';

export interface MessageContext {
  maxStayNights: number;
  bookingHorizonDays: number;
  phone: string;
}

/**
 * Turns an error code into a sentence that says what happened and what to do
 * (UI/UX specification, section 8). The shared rules only return codes.
 */
export function staySearchErrorMessage(error: StaySearchError, context: MessageContext): string {
  switch (error.field) {
    case 'checkIn':
      switch (error.code) {
        case 'required':
          return $localize`:@@search.error.checkInRequired:Choisissez votre date d'arrivée.`;
        case 'inPast':
          return $localize`:@@search.error.checkInPast:La date d'arrivée est déjà passée. Choisissez une date à partir d'aujourd'hui.`;
        case 'sameDayClosed':
          return $localize`:@@search.error.sameDayClosed:Pour une arrivée ce soir après 23 h, appelez la réception au ${context.phone}:phone:.`;
        case 'tooFarAhead':
          return $localize`:@@search.error.tooFarAhead:Les réservations en ligne sont ouvertes jusqu'à ${context.bookingHorizonDays}:days: jours à l'avance.`;
      }
      break;
    case 'checkOut':
      switch (error.code) {
        case 'required':
          return $localize`:@@search.error.checkOutRequired:Choisissez votre date de départ.`;
        case 'notAfterCheckIn':
          return $localize`:@@search.error.checkOutBeforeCheckIn:La date de départ doit être après la date d'arrivée.`;
        case 'stayTooLong':
          return $localize`:@@search.error.stayTooLong:Pour un séjour de plus de ${context.maxStayNights}:nights: nuits, contactez-nous au ${context.phone}:phone:.`;
      }
      break;
    case 'rooms':
      return $localize`:@@search.error.rooms:Choisissez entre 1 et 5 chambres.`;
    case 'room':
      return error.code === 'tooManyGuests'
        ? $localize`:@@search.error.roomTooManyGuests:Chambre ${error.roomIndex + 1}:room: : 4 personnes au maximum. Ajoutez une chambre pour répartir les voyageurs.`
        : $localize`:@@search.error.roomInvalid:Chambre ${error.roomIndex + 1}:room: : vérifiez le nombre de voyageurs.`;
    case 'childAge':
      return $localize`:@@search.error.childAge:Chambre ${error.roomIndex + 1}:room: : indiquez l'âge de l'enfant ${error.childIndex + 1}:child:.`;
  }
  return $localize`:@@search.error.unknown:Vérifiez votre recherche.`;
}
