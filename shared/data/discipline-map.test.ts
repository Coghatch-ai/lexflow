// shared/data/discipline-map.test.ts
import { describe, expect, it } from "vitest";
import {
  resolveDisciplineCode,
  DISCIPLINE_CODES,
  FULL_DISCIPLINE_LABEL_TO_CODE,
} from "./discipline-map";
import { LOV_SEED } from "./lov";

// All DISCIPLINE codes from LOV_SEED (the canonical list).
const lovDisciplineCodes = new Set(
  LOV_SEED.filter((r) => r.type === "DISCIPLINE").map((r) => r.code),
);

describe("resolveDisciplineCode — known labels", () => {
  it("resolves exact LOV value → code", () => {
    expect(resolveDisciplineCode("Direito Civil")).toBe("CIVIL_LAW");
    expect(resolveDisciplineCode("Direito Constitucional")).toBe("CONSTITUTIONAL_LAW");
    expect(resolveDisciplineCode("Ética Profissional")).toBe("LEGAL_ETHICS");
    expect(resolveDisciplineCode("Processo Civil")).toBe("CIVIL_PROCEDURE");
    expect(resolveDisciplineCode("Processo Penal")).toBe("CRIMINAL_PROCEDURE");
    expect(resolveDisciplineCode("Processo do Trabalho")).toBe("LABOR_PROCEDURE");
  });

  it("resolves verbose scraper aliases → existing code", () => {
    expect(
      resolveDisciplineCode(
        "Estatuto da Advocacia e da OAB, Regulamento Geral, Código de Ética e Disciplina e Estatuto da Caixa de Assistência dos Advogados",
      ),
    ).toBe("LEGAL_ETHICS");
    expect(resolveDisciplineCode("Direito Processual Civil - Novo CPC 2015")).toBe(
      "CIVIL_PROCEDURE",
    );
    expect(resolveDisciplineCode("Direito Processual Penal")).toBe("CRIMINAL_PROCEDURE");
    expect(resolveDisciplineCode("Direito Processual do Trabalho")).toBe("LABOR_PROCEDURE");
    expect(resolveDisciplineCode("Direito Empresarial (Comercial)")).toBe("COMMERCIAL_LAW");
    expect(
      resolveDisciplineCode(
        "Direito da Criança e do Adolescente - ECA (Estatuto da Criança e do Adolescente)",
      ),
    ).toBe("CHILD_ADOLESCENT_LAW");
  });

  it("merges Internacional Público + Privado → INTERNATIONAL_LAW", () => {
    expect(resolveDisciplineCode("Direito Internacional Público")).toBe("INTERNATIONAL_LAW");
    expect(resolveDisciplineCode("Direito Internacional Privado")).toBe("INTERNATIONAL_LAW");
  });

  it("resolves the 11 new LOV codes added in #46", () => {
    expect(resolveDisciplineCode("Legislação Federal")).toBe("FEDERAL_LEGISLATION");
    expect(resolveDisciplineCode("Direito Digital")).toBe("DIGITAL_LAW");
    expect(resolveDisciplineCode("Estatuto da Pessoa com Deficiência")).toBe(
      "DISABLED_PERSON_STATUTE",
    );
    expect(resolveDisciplineCode("Sociologia")).toBe("SOCIOLOGY");
    expect(resolveDisciplineCode("Filosofia")).toBe("PHILOSOPHY");
    expect(resolveDisciplineCode("Legislação de Trânsito")).toBe("TRAFFIC_LEGISLATION");
    expect(resolveDisciplineCode("Direito Econômico")).toBe("ECONOMIC_LAW");
    expect(resolveDisciplineCode("Direito Notarial e Registral")).toBe("NOTARY_REGISTRY_LAW");
    expect(resolveDisciplineCode("Controle Externo")).toBe("EXTERNAL_CONTROL");
    expect(resolveDisciplineCode("Direito Urbanístico")).toBe("URBAN_LAW");
    expect(resolveDisciplineCode("Estatuto da Pessoa Idosa")).toBe("ELDERLY_PERSON_STATUTE");
  });
});

describe("resolveDisciplineCode — unknown label throws", () => {
  it("throws on a raw label absent from the map", () => {
    expect(() => resolveDisciplineCode("Direito Espacial")).toThrowError(
      /unmapped discipline label/,
    );
  });

  it("throws on an empty string", () => {
    expect(() => resolveDisciplineCode("")).toThrowError(/unmapped discipline label/);
  });

  it("throws on a partial/typo match (case-sensitive, exact)", () => {
    expect(() => resolveDisciplineCode("direito civil")).toThrowError(/unmapped discipline label/);
  });
});

describe("DISCIPLINE_CODES invariant", () => {
  it("DISCIPLINE_CODES matches LOV_SEED DISCIPLINE entries", () => {
    expect(DISCIPLINE_CODES).toEqual(lovDisciplineCodes);
  });

  it("LOV_SEED has 31 DISCIPLINE entries (20 original + 11 new)", () => {
    expect(lovDisciplineCodes.size).toBe(31);
  });

  it("every code emitted by FULL_DISCIPLINE_LABEL_TO_CODE is a valid LOV code", () => {
    for (const [label, code] of FULL_DISCIPLINE_LABEL_TO_CODE) {
      expect(lovDisciplineCodes, `label "${label}" → "${code}" not in LOV`).toContain(code);
    }
  });
});
