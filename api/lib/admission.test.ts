// api/lib/admission.test.ts
//
// Admission gate (D4, epic #50). Covers the acceptance-guarded behaviors that are
// pure control flow (grace-at-zero, fail-closed burst, non-spend fail-open). The
// balance READ is injected so these run hermetically (no DB in the harness).

import { afterEach, describe, expect, it, vi } from "vitest";
import { admit, admitNonSpend, BURST_ADMIT_LIMIT, __resetBurstForTest } from "./admission";

const USER = "00000000-0000-0000-0000-000000000000";
const reads = (cents: number) => (): Promise<number> => Promise.resolve(cents);
const fails = (): Promise<number> => Promise.reject(new Error("db down"));

afterEach(() => {
  vi.restoreAllMocks();
  __resetBurstForTest();
});

describe("admit — grace-at-zero", () => {
  it("admits while balance is strictly positive (the last-cent request completes)", async () => {
    await expect(admit(USER, reads(1))).resolves.toBeUndefined();
  });

  it("DENIES at exactly 0 (the NEXT request after the wallet drains)", async () => {
    await expect(admit(USER, reads(0))).rejects.toThrow(/Saldo insuficiente/);
  });

  it("DENIES on a negative balance", async () => {
    await expect(admit(USER, reads(-5))).rejects.toThrow(/Saldo insuficiente/);
  });
});

describe("admit — fail-CLOSED burst on a balance-read failure", () => {
  it(`admits the first BURST=${String(BURST_ADMIT_LIMIT)} then DENIES`, async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    for (let i = 0; i < BURST_ADMIT_LIMIT; i++) {
      await expect(admit(USER, fails)).resolves.toBeUndefined();
    }
    await expect(admit(USER, fails)).rejects.toThrow(/Saldo insuficiente/);
  });

  it("a healthy read resets the burst budget (a blip does not permanently burn it)", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(admit(USER, fails)).resolves.toBeUndefined(); // 1 burst used
    await expect(admit(USER, reads(100))).resolves.toBeUndefined(); // healthy → reset

    // Budget refilled: another full burst is available again, then deny.
    for (let i = 0; i < BURST_ADMIT_LIMIT; i++) {
      await expect(admit(USER, fails)).resolves.toBeUndefined();
    }
    await expect(admit(USER, fails)).rejects.toThrow(/Saldo insuficiente/);
  });
});

describe("admitNonSpend — fail-OPEN", () => {
  it("never throws (a free action is never blocked by a billing read)", () => {
    expect(() => {
      admitNonSpend();
    }).not.toThrow();
  });
});
