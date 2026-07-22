// shared/data/lov.test.ts
//
// Unit tests for LOV_SEED integrity — disciplines must cover the full OAB
// 1ª Fase catalog with no duplicates and a contiguous sortOrder.

import { describe, it, expect } from "vitest";
import { LOV_SEED } from "./lov";

describe("LOV_SEED DISCIPLINE entries", () => {
  const disciplines = LOV_SEED.filter((r) => r.type === "DISCIPLINE");

  it("has exactly 31 entries (20 original + 11 added in #46)", () => {
    expect(disciplines).toHaveLength(31);
  });

  it("codes are unique", () => {
    const codes = disciplines.map((r) => r.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("sortOrder is contiguous 1..31", () => {
    const orders = disciplines.map((r) => r.sortOrder).sort((a, b) => a - b);
    expect(orders).toEqual(Array.from({ length: 31 }, (_, i) => i + 1));
  });

  it("sortOrder reflects pt-BR alphabetical order by value", () => {
    const sorted = [...disciplines].sort((a, b) => a.value.localeCompare(b.value, "pt-BR"));
    const byOrder = [...disciplines].sort((a, b) => a.sortOrder - b.sortOrder);
    expect(byOrder.map((r) => r.code)).toEqual(sorted.map((r) => r.code));
  });

  it("all codes are English (no pt-BR characters)", () => {
    const ptBrPattern = /[áàãâéêíóôõúçÁÀÃÂÉÊÍÓÔÕÚÇ]/u;
    for (const row of disciplines) {
      expect(ptBrPattern.test(row.code), `code has pt-BR chars: ${row.code}`).toBe(false);
    }
  });

  it("all values are non-empty strings", () => {
    for (const row of disciplines) {
      expect(row.value.length).toBeGreaterThan(0);
    }
  });
});
