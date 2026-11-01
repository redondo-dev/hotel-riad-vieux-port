import { describe, expect, it } from 'vitest';
import { checkTransition } from './incident-rules.ts';

describe('checkTransition', () => {
  it('lets technicians start and resolve an incident', () => {
    expect(checkTransition('reported', 'in_progress', 'technician')).toBe('allowed');
    expect(checkTransition('reported', 'resolved', 'technician')).toBe('allowed');
    expect(checkTransition('in_progress', 'resolved', 'technician')).toBe('allowed');
  });

  it('keeps closing and reopening for the management', () => {
    expect(checkTransition('resolved', 'closed', 'direction')).toBe('allowed');
    expect(checkTransition('resolved', 'in_progress', 'direction')).toBe('allowed');
    expect(checkTransition('resolved', 'closed', 'technician')).toBe('forbidden');
    expect(checkTransition('resolved', 'in_progress', 'technician')).toBe('forbidden');
  });

  it('refuses any change of state to reception and housekeeping', () => {
    expect(checkTransition('reported', 'in_progress', 'reception')).toBe('forbidden');
    expect(checkTransition('in_progress', 'resolved', 'housekeeping')).toBe('forbidden');
  });

  it('refuses the changes that do not exist, whoever asks', () => {
    expect(checkTransition('resolved', 'reported', 'direction')).toBe('invalid');
    expect(checkTransition('closed', 'in_progress', 'direction')).toBe('invalid');
    expect(checkTransition('reported', 'closed', 'direction')).toBe('invalid');
    expect(checkTransition('in_progress', 'in_progress', 'technician')).toBe('invalid');
  });
});
