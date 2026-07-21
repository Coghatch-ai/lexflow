import { describe, expect, it } from "vitest";
import { shouldShowExplanationToggle } from "./real-exam-review-guards";

// Regression guard for #42: AI-explanation toggle must render for EVERY
// reviewed question — correct, incorrect, and unanswered — so the student
// can always generate an AI answer after the exam.
describe("shouldShowExplanationToggle", () => {
  it("returns true for a correct answer", () => {
    expect(shouldShowExplanationToggle(true)).toBe(true);
  });

  it("returns true for an incorrect answer", () => {
    expect(shouldShowExplanationToggle(false)).toBe(true);
  });
});
