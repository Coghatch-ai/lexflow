// shared/domain/cost-of-goods.test.ts
//
// D3 (epic #50) — cost-of-goods table + costFor() guards. Pure/hermetic (no DB).
// Rewritten for #98: rates are INPUT/OUTPUT split (cents per 1M tokens), hold
// TRUE provider cost (margin lives in credit_config `mult.<source>`), and the
// retired ids stay out.

import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import {
  COST_OF_GOODS,
  LIVE_MODEL_IDS,
  RETIRED_MODEL_IDS,
  costFor,
  hasCostRate,
  isRequestableModel,
  resolveRateModel,
  type Usage,
} from "./cost-of-goods";

const none: Usage = { inputTokens: 0, outputTokens: 0 };

// The id a provider ACTUALLY echoes for each alias — OpenAI answers with a dated
// snapshot, Gemini with a 3-digit modelVersion revision. Pricing sees THESE, not
// the aliases the table is keyed by (#98 review round 1, findings 1 + 4).
function echoedFormsOf(alias: string): readonly string[] {
  return alias.startsWith("gemini-")
    ? [`${alias}-002`, `${alias}-001`]
    : [`${alias}-2024-07-18`, `${alias}-2026-08-01`];
}

describe("#98 costFor — input and output are priced SEPARATELY", () => {
  it("1M input tokens costs exactly rate.input", () => {
    for (const [model, rate] of Object.entries(COST_OF_GOODS)) {
      expect(costFor(model, { ...none, inputTokens: 1_000_000 })).toBeCloseTo(rate.input, 6);
    }
  });

  it("1M output tokens costs exactly rate.output", () => {
    for (const [model, rate] of Object.entries(COST_OF_GOODS)) {
      expect(costFor(model, { ...none, outputTokens: 1_000_000 })).toBeCloseTo(rate.output, 6);
    }
  });

  it("a mixed call is the SUM of the two sides (never a blended single rate)", () => {
    // gpt-4o-mini = 15¢/1M in, 60¢/1M out → 1M in + 1M out = 75¢.
    expect(costFor("gpt-4o-mini", { inputTokens: 1_000_000, outputTokens: 1_000_000 })).toBeCloseTo(
      75,
      6,
    );
    // Output is 4x input here, so the split matters: 100k out ≠ 100k in.
    expect(costFor("gpt-4o-mini", { inputTokens: 100_000, outputTokens: 0 })).toBeCloseTo(1.5, 6);
    expect(costFor("gpt-4o-mini", { inputTokens: 0, outputTokens: 100_000 })).toBeCloseTo(6, 6);
  });

  it("keeps the fractional (sub-cent) value — never pre-rounded", () => {
    // 100 input tokens at 15¢/1M = 0.0015¢ — carried by charge()'s bag.
    expect(costFor("gpt-4o-mini", { ...none, inputTokens: 100 })).toBeCloseTo(0.0015, 8);
  });
});

describe("#98 costFor — TOTAL and PURE (a missing rate never crashes a delivered call)", () => {
  it("unknown model → 0, no throw", () => {
    expect(costFor("no-such-model", { inputTokens: 1_000_000, outputTokens: 1_000_000 })).toBe(0);
    expect(() => costFor("no-such-model", { ...none, inputTokens: 5 })).not.toThrow();
  });

  it("non-finite / negative counters contribute 0 (never a credit)", () => {
    const bad: Usage[] = [
      { inputTokens: Number.NaN, outputTokens: 0 },
      { inputTokens: -1_000_000, outputTokens: 0 },
      { inputTokens: Number.POSITIVE_INFINITY, outputTokens: 0 },
      { inputTokens: 0, outputTokens: Number.NaN },
      { inputTokens: 0, outputTokens: -1_000_000 },
    ];
    for (const u of bad) expect(costFor("gpt-4o-mini", u)).toBe(0);
  });

  it("a bad counter on ONE side does not poison the other", () => {
    expect(
      costFor("gpt-4o-mini", { inputTokens: Number.NaN, outputTokens: 1_000_000 }),
    ).toBeCloseTo(60, 6);
  });
});

describe("#98 review round 1 — the ECHOED id prices at its base row", () => {
  // THE ROUND-1 BLOCKER: lookup was exact-key while `echoedModel` hands pricing
  // the provider's echo, so `gemini-3.6-flash-002` / `gpt-4o-mini-2024-07-18`
  // both priced at 0 and ALL live traffic settled `:unmetered`.
  it("an OpenAI dated snapshot prices exactly like its alias", () => {
    const usage: Usage = { inputTokens: 1_000_000, outputTokens: 1_000_000 };
    expect(costFor("gpt-4o-mini-2024-07-18", usage)).toBeCloseTo(costFor("gpt-4o-mini", usage), 6);
    expect(costFor("gpt-4o-mini-2024-07-18", usage)).toBeGreaterThan(0);
    expect(resolveRateModel("gpt-4o-mini-2024-07-18")).toBe("gpt-4o-mini");
  });

  it("a Gemini modelVersion revision prices exactly like its alias", () => {
    const usage: Usage = { inputTokens: 800, outputTokens: 550 };
    expect(costFor("gemini-3.6-flash-002", usage)).toBeCloseTo(
      costFor("gemini-3.6-flash", usage),
      8,
    );
    expect(costFor("gemini-3.6-flash-002", usage)).toBeGreaterThan(0);
    expect(resolveRateModel("gemini-3.6-flash-002")).toBe("gemini-3.6-flash");
  });

  it("resolution is SUFFIX-STRIP, never prefix-match: a distinct variant inherits nothing", () => {
    // `gpt-4o-realtime` shares a prefix with `gpt-4o` but is a DIFFERENT model.
    // Prefix matching would bill it at the gpt-4o rate — silently wrong money.
    for (const alien of [
      "gpt-4o-realtime",
      "gpt-4o-mini-audio",
      "gemini-3.6-flash-thinking",
      "gemini-3.6-flash-preview",
    ]) {
      expect(resolveRateModel(alien)).toBeNull();
      expect(hasCostRate(alien)).toBe(false);
      expect(costFor(alien, { inputTokens: 1_000_000, outputTokens: 1_000_000 })).toBe(0);
    }
  });

  it("a real but UNPRICED model still resolves to nothing (visible 0, never a guess)", () => {
    for (const unpriced of ["gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.4-mini"]) {
      expect(resolveRateModel(unpriced)).toBeNull();
      expect(hasCostRate(unpriced)).toBe(false);
    }
  });

  it("resolution is TOTAL: garbage in → null, never a throw", () => {
    for (const junk of [
      "",
      "-",
      "-002",
      "----",
      "2026-08-01",
      "gpt",
      "gpt-4o-mini-2024-07-18-002",
    ]) {
      expect(() => resolveRateModel(junk)).not.toThrow();
      expect(() => costFor(junk, { inputTokens: 10, outputTokens: 10 })).not.toThrow();
    }
    expect(resolveRateModel("")).toBeNull();
    // Only ONE suffix is stripped — a doubly-suffixed id is not chased further.
    expect(resolveRateModel("gpt-4o-mini-2024-07-18-002")).toBeNull();
  });
});

describe("#98 review round 1 — a CLIENT may only request a PRICED model", () => {
  it("every live alias is requestable (an exact table key)", () => {
    for (const alias of LIVE_MODEL_IDS) {
      expect(isRequestableModel(alias)).toBe(true);
    }
  });

  it("an un-priced id is NOT requestable (free-inference lever closed)", () => {
    // Exactly the review's example: a real, expensive, un-priced OpenAI id.
    for (const forbidden of [
      "gpt-5.6-sol",
      "gpt-5.6-terra",
      "gpt-5.4-mini",
      "gemini-2.0-flash",
      "",
    ]) {
      expect(isRequestableModel(forbidden)).toBe(false);
    }
  });
});

describe("#98 review round 2, blocker 1 — client input ≠ metering resolution", () => {
  // Round 1 defined isRequestableModel as hasCostRate, so the suffix stripping
  // built for METERING (the id the PROVIDER echoes back) also governed CLIENT
  // INPUT. `gpt-4o-2024-05-13` is a DISTINCT snapshot with its own real price
  // and NO line in .claude/library/verdicts/ — yet it validated and would settle
  // at `gpt-4o`'s rate. Wrong money, from an id the client chose.
  const CLIENT_SNAPSHOTS = [
    "gpt-4o-2024-05-13",
    "gpt-4o-mini-2024-07-18",
    "gpt-5.6-luna-2026-08-01",
    "gemini-3.6-flash-002",
    "gemini-3.1-flash-lite-001",
  ] as const;

  it("a snapshot/versioned id is NOT requestable, even though it METERS", () => {
    for (const snapshot of CLIENT_SNAPSHOTS) {
      // It still prices — metering must keep working on echoed ids…
      expect(hasCostRate(snapshot)).toBe(true);
      // …but a CLIENT may not name it: that would charge one id at another's rate.
      expect(isRequestableModel(snapshot)).toBe(false);
    }
  });

  it("requestable is EXACT membership of the table, key for key", () => {
    const requestable = Object.keys(COST_OF_GOODS).filter(isRequestableModel);
    expect(requestable.sort()).toEqual(Object.keys(COST_OF_GOODS).sort());
    // No id outside the table's keys is requestable, by construction.
    for (const alias of LIVE_MODEL_IDS) {
      for (const echoed of echoedFormsOf(alias)) {
        expect(Object.hasOwn(COST_OF_GOODS, echoed)).toBe(false);
        expect(isRequestableModel(echoed)).toBe(false);
      }
    }
  });

  it("metering keeps its suffix strip — the two doors stayed different", () => {
    // The round-1 fix must NOT be undone: an echoed id still prices at its base.
    const usage: Usage = { inputTokens: 1_000_000, outputTokens: 1_000_000 };
    expect(costFor("gpt-4o-2024-05-13", usage)).toBeCloseTo(costFor("gpt-4o", usage), 8);
    expect(resolveRateModel("gemini-3.6-flash-002")).toBe("gemini-3.6-flash");
  });
});

describe("#98 MODEL-RATE GUARD — the table and the live id list agree 1:1", () => {
  it("each LIVE_MODEL_IDS entry resolves to a rate row (never silently metered at 0)", () => {
    expect(LIVE_MODEL_IDS.filter((m) => !hasCostRate(m))).toEqual([]);
  });

  it("each LIVE id ALSO prices in the form the provider echoes back", () => {
    // The pre-round-1 parity guard compared aliases against aliases and stayed
    // green in exactly the scenario where prod billed 0. This is the half that
    // was missing: the guard now runs on the id pricing actually receives.
    const usage: Usage = { inputTokens: 500_000, outputTokens: 250_000 };
    for (const alias of LIVE_MODEL_IDS) {
      for (const echoed of echoedFormsOf(alias)) {
        expect(hasCostRate(echoed)).toBe(true);
        expect(costFor(echoed, usage)).toBeCloseTo(costFor(alias, usage), 8);
        expect(costFor(echoed, usage)).toBeGreaterThan(0);
      }
    }
  });

  it("every rate-row model is listed as live (no orphan rows drift out of the guard)", () => {
    expect(Object.keys(COST_OF_GOODS).filter((m) => !LIVE_MODEL_IDS.includes(m))).toEqual([]);
  });

  it("no RETIRED model id comes back into the table or the live list", () => {
    for (const dead of RETIRED_MODEL_IDS) {
      expect(hasCostRate(dead)).toBe(false);
      expect(LIVE_MODEL_IDS).not.toContain(dead);
    }
  });

  it("every rate row is a positive input AND output rate", () => {
    for (const rate of Object.values(COST_OF_GOODS)) {
      expect(rate.input).toBeGreaterThan(0);
      expect(rate.output).toBeGreaterThan(0);
    }
  });
});

describe("#98 TRUE COST + PROVENANCE — margin is not welded into the table", () => {
  const src = readFileSync(join(import.meta.dirname, "cost-of-goods.ts"), "utf-8");

  it("carries the verified true rates, NOT the old margin-inflated blended ones", () => {
    // The pre-#98 rows were `gpt-4o-mini: 45` / `gpt-4o: 750` blended, ~20% over
    // cost. Margin now lives ONLY in credit_config `mult.<source>`.
    expect(COST_OF_GOODS["gpt-4o-mini"]).toEqual({ input: 15, output: 60 });
    expect(COST_OF_GOODS["gpt-4o"]).toEqual({ input: 250, output: 1000 });
    expect(COST_OF_GOODS["gemini-3.6-flash"]).toEqual({ input: 75, output: 375 });
    expect(COST_OF_GOODS["gemini-3.1-flash-lite"]).toEqual({ input: 25, output: 150 });
    // Adopted 2026-08-30 (human decision): the new OpenAI code default. Verdict
    // ai-price-verification-2026-08-29.md:27 — US$0.20/1M in · US$1.20/1M out.
    expect(COST_OF_GOODS["gpt-5.6-luna"]).toEqual({ input: 20, output: 120 });
  });

  it("the gpt-5.6-luna row cites the verdict it was adopted from", () => {
    const row = src.indexOf('"gpt-5.6-luna":');
    expect(row).toBeGreaterThan(0);
    const preamble = src.slice(Math.max(0, row - 600), row);
    expect(preamble).toContain("ai-price-verification-2026-08-29.md:27");
    expect(preamble).toContain("US$0.20/1M in");
    expect(preamble).toContain("US$1.20/1M out");
  });

  it("records that SSM — not the code default — picks the live model", () => {
    // Checked 2026-08-30: ai-provider=openai, openai-model=gpt-5.4-mini,
    // ai-model=gemini-3.1-flash-lite. gpt-5.4-mini has no first-party verified
    // price, so it must stay OUT of the table (never guessed) — the call then
    // charges 0 visibly instead of charging a made-up number.
    expect(src).toContain("SSM OVERRIDES THE CODE DEFAULT");
    expect(hasCostRate("gpt-5.4-mini")).toBe(false);
  });

  it("every row carries first-party provenance + a retrieval date", () => {
    for (const model of LIVE_MODEL_IDS) {
      const row = src.indexOf(`"${model}":`);
      expect(row).toBeGreaterThan(0);
      // The provenance comment sits directly above its row.
      const preamble = src.slice(Math.max(0, row - 400), row);
      expect(preamble).toMatch(/https:\/\//);
      expect(preamble).toMatch(/retrieved 2026-08-30/);
    }
  });

  it("documents the tiers it deliberately does NOT model", () => {
    for (const limit of ["272K", ">200K", "audio", "2027-01-01"]) {
      expect(src).toContain(limit);
    }
  });
});
