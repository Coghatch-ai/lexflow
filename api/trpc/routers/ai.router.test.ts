// api/trpc/routers/ai.router.test.ts
//
// Regression guard: quota retirement (S1) — issue #49.
//
// Strategy: read the router source as text and assert assertAndIncrementQuota
// is absent. This catches both re-import and inline re-addition
// (e.g. `if (count >= 30) throw`) — neither would pass the string check.
// A weaker export-absence test in shared/domain/ai-tutor.test.ts guards the
// dead constant; this test guards the call-site.

import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

const routerSource = readFileSync(join(import.meta.dirname, "ai.router.ts"), "utf-8");

// Quota retirement (S1) — issue #49
// assertAndIncrementQuota must not appear in the tutor router.
// Credits (assertCredits / debitCredits) are the only gate now.
describe("quota retirement (S1) — ai.router call-site guard", () => {
  it("assertAndIncrementQuota is not imported or called in ai.router.ts", () => {
    expect(routerSource).not.toContain("assertAndIncrementQuota");
  });

  it("assertAndIncrementQuota is not imported from ai-quota in ai.router.ts", () => {
    expect(routerSource).not.toContain("ai-quota");
  });

  it("assertCredits is present (credits gate is active)", () => {
    expect(routerSource).toContain("assertCredits");
  });
});
