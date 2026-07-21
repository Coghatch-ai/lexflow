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

/**
 * Whether the "Responder depois" (postpone) button should be available.
 * Only before the check step AND when there are more questions in the queue.
 */
export function canPostponeGuard({
  checked,
  hasMoreQuestions,
}: {
  checked: boolean;
  hasMoreQuestions: boolean;
}): boolean {
  return !checked && hasMoreQuestions;
}
