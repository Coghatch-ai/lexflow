// scripts/lib/banco-provas.ts
//
// Resolves OAB 2ª-fase PDF URLs from oabrj.org.br/banco-provas using a real
// (headless) Chromium — the JS-rendered listing 403s plain HTTP clients, but a
// browser renders fine. DOM layout (confirmed):
//   section.oabrj-section-subitem
//     h4.oabrj-section-subitem-titulo      -> exam title, e.g. "XL Exame Unificado - 2ª Fase"
//     div.oabrj-section-subitem-texto      -> <strong> labels ("Cadernos de prova" /
//                                             "Gabarito" / "Padrão de resposta") + <ul><li><a .pdf>
//
// Agnostic matching: find the section whose title matches the exam token AND is
// 2ª fase; within it, the caderno (prova) is the first non-gabarito PDF and the
// padrão is the first gabarito/padrão PDF, scoped to the chosen area.
//
// Format variants observed on the page (all handled here):
//   - Roman "Exame Unificado/de Ordem - 2ª Fase" (I…XL): ONE section, 7 links per
//     <strong> group ("Cadernos de prova" + "Gabarito"), one <a> per area; hosts
//     vary (s.oab.org.br, cloudfront, www.oabrj.org.br/arquivos/files). Fully supported.
//   - A few (XX, XIX) have NO <strong> groups (7 links, prova-only → no padrão).
//   - Arabic "33º…42º Exame de Ordem" are ancient CESPE-era exams (cespe.unb.br,
//     different format) — they resolve a prova link but are NOT the peça + 4
//     discursivas structure this pipeline expects; treat as out of scope.
//
// When the portal lists an exam twice (e.g. XXXIII has Aug + Dec editions), all
// matching sections are collected. The `edition` field (e.g. "2021-08", "2021-12")
// is parsed from the resolved prova href via /\/arquivos\/(\d{4})\/(\d{2})\//.
// If multiple sections match and no edition selector is given, fetchExamPdfs throws
// listing the available editions — it never silently picks the first.

import { chromium, type Locator, type Page } from "playwright";

const URL_BANCO = "https://www.oabrj.org.br/banco-provas";
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

// DISCIPLINE code -> distinctive substring in the area name / PDF filename.
const AREA_KEYWORDS: Record<string, string> = {
  CIVIL_LAW: "civil",
  CRIMINAL_LAW: "penal",
  TAX_LAW: "tribut",
  LABOR_LAW: "trabalh",
  CONSTITUTIONAL_LAW: "constitu",
  ADMINISTRATIVE_LAW: "administ",
  COMMERCIAL_LAW: "empres",
};

export interface ExamPdfs {
  examTitle: string;
  edition: string | null;
  provaUrl: string;
  padraoUrl: string | null;
  provaB64: string;
  padraoB64: string | null;
}

interface Link {
  href: string;
  text: string;
}

function norm(s: string): string {
  return s.toLowerCase();
}

// Pick the link for the chosen area: by area name in the link text/href, or the
// lone link when a group has just one (per-area sections).
function pickArea(links: Link[], areaKw: string): string | null {
  const m = links.find((l) => norm(l.text).includes(areaKw) || norm(l.href).includes(areaKw));
  if (m !== undefined) return m.href;
  return links.length === 1 && links[0] !== undefined ? links[0].href : null;
}

async function pdfLinksIn(section: Locator, baseUrl: string): Promise<Link[]> {
  const loc = section.locator("a");
  const n = await loc.count();
  const links: Link[] = [];
  for (let i = 0; i < n; i++) {
    const a = loc.nth(i);
    const raw = (await a.getAttribute("href")) ?? "";
    if (!/\.pdf(\?|$)|arquivos\//i.test(raw)) continue;
    links.push({ href: new URL(raw, baseUrl).href, text: ((await a.textContent()) ?? "").trim() });
  }
  return links;
}

// A section groups links under <strong> labels: "Cadernos de prova" then
// "Gabarito"/"Padrão de resposta", each with one <a> per area (link text = the
// area name; href is an opaque UUID). So classify by the GROUP label and match
// the area by link text — not by the href.
async function scanGroups(
  sec: Locator,
  areaKw: string,
  baseUrl: string,
): Promise<{ prova: string | null; padrao: string | null }> {
  const strongLoc = sec.locator("strong");
  const sCount = await strongLoc.count();
  let prova: string | null = null;
  let padrao: string | null = null;
  for (let j = 0; j < sCount; j++) {
    const label = norm(((await strongLoc.nth(j).textContent()) ?? "").trim());
    const isCaderno = /caderno|prova/.test(label);
    const isPad = /gabarito|padr|resposta|espelho/.test(label);
    if (!isCaderno && !isPad) continue;
    // The label is often wrapped (e.g. <p><strong>…</strong></p>) so the group's
    // <ul> is the next <ul> in document order, not a direct sibling.
    const links = await pdfLinksIn(strongLoc.nth(j).locator("xpath=following::ul[1]"), baseUrl);
    const pick = pickArea(links, areaKw);
    if (isCaderno && prova === null) prova = pick;
    else if (isPad && padrao === null) padrao = pick;
  }
  return { prova, padrao };
}

// Resolve prova + padrão within a matched section: group-label classification
// first; if that misses, fall back to ordered links (cadernos precede gabaritos
// in the DOM, the area name appears once per group).
async function resolveInSection(
  sec: Locator,
  areaKw: string,
  areaInTitle: boolean,
  baseUrl: string,
): Promise<{ prova: string | null; padrao: string | null }> {
  const grouped = await scanGroups(sec, areaKw, baseUrl);
  if (grouped.prova !== null) return grouped;
  const all = await pdfLinksIn(sec, baseUrl);
  const areaLinks = all.filter(
    (l) => areaInTitle || norm(l.text).includes(areaKw) || norm(l.href).includes(areaKw),
  );
  const pool = areaLinks.length > 0 ? areaLinks : all;
  return { prova: pool[0]?.href ?? null, padrao: grouped.padrao ?? pool[1]?.href ?? null };
}

export interface Match {
  title: string;
  prova: string | null;
  padrao: string | null;
  edition: string | null;
}

// Parse the edition string ("YYYY-MM") from a resolved prova href.
// Returns null when the href is null, opaque (UUID), or on a host that does not
// use the /arquivos/YYYY/MM/ path prefix.
export function parseEdition(href: string | null): string | null {
  if (href === null) return null;
  const m = href.match(/\/arquivos\/(\d{4})\/(\d{2})\//);
  if (m === null) return null;
  return `${m[1]}-${m[2]}`;
}

// Select a single Match from a non-empty array, optionally filtered by edition.
//
// Rules:
//   0 matches  → caller already throws via the no-match path; this fn is never
//                called with an empty array.
//   1 match    → return it (edition selector is ignored — any value is fine).
//   >1 matches where any edition is null → throw listing "(edition unknown)";
//                the selector cannot reliably disambiguate so fail loud.
//   >1 matches + no selector → throw listing available editions (FAIL LOUD).
//   selector given → filter to edition === selector; throw if 0 results or still >1.
export function selectEdition(matches: Match[], edition: string | null): Match {
  if (matches.length === 1) {
    const single = matches[0];
    // matches is non-empty so index 0 is always defined
    return single as Match;
  }

  const editionLabels = matches.map((m) => m.edition ?? "(edition unknown)");

  // If any match has a null edition the set is unresolvable — throw regardless
  // of whether a selector was given, so we never silently pick the wrong one.
  const hasNullEdition = matches.some((m) => m.edition === null);
  if (hasNullEdition) {
    throw new Error(
      `Exam matched ${matches.length.toString()} sections but edition cannot be determined for all of them: ${editionLabels.join(", ")}. Cannot disambiguate.`,
    );
  }

  if (edition === null) {
    throw new Error(
      `Exam matched ${matches.length.toString()} sections. Specify --edition with one of: ${editionLabels.join(", ")}`,
    );
  }

  const filtered = matches.filter((m) => m.edition === edition);
  if (filtered.length === 0) {
    throw new Error(
      `No section found for edition "${edition}". Available editions: ${editionLabels.join(", ")}`,
    );
  }
  if (filtered.length > 1) {
    throw new Error(
      `Edition "${edition}" still matched ${filtered.length.toString()} sections — cannot disambiguate.`,
    );
  }
  const result = filtered[0];
  return result as Match;
}

async function matchSection(
  page: Page,
  examRe: RegExp,
  areaKw: string,
): Promise<{ matches: Match[]; seen2a: string[] }> {
  const sections = page.locator("section.oabrj-section-subitem");
  const count = await sections.count();
  const seen2a: string[] = [];
  const matches: Match[] = [];
  for (let i = 0; i < count; i++) {
    const sec = sections.nth(i);
    const title = (
      (await sec.locator("h4.oabrj-section-subitem-titulo").first().textContent()) ?? ""
    ).trim();
    const is2a = /2ª\s*fase|segunda\s*fase/i.test(title);
    if (is2a) seen2a.push(title);
    if (!is2a || !examRe.test(title)) continue;
    const resolved = await resolveInSection(sec, areaKw, norm(title).includes(areaKw), page.url());
    matches.push({
      title,
      prova: resolved.prova,
      padrao: resolved.padrao,
      edition: parseEdition(resolved.prova),
    });
  }
  return { matches, seen2a };
}

// Download via the browser's network context (shares UA/cookies — avoids 403).
async function downloadB64(page: Page, url: string): Promise<string> {
  const resp = await page.context().request.get(url);
  if (!resp.ok()) throw new Error(`download ${url} -> HTTP ${resp.status()}`);
  return Buffer.from(await resp.body()).toString("base64");
}

export async function fetchExamPdfs(opts: {
  exam: string;
  area: string;
  headed: boolean;
  edition?: string;
}): Promise<ExamPdfs> {
  const areaKw = AREA_KEYWORDS[opts.area];
  if (areaKw === undefined) {
    throw new Error(
      `Unknown --area "${opts.area}". Known: ${Object.keys(AREA_KEYWORDS).join(", ")}`,
    );
  }
  const examRe = new RegExp(`\\b${opts.exam.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");

  const browser = await chromium.launch(
    opts.headed ? { headless: false, channel: "chrome" } : { headless: true },
  );
  try {
    const page = await browser.newPage({ userAgent: UA });
    await page.goto(URL_BANCO, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForSelector("section.oabrj-section-subitem", { timeout: 30000 });

    const { matches, seen2a } = await matchSection(page, examRe, areaKw);
    if (matches.length === 0) {
      const available = [...new Set(seen2a)];
      throw new Error(
        `No 2ª-fase section matched exam "${opts.exam}". 2ª-fase exams on the page:\n - ${available.join("\n - ")}`,
      );
    }

    const editionSelector = opts.edition ?? null;
    const match = selectEdition(matches, editionSelector);

    if (match.prova === null) {
      throw new Error(`Matched "${match.title}" but found no caderno PDF for area ${opts.area}.`);
    }
    const provaB64 = await downloadB64(page, match.prova);
    const padraoB64 = match.padrao !== null ? await downloadB64(page, match.padrao) : null;
    return {
      examTitle: match.title,
      edition: match.edition,
      provaUrl: match.prova,
      padraoUrl: match.padrao,
      provaB64,
      padraoB64,
    };
  } finally {
    await browser.close();
  }
}
