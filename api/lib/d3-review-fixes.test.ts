// api/lib/d3-review-fixes.test.ts
//
// D3 (#60) — Codex adversarial review:changes regression tests. Four findings:
//   F1/F2 (high) — client-controlled `model` can force rawCents=0 (costFor→0) and
//     dodge the enforce-mode charge. The two client-facing settle procs
//     (ai.gradeSettle, admin.settleGeneration) must NOT accept a client `model`;
//     the metering model is server-derived (resolveMeteringModel() → prod default).
//   F3 (medium) — the shadow admissionRead observe must be strictly best-effort: a
//     failing credit_balances read must NOT throw into / deny the old authoritative
//     path (returns a neutral 0 + warns).
//   F4 (medium) — settleDelivered must only swallow a charge() failure in SHADOW;
//     in ENFORCE a charge() throw must PROPAGATE (fail-closed billing for D4).
//
// F1/F2 are proven at the wiring layer (input schema + server-derived call) since
// costFor's unknown-model→0 rule is already covered in cost-of-goods.test.ts — the
// vuln was purely that a client value reached costFor(). F3/F4 are runtime, driven
// by mocking the DB read (admission) and charge() (settle).

import { readFileSync } from "fs";
import { join } from "path";
import { afterEach, describe, expect, it, vi } from "vitest";

const repoRoot = join(import.meta.dirname, "..", "..");

// ── F3/F4 runtime: mock the DB read + the money-core charge() ────────────────
const dbSelectMock = vi.fn();
vi.mock("../db/client", () => ({
  db: {
    select: (...args: unknown[]) => dbSelectMock(...args) as unknown,
  },
}));

const chargeMock = vi.fn();
vi.mock("./credit-charge", () => ({
  charge: (...args: unknown[]) => chargeMock(...args) as unknown,
}));

// Imported AFTER the mocks so they bind to the mocked modules.
import {
  admissionRead,
  settleDelivered,
  resolveMeteringModel,
  PROD_DEFAULT_MODEL,
} from "./ai-metering";

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  delete process.env.CREDITS_MODE;
});

// ── F1/F2 — no client-supplied model may reach costFor() ─────────────────────
describe("D3-F1/F2 — settle procs meter a SERVER-DERIVED model (no client bypass)", () => {
  const ai = readFileSync(join(repoRoot, "api/trpc/routers/ai.router.ts"), "utf-8");
  const admin = readFileSync(join(repoRoot, "api/trpc/routers/admin.router.ts"), "utf-8");

  it("ai.gradeSettle input schema does NOT accept a client `model`", () => {
    // Isolate the gradeSettle procedure body and assert its input object has no
    // model field — a client cannot supply a model to force rawCents=0.
    const start = ai.indexOf("gradeSettle:");
    const end = ai.indexOf("tutorAsk:", start);
    const body = ai.slice(start, end);
    expect(body).toContain(".input(z.object({ jobId: z.string().uuid() }))");
    expect(body).not.toMatch(/model:\s*z\./); // no `model: z...` in the input schema
    // Metering model is server-derived (no client arg into resolveMeteringModel).
    expect(body).toContain("model: resolveMeteringModel(),");
    expect(body).not.toContain("resolveMeteringModel(input.model)");
  });

  it("admin.settleGeneration input schema does NOT accept a client `model`", () => {
    const start = admin.indexOf("settleGeneration:");
    const end = admin.indexOf("saveAiExplanation:", start);
    const body = admin.slice(start, end);
    expect(body).toContain(".input(z.object({ jobId: z.string().uuid() }))");
    expect(body).not.toMatch(/model:\s*z\./);
    expect(body).toContain("model: resolveMeteringModel(),");
    expect(body).not.toContain("resolveMeteringModel(input.model)");
  });

  it("resolveMeteringModel() (no arg) resolves to the prod default (a real rate row)", () => {
    // The server-derived model is a known, rate-carrying model — never a 0-cost
    // unknown. (The rate-row guard itself lives in cost-of-goods.test.ts.)
    expect(resolveMeteringModel()).toBe(PROD_DEFAULT_MODEL);
  });
});

// ── F3 — shadow admissionRead is strictly best-effort (never throws/denies) ──
describe("D3-F3 — admissionRead observe is best-effort (degraded money path can't block work)", () => {
  it("a failing credit_balances read returns neutral 0 + warns (does NOT throw)", async () => {
    dbSelectMock.mockImplementation(() => {
      throw new Error("credit_balances unavailable");
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const balance = await admissionRead("00000000-0000-0000-0000-000000000000");
    expect(balance).toBe(0); // neutral — old authoritative path proceeds unchanged
    expect(warn).toHaveBeenCalledTimes(1);
    const calls = warn.mock.calls as unknown as unknown[][];
    const msg = calls[0]?.[0];
    expect(String(msg)).toContain("admissionRead failed");
  });

  it("a healthy read still returns the balance (best-effort wrap is transparent)", async () => {
    dbSelectMock.mockReturnValue({
      from: () => ({ where: () => ({ limit: () => Promise.resolve([{ balance: 1234 }]) }) }),
    });
    const balance = await admissionRead("00000000-0000-0000-0000-000000000000");
    expect(balance).toBe(1234);
  });
});

// ── F4 — enforce-mode charge failures are NOT swallowed (fail-closed) ────────
describe("D3-F4 — settleDelivered charge-failure handling is mode-dependent", () => {
  const params = {
    userId: "00000000-0000-0000-0000-000000000000",
    source: "grade",
    refId: "grade:job-f4",
    model: PROD_DEFAULT_MODEL,
    usage: { kind: "tokens" as const, amount: 2048 },
    delivered: true,
    oldDebitCents: 1,
    action: "grade",
  };

  it("SHADOW: a charge() throw is swallowed (logs warn, returns null) — request not broken", async () => {
    process.env.CREDITS_MODE = "shadow";
    chargeMock.mockRejectedValue(new Error("charge boom"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const result = await settleDelivered(params);
    expect(result).toBeNull(); // swallowed
    const calls = warn.mock.calls as unknown as unknown[][];
    const flat = calls.map((c) => String(c[0])).join(" ");
    expect(flat).toContain("shadow settle charge LOST");
  });

  it("ENFORCE: a charge() throw PROPAGATES (fail-closed — settlement can't skip billing)", async () => {
    process.env.CREDITS_MODE = "enforce";
    chargeMock.mockRejectedValue(new Error("charge boom"));
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    await expect(settleDelivered(params)).rejects.toThrow(/charge boom/);
  });
});
