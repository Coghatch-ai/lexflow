// shared/domain/legal-refs.ts
//
// Parses the free-text `legal_basis` of a question into tappable references —
// Planalto article deep-links for statutes, court search pages for súmulas.
// Deliberately conservative: only laws in the known map produce links; anything
// unrecognized is simply not linked (never a wrong link). This is phase (a) of
// citation grounding — a later ingest can swap the external link for in-app text.

export type LegalRef = { label: string; url: string };

// Known statutes → Planalto compiled-text URL. Anchors follow Planalto's
// `#artN` / `#artNa` convention (ordinal º dropped, letter suffix lowercased).
const LAW_URLS: { pattern: RegExp; code: string; url: string }[] = [
  {
    pattern: /\b(?:CF(?:\/88)?|CRFB(?:\/88)?|Constitui[çc][ãa]o)\b/i,
    code: "CF/88",
    url: "https://www.planalto.gov.br/ccivil_03/constituicao/constituicao.htm",
  },
  {
    pattern: /\bCC\b|C[óo]digo Civil/i,
    code: "CC",
    url: "https://www.planalto.gov.br/ccivil_03/leis/2002/l10406compilada.htm",
  },
  {
    pattern: /\bCPC(?:\/2015)?\b|C[óo]digo de Processo Civil/i,
    code: "CPC",
    url: "https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2015/lei/l13105.htm",
  },
  {
    pattern: /\bCP\b|C[óo]digo Penal/i,
    code: "CP",
    url: "https://www.planalto.gov.br/ccivil_03/decreto-lei/del2848compilado.htm",
  },
  {
    pattern: /\bCPP\b|C[óo]digo de Processo Penal/i,
    code: "CPP",
    url: "https://www.planalto.gov.br/ccivil_03/decreto-lei/del3689compilado.htm",
  },
  {
    pattern: /\bCLT\b/i,
    code: "CLT",
    url: "https://www.planalto.gov.br/ccivil_03/decreto-lei/del5452compilado.htm",
  },
  {
    pattern: /\bCDC\b|C[óo]digo de Defesa do Consumidor/i,
    code: "CDC",
    url: "https://www.planalto.gov.br/ccivil_03/leis/l8078compilado.htm",
  },
  {
    pattern: /\bCTN\b|C[óo]digo Tribut[áa]rio/i,
    code: "CTN",
    url: "https://www.planalto.gov.br/ccivil_03/leis/l5172compilado.htm",
  },
  {
    pattern: /\bEstatuto da (?:OAB|Advocacia)\b|\bLei\s*(?:n[ºo.]?\s*)?8\.?906\b/i,
    code: "EAOAB",
    url: "https://www.planalto.gov.br/ccivil_03/leis/l8906.htm",
  },
];

const SUMULA_URLS: Record<string, string> = {
  STF: "https://portal.stf.jus.br/jurisprudencia/sumariosumulas.asp",
  STJ: "https://scon.stj.jus.br/SCON/sumstj/",
  TST: "https://jurisprudencia.tst.jus.br/",
};

// "Art. 5º, XI" → "#art5"; "art. 44-B" → "#art44b".
function articleAnchor(article: string): string {
  const m = /(\d+)\s*(?:[ºo°])?\s*(?:-\s*([A-Za-z]))?/.exec(article);
  if (m === null) return "";
  const letter = m[2] !== undefined ? m[2].toLowerCase() : "";
  return `#art${m[1] ?? ""}${letter}`;
}

// One statute reference from a segment (or null when no known law is cited).
function parseLawRef(segment: string): LegalRef | null {
  const law = LAW_URLS.find((l) => l.pattern.test(segment));
  if (law === undefined) return null;
  const art = /art(?:igo)?s?\.?\s*(\d+\s*(?:[ºo°])?\s*(?:-\s*[A-Za-z])?)/i.exec(segment);
  if (art === null) return { label: law.code, url: law.url };
  const article = art[1]?.trim() ?? "";
  return { label: `${law.code} art. ${article}`, url: `${law.url}${articleAnchor(article)}` };
}

// One súmula reference (vinculante → STF) from a segment, or null.
function parseSumulaRef(segment: string): LegalRef | null {
  const m = /S[úu]mula\s*(Vinculante)?\s*(?:n[ºo.]?\s*)?(\d+)(?:[^;]*?\b(STF|STJ|TST)\b)?/i.exec(
    segment,
  );
  if (m === null) return null;
  const vinculante = m[1] !== undefined;
  const court = vinculante ? "STF" : (m[3]?.toUpperCase() ?? null);
  if (court === null) return null;
  const url = SUMULA_URLS[court];
  if (url === undefined) return null;
  const label = vinculante ? `Súmula Vinculante ${m[2] ?? ""}` : `Súmula ${m[2] ?? ""} ${court}`;
  return { label, url };
}

// Extract linkable references from a legal_basis free-text string.
export function parseLegalRefs(legalBasis: string | null): LegalRef[] {
  if (legalBasis === null || legalBasis.trim().length === 0) return [];
  const refs: LegalRef[] = [];
  const seen = new Set<string>();
  const push = (ref: LegalRef | null): void => {
    if (ref !== null && !seen.has(ref.label)) {
      seen.add(ref.label);
      refs.push(ref);
    }
  };
  // Split on separators so each segment carries at most one law + article.
  for (const segment of legalBasis.split(/[;•\n]/)) {
    push(parseLawRef(segment));
    push(parseSumulaRef(segment));
  }
  return refs;
}
