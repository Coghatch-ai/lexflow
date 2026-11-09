// scripts/lib/validate-workflow-env.test.ts
//
// Config-contract guard for the CI half of #109. `pnpm validate` imports
// modules that read `VITE_*` at module scope, and `import.meta.env` under
// vitest is populated ONLY by shell env and `.env*` files — so a runner
// without these two vars dies at import with `(0 test)` while every dev
// checkout stays green on its gitignored `.env`.
//
// Static text assertions (same pattern as api/db/scope.test.ts): red on the
// pre-fix validate.yml, and red again the day someone drops the block or
// "upgrades" a placeholder to a `secrets.*` reference — which would resolve
// empty here, because validate.yml declares no `environment:` and secrets
// never reach fork PRs.

import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

const workflow = readFileSync(
  join(import.meta.dirname, "../../.github/workflows/validate.yml"),
  "utf-8",
);

/** The module-scope `VITE_*` reads that must be satisfied for `pnpm validate`. */
const REQUIRED_VARS = ["VITE_CLERK_PUBLISHABLE_KEY", "VITE_API_URL"] as const;

describe("validate.yml env contract — issue #109", () => {
  for (const name of REQUIRED_VARS) {
    it(`sets ${name} to a non-empty inline value`, () => {
      const assignment = new RegExp(`^\\s*${name}:[ \\t]*(\\S.*)$`, "m").exec(workflow);
      expect(assignment).not.toBeNull();
      expect(assignment?.[1]?.trim()).not.toBe("");
    });

    it(`does not wire ${name} through secrets.`, () => {
      const assignment = new RegExp(`^\\s*${name}:[ \\t]*(.*)$`, "m").exec(workflow);
      expect(assignment?.[1] ?? "").not.toContain("secrets.");
    });
  }
});
