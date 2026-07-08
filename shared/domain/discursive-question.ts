// shared/domain/discursive-question.ts
//
// Domain types + Zod schemas for OAB 2ª-fase (discursive / prático-profissional)
// questions. Shared between the import CLI (scripts/import-2fase-*.ts) and any
// future API/UI. These questions are NOT multiple-choice — they have no options
// and no text-match grading; study mode self-evaluates against `modelAnswer`.

import { z } from "zod";

export const QUESTION_TYPES = ["PECA_PRATICA", "DISCURSIVE"] as const;
export type QuestionType = (typeof QUESTION_TYPES)[number];

// The 7 DISCIPLINE codes that appear in OAB 2ª-fase provas. Used to filter the
// full DISCIPLINE LOV so the área dropdown in DiscursivePage only shows valid choices.
export const SECOND_PHASE_AREA_CODES = [
  "ADMINISTRATIVE_LAW",
  "CIVIL_LAW",
  "CONSTITUTIONAL_LAW",
  "LABOR_LAW",
  "COMMERCIAL_LAW",
  "CRIMINAL_LAW",
  "TAX_LAW",
] as const satisfies readonly string[];

export function isSecondPhaseArea(code: string): boolean {
  return (SECOND_PHASE_AREA_CODES as readonly string[]).includes(code);
}

// One extracted/draft item. The extractor emits "" for absent text fields and 0
// for an unknown line limit (structured-output schemas stay simpler without
// nullables); toRows() normalizes those to null when building DB rows.
export const discursiveItemSchema = z.object({
  questionType: z.enum(QUESTION_TYPES),
  orderIndex: z.number().int().min(0).max(20), // 0 = peça, 1–4 = discursivas
  statement: z.string().min(1),
  modelAnswer: z.string(), // "" when not captured
  maxPoints: z.number().nonnegative(), // 5 (peça) / 1.25 (discursiva)
  maxLines: z.number().int().nonnegative(), // 0 when unknown
  legalBasis: z.string(), // "" when none
  topic: z.string(), // "" when unclear
});
export type DiscursiveItem = z.infer<typeof discursiveItemSchema>;

// The draft file written by the extract step and read by the save step. The
// header (examLabel/examBoard/year/area) comes from CLI flags or the manifest,
// not from the PDF, so it's set deterministically rather than parsed.
export const discursiveDraftSchema = z.object({
  examLabel: z.string().min(1),
  examBoard: z.string().min(1),
  year: z.number().int().min(2000).max(2030),
  area: z.string().min(1), // DISCIPLINE LOV code (CIVIL_LAW, …)
  provaUrl: z.string().optional(), // source caderno PDF (recorded for traceability)
  padraoUrl: z.string().optional(), // source gabarito/padrão PDF
  items: z.array(discursiveItemSchema).min(1),
});
export type DiscursiveDraft = z.infer<typeof discursiveDraftSchema>;

// A row ready to upsert into oab_discursive_questions.
export type DiscursiveQuestionRow = {
  id: string;
  examLabel: string;
  examBoard: string;
  year: number;
  phase: "2nd";
  area: string;
  questionType: QuestionType;
  orderIndex: number;
  statement: string;
  modelAnswer: string | null;
  maxPoints: number;
  maxLines: number | null;
  legalBasis: string | null;
  topic: string | null;
};

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function nullIfEmpty(value: string): string | null {
  return value.trim().length > 0 ? value : null;
}

// Build deterministic rows from a draft. The id is derived from
// exam + area + position so re-running the save step upserts (idempotent)
// instead of inserting duplicates.
export function toRows(draft: DiscursiveDraft): DiscursiveQuestionRow[] {
  const examSlug = slug(draft.examLabel);
  const areaSlug = slug(draft.area);
  return draft.items.map((item) => {
    const tag = item.orderIndex === 0 ? "peca" : `q${item.orderIndex}`;
    return {
      id: `di-${examSlug}-${areaSlug}-${tag}`,
      examLabel: draft.examLabel,
      examBoard: draft.examBoard,
      year: draft.year,
      phase: "2nd",
      area: draft.area,
      questionType: item.questionType,
      orderIndex: item.orderIndex,
      statement: item.statement,
      modelAnswer: nullIfEmpty(item.modelAnswer),
      maxPoints: item.maxPoints,
      maxLines: item.maxLines > 0 ? item.maxLines : null,
      legalBasis: nullIfEmpty(item.legalBasis),
      topic: nullIfEmpty(item.topic),
    };
  });
}

// One row in oab_discursive_imports — the admin "what's already extracted" tracker.
export type DiscursiveImportRow = {
  id: string; // imp-<examSlug>-<areaSlug>
  examLabel: string;
  examBoard: string;
  year: number;
  phase: "2nd";
  area: string;
  itemCount: number;
  modelAnswerCount: number;
  provaUrl: string | null;
  padraoUrl: string | null;
};

// Summarize a draft into its import-tracking row (deterministic id → idempotent).
export function toImportRow(draft: DiscursiveDraft): DiscursiveImportRow {
  return {
    id: `imp-${slug(draft.examLabel)}-${slug(draft.area)}`,
    examLabel: draft.examLabel,
    examBoard: draft.examBoard,
    year: draft.year,
    phase: "2nd",
    area: draft.area,
    itemCount: draft.items.length,
    modelAnswerCount: draft.items.filter((i) => i.modelAnswer.trim().length > 0).length,
    provaUrl: draft.provaUrl ?? null,
    padraoUrl: draft.padraoUrl ?? null,
  };
}
