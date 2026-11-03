import { DOCUMENT } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import {
  type ActivatedRouteSnapshot,
  NavigationEnd,
  Router,
  RouterLink,
  RouterLinkActive,
  RouterOutlet,
} from '@angular/router';
import {
  LucideBed,
  LucideCalendarCheck,
  LucideCalendarDays,
  LucideCalendarRange,
  LucideCircleUserRound,
  LucideLayoutDashboard,
  LucideLogOut,
  LucideMenu,
  LucidePanelLeftClose,
  LucidePanelLeftOpen,
  LucideSparkles,
  LucideUsers,
  LucideWrench,
  LucideX,
} from '@lucide/angular';
import { filter, map } from 'rxjs';
import { ROLE_LABELS } from '../core/auth/roles';
import { SessionService } from '../core/auth/session.service';
import { NotifierService } from '../core/notifier.service';
import { ZelligeStar } from '../shared/ui/zellige-star';

const COLLAPSED_KEY = 'gestion.barre-repliee';

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSED_KEY) === '1';
  } catch {
    return false;
  }
}

function deepestHeading(route: ActivatedRouteSnapshot): string {
  let current: ActivatedRouteSnapshot | null = route;
  let heading = '';
  while (current !== null) {
    const value: unknown = current.data['heading'];
    if (typeof value === 'string') {
      heading = value;
    }
    current = current.firstChild;
  }
  return heading;
}

/**
 * Layout of the staff tool (UI/UX specification, section 5): dark sidebar with only the sections
 * allowed to the role (240 px, can be folded to 64 px; a drawer under 1,024 px), top bar with the
 * screen title and today's date, content on a light grey background.
 */
@Component({
  selector: 'adm-shell',
  imports: [
    RouterOutlet,
    RouterLink,
    RouterLinkActive,
    ZelligeStar,
    LucideLayoutDashboard,
    LucideCalendarCheck,
    LucideCalendarDays,
    LucideCalendarRange,
    LucideBed,
    LucideSparkles,
    LucideWrench,
    LucideUsers,
    LucideCircleUserRound,
    LucideLogOut,
    LucideMenu,
    LucideX,
    LucidePanelLeftClose,
    LucidePanelLeftOpen,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(document:keydown.escape)': 'closeDrawer()' },
  template: `
    <a class="skip-link" href="#contenu" (click)="skipToContent($event)">Aller au contenu</a>

    @if (drawerOpen()) {
      <div
        class="fixed inset-0 z-20 bg-ink/50 lg:hidden"
        aria-hidden="true"
        (click)="closeDrawer()"
      ></div>
    }

    <div class="flex min-h-dvh">
      <aside
        id="barre-laterale"
        class="on-dark fixed inset-y-0 left-0 z-30 flex w-60 flex-col bg-slate-nav text-white transition-transform lg:sticky lg:top-0 lg:h-dvh lg:translate-x-0"
        [class]="{ '-translate-x-full': !drawerOpen(), 'lg:w-16': collapsed() }"
        aria-label="Navigation principale"
      >
        <div class="flex h-16 items-center gap-2 px-4">
          <adm-zellige-star class="size-6 shrink-0 text-clay" />
          @if (!collapsed()) {
            <span class="text-lg font-semibold tracking-wide">Gestion</span>
          }
          <button
            type="button"
            class="ml-auto btn-icon text-white hover:bg-slate-nav-hover lg:hidden"
            (click)="closeDrawer()"
          >
            <svg lucideX></svg>
            <span class="sr-only">Fermer le menu</span>
          </button>
        </div>

        <nav class="flex-1 overflow-y-auto px-2 py-2">
          <ul class="flex flex-col gap-1">
            @for (item of session.menu(); track item.path) {
              <li>
                <a
                  [routerLink]="item.path"
                  routerLinkActive="bg-slate-nav-hover font-semibold"
                  ariaCurrentWhenActive="page"
                  class="flex h-11 items-center gap-3 rounded-lg px-3 text-white/90 hover:bg-slate-nav-hover hover:text-white"
                  [attr.title]="collapsed() ? item.label : null"
                  (click)="closeDrawer()"
                >
                  @switch (item.icon) {
                    @case ('dashboard') {
                      <svg lucideLayoutDashboard class="shrink-0"></svg>
                    }
                    @case ('today') {
                      <svg lucideCalendarCheck class="shrink-0"></svg>
                    }
                    @case ('reservations') {
                      <svg lucideCalendarDays class="shrink-0"></svg>
                    }
                    @case ('planning') {
                      <svg lucideCalendarRange class="shrink-0"></svg>
                    }
                    @case ('housekeeping') {
                      <svg lucideSparkles class="shrink-0"></svg>
                    }
                    @case ('incidents') {
                      <svg lucideWrench class="shrink-0"></svg>
                    }
                    @case ('catalog') {
                      <svg lucideBed class="shrink-0"></svg>
                    }
                    @case ('users') {
                      <svg lucideUsers class="shrink-0"></svg>
                    }
                  }
                  <span [class]="{ 'lg:sr-only': collapsed() }">{{ item.label }}</span>
                </a>
              </li>
            }
          </ul>
        </nav>

        @if (session.user(); as user) {
          <div class="border-t border-white/15 px-2 py-3">
            <p class="px-3 pb-2 text-sm" [class]="{ 'lg:sr-only': collapsed() }">
              <span class="block font-semibold">{{ user.firstName }} {{ user.lastName }}</span>
              <span class="block text-white/75">{{ roleLabel() }}</span>
            </p>
            <a
              routerLink="/mon-compte"
              routerLinkActive="bg-slate-nav-hover font-semibold"
              ariaCurrentWhenActive="page"
              class="flex h-11 items-center gap-3 rounded-lg px-3 text-white/90 hover:bg-slate-nav-hover hover:text-white"
              [attr.title]="collapsed() ? 'Mon compte' : null"
              (click)="closeDrawer()"
            >
              <svg lucideCircleUserRound class="shrink-0"></svg>
              <span [class]="{ 'lg:sr-only': collapsed() }">Mon compte</span>
            </a>
            <button
              type="button"
              class="flex h-11 w-full items-center gap-3 rounded-lg px-3 text-left text-white/90 hover:bg-slate-nav-hover hover:text-white"
              [attr.title]="collapsed() ? 'Se déconnecter' : null"
              [disabled]="loggingOut()"
              (click)="logOut()"
            >
              <svg lucideLogOut class="shrink-0"></svg>
              <span [class]="{ 'lg:sr-only': collapsed() }">Se déconnecter</span>
            </button>
            <button
              type="button"
              class="mt-1 hidden h-11 w-full items-center gap-3 rounded-lg px-3 text-white/75 hover:bg-slate-nav-hover hover:text-white lg:flex"
              [attr.aria-expanded]="!collapsed()"
              aria-controls="barre-laterale"
              (click)="toggleCollapsed()"
            >
              @if (collapsed()) {
                <svg lucidePanelLeftOpen class="shrink-0"></svg>
              } @else {
                <svg lucidePanelLeftClose class="shrink-0"></svg>
              }
              <span [class]="{ 'lg:sr-only': collapsed() }">{{
                collapsed() ? 'Déplier le menu' : 'Replier le menu'
              }}</span>
            </button>
          </div>
        }
      </aside>

      <div class="flex min-w-0 flex-1 flex-col">
        <header class="flex h-16 items-center gap-3 border-b border-line bg-white px-4 sm:px-6">
          <button
            type="button"
            class="btn-icon lg:hidden"
            aria-controls="barre-laterale"
            [attr.aria-expanded]="drawerOpen()"
            (click)="drawerOpen.set(true)"
          >
            <svg lucideMenu></svg>
            <span class="sr-only">Ouvrir le menu</span>
          </button>
          <h1 class="text-lg font-semibold">{{ heading() }}</h1>
          <p class="ml-auto hidden text-sm text-muted sm:block">{{ today }}</p>
        </header>

        <main id="contenu" tabindex="-1" class="flex-1 p-4 outline-none sm:p-6">
          <router-outlet />
        </main>
      </div>
    </div>
  `,
})
export class Shell {
  protected readonly session = inject(SessionService);
  private readonly notifier = inject(NotifierService);
  private readonly router = inject(Router);
  private readonly document = inject(DOCUMENT);

  protected readonly collapsed = signal(readCollapsed());
  protected readonly drawerOpen = signal(false);
  protected readonly loggingOut = signal(false);

  protected readonly roleLabel = computed(() => {
    const user = this.session.user();
    return user === null ? '' : ROLE_LABELS[user.role];
  });

  protected readonly heading = toSignal(
    this.router.events.pipe(
      filter((event) => event instanceof NavigationEnd),
      map(() => deepestHeading(this.router.routerState.snapshot.root)),
    ),
    { initialValue: deepestHeading(this.router.routerState.snapshot.root) },
  );

  protected readonly today = new Date().toLocaleDateString('fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'Europe/Paris',
  });

  protected toggleCollapsed(): void {
    this.collapsed.update((value) => !value);
    try {
      localStorage.setItem(COLLAPSED_KEY, this.collapsed() ? '1' : '0');
    } catch {
      // Private browsing: the choice is simply not remembered.
    }
  }

  protected closeDrawer(): void {
    this.drawerOpen.set(false);
  }

  protected skipToContent(event: Event): void {
    event.preventDefault();
    this.document.getElementById('contenu')?.focus();
  }

  protected async logOut(): Promise<void> {
    this.loggingOut.set(true);
    try {
      await this.session.logOut();
    } catch {
      // The local session is cleared anyway; the server one expires on its own.
    } finally {
      this.loggingOut.set(false);
    }
    this.notifier.success('Vous êtes déconnecté.');
    await this.router.navigate(['/connexion']);
  }
}
