// shared/lib/require-env.test.ts
//
// Regression guard for #109. The pre-fix call sites read
// `import.meta.env.X.length` directly, so an absent var produced
// `TypeError: Cannot read properties of undefined (reading 'length')` and the
// whole suite died at import with `(0 test)`. These cases pin the NAMED error
// instead — the `not.toBeInstanceOf(TypeError)` assertion is what goes red
// against the old `value.length === 0` body.
//
// Why a pure helper and not a test of the real modules: under vitest 2.1.9 with
// `environment: "node"`, neither `test.env` nor `vi.stubEnv` reaches
// `import.meta.env` (only shell env and `.env*` files do), so a missing var
// cannot be simulated by stubbing. This helper is the testable seam.

import { describe, expect, it } from "vitest";
import { requireEnv } from "./require-env";

describe("requireEnv", () => {
  it("throws `Missing <name>` — not a TypeError — when the value is undefined", () => {
    let thrown: unknown;
    try {
      requireEnv("VITE_X", undefined);
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(Error);
    expect(thrown).not.toBeInstanceOf(TypeError);
    expect((thrown as Error).message).toBe("Missing VITE_X");
  });

  it("throws the same named error on an empty string", () => {
    expect(() => requireEnv("VITE_X", "")).toThrow("Missing VITE_X");
  });

  it("names the var it was asked about", () => {
    expect(() => requireEnv("VITE_CLERK_PUBLISHABLE_KEY", undefined)).toThrow(
      "Missing VITE_CLERK_PUBLISHABLE_KEY",
    );
  });

  it("returns the value when present", () => {
    expect(requireEnv("VITE_X", "v")).toBe("v");
  });
});
