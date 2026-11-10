import { describe, expect, it } from 'vitest';
import { clearGuestDraft, type DraftStorage, loadGuestDraft, saveGuestDraft } from './guest-draft';

function memoryStorage(): DraftStorage & { items: Map<string, string> } {
  const items = new Map<string, string>();
  return {
    items,
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => {
      items.set(key, value);
    },
    removeItem: (key) => {
      items.delete(key);
    },
  };
}

const DRAFT = {
  firstName: 'Lina',
  lastName: 'Martin',
  email: 'lina@example.com',
  phone: '+33 6 12 34 56 78',
  country: 'FR',
};

describe('guest draft', () => {
  it('keeps the details for the tab, then forgets them', () => {
    const storage = memoryStorage();
    saveGuestDraft(storage, DRAFT);
    expect(loadGuestDraft(storage)).toEqual(DRAFT);

    clearGuestDraft(storage);
    expect(loadGuestDraft(storage)).toBeNull();
  });

  it('ignores a draft of another shape, and a storage refused by the browser', () => {
    const storage = memoryStorage();
    storage.items.set('riad.booking.guest', '{"firstName":"Lina"}');
    expect(loadGuestDraft(storage)).toBeNull();
    storage.items.set('riad.booking.guest', 'pas du JSON');
    expect(loadGuestDraft(storage)).toBeNull();

    const refusing: DraftStorage = {
      getItem: () => {
        throw new Error('refusé');
      },
      setItem: () => {
        throw new Error('refusé');
      },
      removeItem: () => {
        throw new Error('refusé');
      },
    };
    expect(() => {
      saveGuestDraft(refusing, DRAFT);
      clearGuestDraft(refusing);
    }).not.toThrow();
    expect(loadGuestDraft(refusing)).toBeNull();
    expect(loadGuestDraft(undefined)).toBeNull();
  });
});
