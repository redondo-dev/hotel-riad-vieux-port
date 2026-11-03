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

export type MenuIcon =
  | 'dashboard'
  | 'today'
  | 'reservations'
  | 'planning'
  | 'housekeeping'
  | 'incidents'
  | 'catalog'
  | 'users';

export interface MenuItem {
  path: string;
  label: string;
  icon: MenuIcon;
  roles: readonly Role[];
}

/**
 * Sections of the sidebar, in display order. Only the sections that really exist are listed:
 * the others (dashboard, arrivals and departures…) are added with their module.
 * « Mon compte » and « Se déconnecter » sit at the bottom of the sidebar for everyone.
 */
export const MENU: readonly MenuItem[] = [
  { path: '/tableau-de-bord', label: 'Tableau de bord', icon: 'dashboard', roles: ['direction'] },
  { path: '/aujourdhui', label: 'Aujourd’hui', icon: 'today', roles: ['direction', 'reception'] },
  {
    path: '/reservations',
    label: 'Réservations',
    icon: 'reservations',
    roles: ['direction', 'reception'],
  },
  { path: '/planning', label: 'Planning', icon: 'planning', roles: ROLES },
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
 * Screen shown right after login, and at the root of the tool: the work screen of each role
 * (UI/UX specification, D-11). No generic home page.
 */
export function landingFor(role: Role): string {
  switch (role) {
    case 'direction':
      return '/tableau-de-bord';
    case 'reception':
      return '/aujourdhui';
    case 'housekeeping':
      return '/menage';
    case 'technician':
      return '/pannes';
  }
}

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value);
}
