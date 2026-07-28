// shared/domain/cost-of-goods.test.ts
//
// D3 (epic #50) — cost-of-goods table + costFor() guards. Pure/hermetic (no DB).

import { describe, expect, it } from "vitest";
import { COST_OF_GOODS, LIVE_MODEL_IDS, costFor, hasCostRate, type Usage } from "./cost-of-goods";

describe("D3 cost-of-goods — costFor is total + pure", () => {
  it("costFor(unknownModel) returns 0 and does not throw", () => {
    expect(costFor("no-such-model", { kind: "tokens", amount: 1_000_000 })).toBe(0);
    expect(() => costFor("no-such-model", { kind: "tokens", amount: 5 })).not.toThrow();
  });

  it("scales cents per 1M tokens by the actual token amount", () => {
    // gpt-4o-mini = 45¢/1M tokens → 1M tokens = 45¢, 500k = 22.5¢.
    expect(costFor("gpt-4o-mini", { kind: "tokens", amount: 1_000_000 })).toBeCloseTo(45);
    expect(costFor("gpt-4o-mini", { kind: "tokens", amount: 500_000 })).toBeCloseTo(22.5);
  });

  it("a model lacking the usage kind → 0 (no throw)", () => {
    // Chat models list only `tokens`; asking for `image`/`seconds` → 0.
    expect(costFor("gpt-4o-mini", { kind: "image", amount: 10 })).toBe(0);
    expect(costFor("gpt-4o-mini", { kind: "seconds", amount: 10 })).toBe(0);
  });

  it("clamps non-finite / negative amounts to 0", () => {
    const bad: Usage[] = [
      { kind: "tokens", amount: Number.NaN },
      { kind: "tokens", amount: -1000 },
      { kind: "tokens", amount: Number.POSITIVE_INFINITY },
    ];
    for (const u of bad) expect(costFor("gpt-4o-mini", u)).toBe(0);
  });

  it("returns a fractional (sub-cent) value — never pre-rounded", () => {
    // 100 tokens of a 45¢/1M model = 0.0045¢ → carried by charge()'s bag, not rounded.
    expect(costFor("gpt-4o-mini", { kind: "tokens", amount: 100 })).toBeCloseTo(0.0045, 6);
  });
});

describe("D3 MODEL-RATE GUARD — every live model id has a cost-of-goods rate row", () => {
  it("each LIVE_MODEL_IDS entry resolves to a rate row (never silently metered at 0)", () => {
    const missing = LIVE_MODEL_IDS.filter((m) => !hasCostRate(m));
    expect(missing).toEqual([]);
  });

  it("every rate-row model is listed as live (no orphan rows drift out of the guard)", () => {
    const orphans = Object.keys(COST_OF_GOODS).filter((m) => !LIVE_MODEL_IDS.includes(m));
    expect(orphans).toEqual([]);
  });

  it("the prod default model (gpt-4o-mini) has a positive tokens rate", () => {
    expect(costFor("gpt-4o-mini", { kind: "tokens", amount: 1_000_000 })).toBeGreaterThan(0);
  });
});
