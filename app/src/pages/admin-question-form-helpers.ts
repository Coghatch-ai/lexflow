// app/src/pages/admin-question-form-helpers.ts
//
// Pure helper extracted from admin-question-form.tsx so the component file
// can satisfy react-refresh/only-export-components (no non-component exports).

import { parseExplainResponse } from "@shared/domain/ai-eval";

/**
 * Given a raw AI relay text payload, parse the 4-pillar JSON and return ONLY
 * the whyCorrect slice that must be written to the `explanation` text field.
 * Returns null on any parse failure.
 *
 * Exported for unit testing (#41 regression guard).
 */
export function extractWhyCorrect(rawText: string): string | null {
  const parsed = parseExplainResponse(rawText);
  if (parsed === null) return null;
  return parsed.whyCorrect;
}
