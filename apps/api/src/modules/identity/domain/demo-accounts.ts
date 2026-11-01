import type { Role } from './identity-rules.ts';

/**
 * Staff accounts of the fictional hotel (portfolio, DEMO_MODE=true only): one per role, created
 * by `npm run db:seed:demo`. Never displayed by the staff tool; never used for a real hotel.
 */
export const DEMO_ACCOUNTS: readonly {
  email: string;
  firstName: string;
  lastName: string;
  role: Role;
}[] = [
  {
    email: 'direction@riad-vieux-port.example',
    firstName: 'Démo',
    lastName: 'Direction',
    role: 'direction',
  },
  {
    email: 'reception@riad-vieux-port.example',
    firstName: 'Démo',
    lastName: 'Réception',
    role: 'reception',
  },
  {
    email: 'menage@riad-vieux-port.example',
    firstName: 'Démo',
    lastName: 'Ménage',
    role: 'housekeeping',
  },
  {
    email: 'technique@riad-vieux-port.example',
    firstName: 'Démo',
    lastName: 'Technique',
    role: 'technician',
  },
];
