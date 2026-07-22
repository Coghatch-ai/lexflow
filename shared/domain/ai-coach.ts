// shared/domain/ai-coach.ts
//
// Weak-point coach ("Análise do Coach"): a one-shot AI digest of the student's
// own aggregates — weakest disciplines, recurring errors, and the fast-wrong
// (impulse/guess) vs slow-wrong (knowledge gap) timing signal — turned into a
// prioritized pt-BR action plan. Variable builder + parser are used SERVER-SIDE
// by coach.generate/finalize (api/trpc/routers/coach.router.ts); the API owns
// the prompt (api/lib/ai-prompts.ts), this module owns variables + parsing.

import { z } from "zod";

// A fresh digest is served from cache for this long; "Atualizar análise"
// bypasses the cooldown but still burns daily quota.
export const COACH_COOLDOWN_HOURS = 24;

// Daily cap on coach generations per user (shared ai_usage_daily counter with
// the tutor — the coach is heavier per call, so its own tighter limit).
export const COACH_DAILY_LIMIT = 3;

// The aggregates the digest is built from — assembled server-side, also stored
// as stats_snapshot on the digest row.
export type CoachStudentData = {
  totalAnswered: number;
  totalCorrect: number;
  accuracy: number;
  averageTimePerQuestion: number;
  disciplines: { discipline: string; label: string; totalAnswered: number; accuracy: number }[];
  timeBuckets: { bucket: string; total: number; errors: number }[];
  recurringErrorCount: number;
  recurringErrorDisciplines: string[];
  dueForReview: number;
  daysToExam: number | null;
};

export type CoachDigest = {
  diagnosis: string;
  priorities: { discipline: string; reason: string; severity: "alta" | "media" | "baixa" }[];
  actions: { title: string; detail: string }[];
};

export const coachDigestSchema = z.object({
  diagnosis: z.string().min(1),
  priorities: z
    .array(
      z.object({
        discipline: z.string().min(1),
        reason: z.string().min(1),
        severity: z.enum(["alta", "media", "baixa"]),
      }),
    )
    .max(5),
  actions: z.array(z.object({ title: z.string().min(1), detail: z.string().min(1) })).max(5),
});

// Minimum answered questions before a digest is meaningful — below this the
// router refuses to generate (no data → generic filler, the gimmick we killed).
export const COACH_MIN_ANSWERED = 20;

// Build the flat variable map for the server-owned "oab-coach" prompt. The
// aggregates travel as one pretty-printed JSON blob — flat substitution only.
export function buildCoachVariables(data: CoachStudentData): Record<string, string> {
  return { studentData: JSON.stringify(data, null, 2) };
}

// Parse the relay's raw text into a CoachDigest. Tolerant of stray prose or
// code fences around the JSON. Returns null when invalid.
export function parseCoachResponse(text: string): CoachDigest | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    const parsed = coachDigestSchema.safeParse(JSON.parse(text.slice(start, end + 1)));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
