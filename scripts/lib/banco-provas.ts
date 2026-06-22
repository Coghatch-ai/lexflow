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

interface Match {
  title: string;
  prova: string | null;
  padrao: string | null;
}

async function matchSection(
  page: Page,
  examRe: RegExp,
  areaKw: string,
): Promise<{ match: Match | null; seen2a: string[] }> {
  const sections = page.locator("section.oabrj-section-subitem");
  const count = await sections.count();
  const seen2a: string[] = [];
  for (let i = 0; i < count; i++) {
    const sec = sections.nth(i);
    const title = (
      (await sec.locator("h4.oabrj-section-subitem-titulo").first().textContent()) ?? ""
    ).trim();
    const is2a = /2ª\s*fase|segunda\s*fase/i.test(title);
    if (is2a) seen2a.push(title);
    if (!is2a || !examRe.test(title)) continue;
    const resolved = await resolveInSection(sec, areaKw, norm(title).includes(areaKw), page.url());
    return { match: { title, prova: resolved.prova, padrao: resolved.padrao }, seen2a };
  }
  return { match: null, seen2a };
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

    const { match, seen2a } = await matchSection(page, examRe, areaKw);
    if (match === null) {
      throw new Error(
        `No 2ª-fase section matched exam "${opts.exam}". 2ª-fase exams on the page:\n - ${seen2a.slice(0, 25).join("\n - ")}`,
      );
    }
    if (match.prova === null) {
      throw new Error(`Matched "${match.title}" but found no caderno PDF for area ${opts.area}.`);
    }
    const provaB64 = await downloadB64(page, match.prova);
    const padraoB64 = match.padrao !== null ? await downloadB64(page, match.padrao) : null;
    return {
      examTitle: match.title,
      provaUrl: match.prova,
      padraoUrl: match.padrao,
      provaB64,
      padraoB64,
    };
  } finally {
    await browser.close();
  }
}
