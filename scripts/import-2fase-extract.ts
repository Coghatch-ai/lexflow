// scripts/import-2fase-extract.ts
//
// Step 1 of the OAB 2ª-fase import: resolve the exam's PDFs from
// oabrj.org.br/banco-provas (via Playwright), have a Claude Code agent read them
// and structure them into a draft JSON, then write that draft to disk for
// review. NOTHING is written to the DB here — a human reviews/edits the draft,
// then runs `pnpm import:2fase:save <draft>` (step 2).
//
// You only say WHICH exam to run — the tool finds the PDF links itself:
//   pnpm import:2fase:extract --exam XL --area CIVIL_LAW --year 2024
//   pnpm import:2fase:extract --exam XL --area CIVIL_LAW --year 2024 --headed   # debug in a visible Chrome
//
// When the portal lists the same exam twice (e.g. XXXIII has Aug + Dec editions),
// you must pass --edition to select one, e.g.:
//   pnpm import:2fase:extract --exam XXXIII --area CIVIL_LAW --year 2021 --edition 2021-08
//   pnpm import:2fase:extract --exam XXXIII --area CIVIL_LAW --year 2021 --edition 2021-12
// Omitting --edition when multiple sections exist throws, listing the available editions.
// The resolved edition is encoded in the draft filename (e.g. xxxiii-civil_law-2021-12.draft.json)
// so Aug and Dec imports do not overwrite each other.
//
// Auth: extraction runs through the @anthropic-ai/claude-agent-sdk `query()`,
// which drives the Claude Code runtime and reuses YOUR Claude Code login — no API
// key, no separate credential. Claude Code reads the PDFs natively (Read tool).

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { query } from "@anthropic-ai/claude-agent-sdk";
import {
  discursiveDraftSchema,
  discursiveItemSchema,
  type DiscursiveItem,
} from "../shared/domain/discursive-question";
import { fetchExamPdfs } from "./lib/banco-provas";

function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === undefined) continue;
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    const val = argv[i + 1];
    if (val === undefined || val.startsWith("--")) {
      out[key] = "true";
    } else {
      out[key] = val;
      i++;
    }
  }
  return out;
}

const INSTRUCTIONS = [
  "The first PDF is the caderno de prova. It contains exactly:",
  "- 1 peça prático-profissional (a practical drafting task / situação-problema), worth 5.0 points.",
  "- 4 questões discursivas (situações-problema), worth 1.25 points each.",
  "The second PDF, if present, is the padrão de resposta / gabarito (official model answers / espelho).",
  "",
  "Produce one item per question:",
  "- The peça: questionType 'PECA_PRATICA', orderIndex 0, maxPoints 5.",
  "- The four discursivas: questionType 'DISCURSIVE', orderIndex 1..4, maxPoints 1.25.",
  "For each item:",
  "- statement: the full enunciation / situação-problema in Portuguese, including all case facts and the explicit instruction/quesito. Do not summarize.",
  '- modelAnswer: the official padrão de resposta for that exact item (match by number/letter). Use "" if no padrão was provided.',
  "- maxLines: the line limit if the prova states one (e.g. 30); otherwise 0.",
  '- legalBasis: the key legal dispositivos cited in the espelho (e.g. "CC art. 186; CDC art. 6º"); "" if none.',
  '- topic: a short pt-BR topic label (e.g. "Responsabilidade civil"); "" if unclear.',
  "",
  'Verification gate — before responding, confirm you extracted exactly 5 items (1 PECA_PRATICA at orderIndex 0 and 4 DISCURSIVE at orderIndex 1..4), each with a non-empty statement copied verbatim from the PDF. If the PDF does not contain this structure, is unreadable, or you would have to guess any statement, respond with exactly {"items":[]} and nothing else — never fabricate or summarize content to fill the shape.',
  "",
  'Respond with ONLY a JSON object of the form {"items":[{questionType,orderIndex,statement,modelAnswer,maxPoints,maxLines,legalBasis,topic}, ...]} — no markdown fences, no commentary.',
].join("\n");

// Pull the JSON object out of the agent's final text (tolerates stray fences/prose).
function extractJsonObject(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced?.[1] ?? text;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  return start === -1 || end === -1 ? body.trim() : body.slice(start, end + 1);
}

// Drive Claude Code to read the PDF(s) and return the validated draft items.
async function extractItems(provaB64: string, padraoB64: string | null): Promise<DiscursiveItem[]> {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "oab-2fase-"));
  try {
    fs.writeFileSync(path.join(tmp, "prova.pdf"), Buffer.from(provaB64, "base64"));
    const files = ["Caderno de prova: prova.pdf"];
    if (padraoB64 !== null) {
      fs.writeFileSync(path.join(tmp, "padrao.pdf"), Buffer.from(padraoB64, "base64"));
      files.push("Padrão de resposta: padrao.pdf");
    }

    const prompt = [
      "Read the PDF file(s) in the current directory and extract the OAB 2ª-fase questions.",
      ...files,
      "",
      INSTRUCTIONS,
    ].join("\n");

    console.warn("[extract] running Claude Code agent (claude-opus-4-8) to read the PDF(s)…");
    const q = query({
      prompt,
      options: {
        model: "claude-opus-4-8",
        cwd: tmp,
        allowedTools: ["Read"], // pre-approve PDF reads in headless; nothing else
        settingSources: [], // clean room — don't load project CLAUDE.md / hooks
        maxTurns: 40, // long padrão PDFs can take several Read turns before the JSON
      },
    });

    let resultText = "";
    for await (const m of q) {
      if (m.type === "result" && m.subtype === "success") resultText = m.result;
    }
    if (resultText.trim().length === 0) {
      throw new Error("Claude Code agent returned no result text");
    }

    let parsed: unknown;
    const jsonText = extractJsonObject(resultText);
    try {
      parsed = JSON.parse(jsonText);
    } catch {
      throw new Error(`Could not JSON.parse agent output:\n${jsonText.slice(0, 2000)}`);
    }
    return discursiveItemSchema.array().parse((parsed as { items?: unknown }).items);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const exam = args["exam"];
  const area = args["area"];
  const yearStr = args["year"];
  if (exam === undefined || exam.length === 0) {
    throw new Error("Missing --exam (e.g. --exam XL — matched against the page section title)");
  }
  if (area === undefined || area.length === 0) {
    throw new Error("Missing --area (a DISCIPLINE code, e.g. CIVIL_LAW)");
  }
  if (yearStr === undefined) throw new Error("Missing --year (e.g. --year 2024)");
  const year = parseInt(yearStr, 10);
  if (Number.isNaN(year)) throw new Error(`Invalid --year: ${yearStr}`);
  const board = args["board"] ?? "FGV";
  const headed = args["headed"] === "true";
  const editionArg = args["edition"];
  // Validate --edition format: must be YYYY-MM or absent. parseArgs sets a flag
  // to "true" when no value follows (e.g. `--edition` with no argument).
  if (editionArg !== undefined && !/^\d{4}-\d{2}$/.test(editionArg)) {
    throw new Error(`Invalid --edition "${editionArg}". Expected format: YYYY-MM (e.g. 2021-12).`);
  }

  console.warn(`[extract] resolving PDFs for exam "${exam}" / ${area} on banco-provas…`);
  const { examTitle, edition, provaUrl, padraoUrl, provaB64, padraoB64 } = await fetchExamPdfs({
    exam,
    area,
    headed,
    ...(editionArg !== undefined ? { edition: editionArg } : {}),
  });
  console.warn(
    `[extract] matched section: "${examTitle}"${edition !== null ? ` (edition ${edition})` : ""}`,
  );
  console.warn(
    `[extract] downloaded prova${padraoB64 !== null ? " + padrão" : " (no padrão found)"}`,
  );

  const items = await extractItems(provaB64, padraoB64);
  const draft = discursiveDraftSchema.parse({
    examLabel: examTitle,
    examBoard: board,
    year,
    area,
    provaUrl,
    padraoUrl: padraoUrl ?? undefined,
    items,
  });

  const outDir = path.resolve("scripts/out");
  fs.mkdirSync(outDir, { recursive: true });
  const examSlug = exam
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const editionSuffix = edition !== null ? `-${edition}` : "";
  const outPath = path.join(outDir, `${examSlug}-${area.toLowerCase()}${editionSuffix}.draft.json`);
  fs.writeFileSync(outPath, `${JSON.stringify(draft, null, 2)}\n`, "utf-8");

  console.warn(`[extract] ✓ wrote ${draft.items.length} items → ${outPath}`);
  console.warn(`[extract] REVIEW/EDIT the draft, then: pnpm import:2fase:save ${outPath}`);
}

main().catch((err: unknown) => {
  console.error("[extract] ✗ failed:", err);
  process.exit(1);
});
