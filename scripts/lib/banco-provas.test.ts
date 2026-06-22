// scripts/lib/banco-provas.test.ts
//
// Unit tests for the pure helpers exported from banco-provas.ts:
//   parseEdition  — href -> "YYYY-MM" or null
//   selectEdition — Match[] + edition selector -> single Match or throw

import { describe, expect, it } from "vitest";
import { parseEdition, selectEdition, toHttpsIfOabCdn, type Match } from "./banco-provas";

// ---------------------------------------------------------------------------
// toHttpsIfOabCdn
// ---------------------------------------------------------------------------

describe("toHttpsIfOabCdn", () => {
  it("upgrades http:// s.oab.org.br to https://", () => {
    expect(
      toHttpsIfOabCdn(
        "http://s.oab.org.br/arquivos/2020/12/79440c0b-f031-4dcd-8c50-9a59d5dc6990.pdf",
      ),
    ).toBe("https://s.oab.org.br/arquivos/2020/12/79440c0b-f031-4dcd-8c50-9a59d5dc6990.pdf");
  });

  it("upgrades http:// www.oabrj.org.br to https://", () => {
    expect(toHttpsIfOabCdn("http://www.oabrj.org.br/arquivos/files/caderno-xxxi-civil.pdf")).toBe(
      "https://www.oabrj.org.br/arquivos/files/caderno-xxxi-civil.pdf",
    );
  });

  it("leaves an already-https s.oab.org.br URL untouched", () => {
    const url = "https://s.oab.org.br/arquivos/2024/05/3ba70566-e372-443c-ad52-3f476ea59389.pdf";
    expect(toHttpsIfOabCdn(url)).toBe(url);
  });

  it("leaves an already-https www.oabrj.org.br URL untouched", () => {
    const url = "https://www.oabrj.org.br/banco-provas";
    expect(toHttpsIfOabCdn(url)).toBe(url);
  });

  it("does NOT upgrade http:// on an unrelated host", () => {
    const url = "http://example.com/caderno.pdf";
    expect(toHttpsIfOabCdn(url)).toBe(url);
  });

  it("does NOT upgrade http:// on a cloudfront host", () => {
    const url = "http://d1abc123.cloudfront.net/caderno.pdf";
    expect(toHttpsIfOabCdn(url)).toBe(url);
  });
});

// ---------------------------------------------------------------------------
// parseEdition
// ---------------------------------------------------------------------------

describe("parseEdition", () => {
  it("returns YYYY-MM from a known /arquivos/YYYY/MM/ href", () => {
    expect(parseEdition("https://www.oabrj.org.br/arquivos/2021/12/caderno-xxxiii-civil.pdf")).toBe(
      "2021-12",
    );
  });

  it("returns the August edition from a different path depth", () => {
    expect(parseEdition("https://www.oabrj.org.br/arquivos/2021/08/caderno-xxxiii-penal.pdf")).toBe(
      "2021-08",
    );
  });

  it("returns null for a cloudfront / opaque-UUID href (no /arquivos/YYYY/MM/ segment)", () => {
    expect(
      parseEdition(
        "https://d1abc123.cloudfront.net/f3a4b5c6-d7e8-9012-abcd-ef1234567890/caderno.pdf",
      ),
    ).toBeNull();
  });

  it("returns null for an s.oab.org.br href without the date prefix", () => {
    expect(parseEdition("https://s.oab.org.br/oabrj/exames/2fase/xxxvii-civil.pdf")).toBeNull();
  });

  it("returns null when href is null", () => {
    expect(parseEdition(null)).toBeNull();
  });

  it("returns null for an empty string", () => {
    expect(parseEdition("")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// selectEdition
// ---------------------------------------------------------------------------

const makeMatch = (edition: string | null, title = "XXXIII 2ª Fase"): Match => ({
  title,
  prova:
    edition !== null ? `https://example.org/arquivos/${edition.replace("-", "/")}/prova.pdf` : null,
  padrao: null,
  edition,
});

describe("selectEdition", () => {
  it("returns the sole match when there is exactly one (selector ignored)", () => {
    const m = makeMatch("2021-08");
    expect(selectEdition([m], null)).toBe(m);
  });

  it("returns the sole match even when a non-matching selector is given (1-match shortcut)", () => {
    // single match → always returned regardless of selector value
    const m = makeMatch("2021-08");
    expect(selectEdition([m], "2021-12")).toBe(m);
  });

  it("throws listing both editions when >1 match and no selector", () => {
    const aug = makeMatch("2021-08");
    const dec = makeMatch("2021-12");
    expect(() => selectEdition([aug, dec], null)).toThrowError(/2021-08.*2021-12|2021-12.*2021-08/);
  });

  it("throw message mentions --edition and lists editions", () => {
    const aug = makeMatch("2021-08");
    const dec = makeMatch("2021-12");
    expect(() => selectEdition([aug, dec], null)).toThrowError(/--edition/);
  });

  it("returns the December match when selector is '2021-12'", () => {
    const aug = makeMatch("2021-08");
    const dec = makeMatch("2021-12");
    expect(selectEdition([aug, dec], "2021-12")).toBe(dec);
  });

  it("returns the August match when selector is '2021-08'", () => {
    const aug = makeMatch("2021-08");
    const dec = makeMatch("2021-12");
    expect(selectEdition([aug, dec], "2021-08")).toBe(aug);
  });

  it("throws with available editions listed when selector matches nothing", () => {
    const aug = makeMatch("2021-08");
    const dec = makeMatch("2021-12");
    expect(() => selectEdition([aug, dec], "2021-06")).toThrowError(/2021-08/);
    expect(() => selectEdition([aug, dec], "2021-06")).toThrowError(/2021-12/);
  });

  it("throws when >1 match and any edition is null (unresolvable)", () => {
    const known = makeMatch("2021-08");
    const unknown = makeMatch(null);
    expect(() => selectEdition([known, unknown], "2021-08")).toThrowError(/edition unknown/);
  });

  it("throws '(edition unknown)' in message for two null-edition matches with no selector", () => {
    const a = makeMatch(null, "XXXIII 2ª Fase A");
    const b = makeMatch(null, "XXXIII 2ª Fase B");
    const err = (): void => {
      selectEdition([a, b], null);
    };
    expect(err).toThrowError(/edition unknown/);
  });
});
