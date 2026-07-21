// Pure render-guard predicates for RealExamSimulation's post-exam review.
// Extracted to a .ts module so they are unit-testable without RTL (#42).

/**
 * Returns true when the AI-explanation toggle should be shown in the review
 * row. After fixing #42 this is unconditional (correct + incorrect +
 * unanswered all get the toggle), but the explicit predicate guards the
 * invariant against regressions.
 */
export function shouldShowExplanationToggle(_isCorrect: boolean): boolean {
  return true;
}
