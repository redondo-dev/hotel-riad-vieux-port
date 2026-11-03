import { describe, expect, it } from 'vitest';
import { addDays } from '../../catalog/domain/pricing.ts';
import { DEMO_DAYS_AFTER, DEMO_DAYS_BEFORE, demoEmail, demoStayPlan } from './demo-stays.ts';

const TODAY = '2034-05-10';
const CAPACITY: Record<string, number> = {
  single: 1,
  'double-standard': 2,
  'double-superior': 2,
  family: 4,
  suite: 3,
};

describe('demoStayPlan', () => {
  const plan = demoStayPlan(TODAY);

  it('books about forty stays around the day, for different customers', () => {
    expect(plan).toHaveLength(40);
    expect(new Set(plan.map((stay) => stay.customer.email)).size).toBe(40);
    for (const stay of plan) {
      expect(stay.checkIn >= addDays(TODAY, -DEMO_DAYS_BEFORE)).toBe(true);
      expect(stay.checkOut <= addDays(TODAY, DEMO_DAYS_AFTER)).toBe(true);
      expect(stay.checkOut > stay.checkIn).toBe(true);
    }
  });

  it('gives each status the dates it needs, and a room to every stay begun', () => {
    for (const stay of plan) {
      if (stay.status === 'checked_out') {
        expect(stay.checkOut <= TODAY).toBe(true);
      } else if (stay.status === 'checked_in') {
        expect(stay.checkIn < TODAY && TODAY < stay.checkOut).toBe(true);
      } else {
        expect(stay.checkIn >= TODAY).toBe(true);
      }
      if (stay.checkIn <= TODAY) {
        expect(stay.assigned).toBe(true);
      }
    }
    const count = (status: string): number => plan.filter((stay) => stay.status === status).length;
    expect([count('checked_out'), count('checked_in'), count('cancelled')]).toEqual([6, 6, 2]);
    expect(plan.some((stay) => !stay.assigned)).toBe(true);
  });

  it('puts the guests in a room large enough', () => {
    for (const stay of plan) {
      const guests = stay.adults + stay.childrenAges.length;
      expect(guests <= (CAPACITY[stay.categoryCode] ?? 0)).toBe(true);
    }
  });

  it('writes the addresses without accents, on a domain reserved for examples', () => {
    expect(demoEmail('Léa', 'Dubois')).toBe('lea.dubois@example.com');
    expect(demoEmail('Sophie', 'Müller')).toBe('sophie.muller@example.com');
  });
});
