import { describe, expect, it } from 'vitest';
import { primaryLabel, primaryDisabled } from './testing-flow-guards';
// `canPostponeGuard` moved to shared/domain/exam-queue in #70 (moved there in #85) — its cases live in
// shared/domain/exam-queue.test.ts now.

// Regression guard for #45: Simulado Padrão two-step Conferir → lock → Próxima.

describe('primaryLabel', () => {
  it('returns Conferir when unchecked (regardless of isLast)', () => {
    expect(primaryLabel({ checked: false, isLast: false })).toBe('Conferir');
    expect(primaryLabel({ checked: false, isLast: true })).toBe('Conferir');
  });

  it('returns Próxima when checked and not last', () => {
    expect(primaryLabel({ checked: true, isLast: false })).toBe('Próxima');
  });

  it('returns Finalizar when checked and last', () => {
    expect(primaryLabel({ checked: true, isLast: true })).toBe('Finalizar');
  });
});

describe('primaryDisabled', () => {
  it('disabled when unchecked and no answer selected', () => {
    expect(primaryDisabled({ checked: false, selected: '' })).toBe(true);
  });

  it('enabled when unchecked but answer selected', () => {
    expect(primaryDisabled({ checked: false, selected: 'A' })).toBe(false);
  });

  it('enabled when checked (answer always present at that point)', () => {
    expect(primaryDisabled({ checked: true, selected: 'A' })).toBe(false);
  });
});
