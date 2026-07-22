import { describe, expect, it } from "vitest";
import { parseLegalRefs } from "./legal-refs";

describe("parseLegalRefs", () => {
  it("links CF/88 articles with Planalto anchors", () => {
    const refs = parseLegalRefs("CF/88, Art. 5º, XI; STF RHC 79.973/MG");
    expect(refs[0]).toEqual({
      label: "CF/88 art. 5º",
      url: "https://www.planalto.gov.br/ccivil_03/constituicao/constituicao.htm#art5",
    });
  });

  it("handles multiple segments and dedupes", () => {
    const refs = parseLegalRefs("CPC/2015, Art. 335, I; CPC, art. 335; CC art. 186");
    expect(refs.map((r) => r.label)).toEqual(["CPC art. 335", "CC art. 186"]);
    expect(refs[0]?.url).toContain("l13105.htm#art335");
  });

  it("links lettered articles (art. 44-B → #art44b)", () => {
    const refs = parseLegalRefs("CP, art. 44-B");
    expect(refs[0]?.url).toContain("#art44b");
  });

  it("links súmulas to the right court and vinculantes to the STF", () => {
    expect(parseLegalRefs("Súmula 377 do STJ")[0]).toEqual({
      label: "Súmula 377 STJ",
      url: "https://scon.stj.jus.br/SCON/sumstj/",
    });
    expect(parseLegalRefs("Súmula Vinculante 13")[0]?.label).toBe("Súmula Vinculante 13");
  });

  it("never links unknown laws; empty input → empty list", () => {
    expect(parseLegalRefs("Lei 9.099/95, art. 3º")).toEqual([]);
    expect(parseLegalRefs(null)).toEqual([]);
    expect(parseLegalRefs("  ")).toEqual([]);
  });
});
