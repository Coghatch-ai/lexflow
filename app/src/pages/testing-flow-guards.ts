// Pure render-guard predicates for TestingPage's Simulado Padrão two-step flow.
// Extracted to a .ts module so they are unit-testable without RTL (#45).

/**
 * Label for the primary action button in the InProgress state.
 * "Conferir" while unchecked; "Finalizar" on last question after check;
 * "Próxima" on any other question after check.
 */
export function primaryLabel({
  checked,
  isLast,
}: {
  checked: boolean;
  isLast: boolean;
}): 'Conferir' | 'Próxima' | 'Finalizar' {
  if (!checked) return 'Conferir';
  return isLast ? 'Finalizar' : 'Próxima';
}

/**
 * Whether the primary action button should be disabled.
 * Disabled only when unchecked AND no answer selected yet.
 */
export function primaryDisabled({
  checked,
  selected,
}: {
  checked: boolean;
  selected: string;
}): boolean {
  return !checked && selected.length === 0;
}

// `canPostponeGuard` moved to @shared/domain/exam-queue (#70, moved in #85) (D2): the
// simulation components under components/ need it too and must not import
// from pages/.
