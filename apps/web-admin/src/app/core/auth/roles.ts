/**
 * Roles of the staff and what each one sees (UI/UX specification, section 5). Pure values,
 * tested without Angular. The API checks the same rights: hiding a menu entry is a comfort,
 * never a protection.
 */

export const ROLES = ['direction', 'reception', 'housekeeping', 'technician'] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  direction: 'Direction',
  reception: 'Réception',
  housekeeping: 'Ménage',
  technician: 'Technique',
};

export interface StaffUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: Role;
}

export type MenuIcon = 'home' | 'reservations' | 'housekeeping' | 'incidents' | 'catalog' | 'users';

export interface MenuItem {
  path: string;
  label: string;
  icon: MenuIcon;
  roles: readonly Role[];
}

/**
 * Sections of the sidebar, in display order. Only the sections that really exist are listed:
 * the others (dashboard, planning…) are added with their module.
 * « Mon compte » and « Se déconnecter » sit at the bottom of the sidebar for everyone.
 */
export const MENU: readonly MenuItem[] = [
  { path: '/accueil', label: 'Accueil', icon: 'home', roles: ROLES },
  {
    path: '/reservations',
    label: 'Réservations',
    icon: 'reservations',
    roles: ['direction', 'reception'],
  },
  {
    path: '/menage',
    label: 'Ménage',
    icon: 'housekeeping',
    roles: ['direction', 'reception', 'housekeeping'],
  },
  { path: '/pannes', label: 'Pannes', icon: 'incidents', roles: ROLES },
  { path: '/catalogue', label: 'Catalogue', icon: 'catalog', roles: ['direction', 'reception'] },
  { path: '/utilisateurs', label: 'Utilisateurs', icon: 'users', roles: ['direction'] },
];

export function menuFor(role: Role): MenuItem[] {
  return MENU.filter((item) => item.roles.includes(role));
}

/**
 * Screen shown right after login: the housekeeping board for the housekeeping staff, the
 * incidents for the technicians, the provisional home page for the others until the dashboard
 * (management) and « Aujourd'hui » (reception) exist.
 */
export function landingFor(role: Role): string {
  if (role === 'housekeeping') {
    return '/menage';
  }
  return role === 'technician' ? '/pannes' : '/accueil';
}

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value);
}
