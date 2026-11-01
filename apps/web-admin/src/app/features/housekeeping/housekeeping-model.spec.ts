import { describe, expect, it } from 'vitest';
import {
  canSetStatus,
  floorLabel,
  floorsOf,
  type HousekeepingRoom,
  nextStatus,
  remainingText,
} from './housekeeping-model';

function room(number: string, floor: number, status: HousekeepingRoom['status']): HousekeepingRoom {
  return {
    id: `id-${number}`,
    number,
    floor,
    categoryCode: 'double-standard',
    categoryName: 'Double standard',
    status,
  };
}

const ROOMS = [
  room('210', 2, 'clean'),
  room('102', 1, 'dirty'),
  room('101', 1, 'clean'),
  room('209', 2, 'clean'),
  room('110', 1, 'dirty'),
];

describe('rights', () => {
  it('lets housekeeping and management set both states', () => {
    for (const role of ['housekeeping', 'direction'] as const) {
      expect(canSetStatus(role, 'clean')).toBe(true);
      expect(canSetStatus(role, 'dirty')).toBe(true);
    }
  });

  it('lets the reception only mark a room to be cleaned', () => {
    expect(canSetStatus('reception', 'dirty')).toBe(true);
    expect(canSetStatus('reception', 'clean')).toBe(false);
    expect(canSetStatus('technician', 'dirty')).toBe(false);
  });

  it('gives the state of a tap, or nothing', () => {
    expect(nextStatus(room('101', 1, 'clean'), 'housekeeping')).toBe('dirty');
    expect(nextStatus(room('102', 1, 'dirty'), 'housekeeping')).toBe('clean');
    expect(nextStatus(room('102', 1, 'dirty'), 'reception')).toBe(null);
    expect(nextStatus(room('101', 1, 'clean'), 'reception')).toBe('dirty');
  });
});

describe('floorsOf', () => {
  it('groups the rooms by floor, in order, counting what is left to clean', () => {
    const floors = floorsOf(ROOMS, { toDoOnly: false, floor: null });
    expect(floors.map((group) => group.floor)).toEqual([1, 2]);
    expect(floors[0]?.rooms.map((item) => item.number)).toEqual(['101', '102', '110']);
    expect(floors.map((group) => group.dirty)).toEqual([2, 0]);
  });

  it('keeps only the rooms to be cleaned, and leaves out the floors with nothing to do', () => {
    const floors = floorsOf(ROOMS, { toDoOnly: true, floor: null });
    expect(floors.map((group) => group.floor)).toEqual([1]);
    expect(floors[0]?.rooms.map((item) => item.number)).toEqual(['102', '110']);
  });

  it('shows one floor only', () => {
    const floors = floorsOf(ROOMS, { toDoOnly: false, floor: 2 });
    expect(floors.map((group) => group.floor)).toEqual([2]);
    expect(floors[0]?.rooms.map((item) => item.number)).toEqual(['209', '210']);
  });
});

describe('texts', () => {
  it('says what is left to clean', () => {
    expect(remainingText(ROOMS)).toBe('Reste 2 chambres à nettoyer');
    expect(remainingText([room('102', 1, 'dirty')])).toBe('Reste 1 chambre à nettoyer');
    expect(remainingText([room('101', 1, 'clean')])).toBe('Tout est propre');
  });

  it('names the floors', () => {
    expect(floorLabel(0)).toBe('Rez-de-chaussée');
    expect(floorLabel(1)).toBe('1er étage');
    expect(floorLabel(5)).toBe('5e étage');
    expect(floorLabel(-1)).toBe('Sous-sol 1');
  });
});
