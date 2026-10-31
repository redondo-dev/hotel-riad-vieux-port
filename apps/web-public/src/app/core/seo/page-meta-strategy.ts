import { inject, Injectable } from '@angular/core';
import { Meta, Title } from '@angular/platform-browser';
import {
  type ActivatedRouteSnapshot,
  type RouterStateSnapshot,
  TitleStrategy,
} from '@angular/router';

/** Route data key holding the page description shown by search engines. */
export const PAGE_DESCRIPTION = 'description';

/**
 * Sets the page title AND the description of each page after every navigation, on the server
 * and in the browser (audit QA-04). A page without a description has none, instead of keeping
 * the one of the previous page.
 *
 * Usage in the routes: `title: '…'` as usual, plus `data: { description: '…' }` or, when the
 * text depends on data, `resolve: { description: () => '…' }`.
 */
@Injectable()
export class PageMetaStrategy extends TitleStrategy {
  private readonly title = inject(Title);
  private readonly meta = inject(Meta);

  override updateTitle(snapshot: RouterStateSnapshot): void {
    const title = this.buildTitle(snapshot);
    if (title !== undefined) {
      this.title.setTitle(title);
    }

    const description = deepestDescription(snapshot.root);
    if (description === undefined) {
      this.meta.removeTag('name="description"');
    } else {
      this.meta.updateTag({ name: 'description', content: description });
    }
  }
}

function deepestDescription(route: ActivatedRouteSnapshot): string | undefined {
  let found: string | undefined;
  for (let current: ActivatedRouteSnapshot | null = route; current; current = current.firstChild) {
    const value: unknown = current.data[PAGE_DESCRIPTION];
    if (typeof value === 'string') {
      found = value;
    }
  }
  return found;
}
