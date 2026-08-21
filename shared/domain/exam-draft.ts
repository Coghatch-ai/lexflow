// shared/domain/exam-draft.ts
//
// The in-flight exam draft (BR-05, epic #67 slice S2/S2a): the pure rules shared
// by the API (server-side persistence + lazy settlement of an abandoned prova
// real) and the app (save / resume). No React, no tRPC, no DB — unit-testable
// with plain vitest, no jsdom.
//
// A row in `exam_drafts` exists ⇔ the run is still in progress. Deleted = it was
// processed (through the single `sessions.record` path) or discarded. There is
// no status column and no revision column: `last_saved_at` doubles as the
// optimistic-concurrency token.
//
// SINGLE SOURCE: `RunMode`, `AnswerDraft` and `processableAnswers` live HERE
// and are re-exported by `app/src/shared/lib/exit-rules.ts`, not the other way
// round — `tsconfig.api.json` only compiles api/ + drizzle/ + shared/ +
// scripts/, so a root-`shared/` module can never import from `app/src/`.

import type { AdaptiveState } from "./adaptive";

/**
 * The four desktop answering surfaces (also the `exam_drafts.mode` values).
 * The VALUE is the source and `RunMode` is derived from it, so the router's
 * `z.enum(RUN_MODES)` and the type can never drift apart: adding a mode here is
 * a compile-time change everywhere the union is switched on, and the input
 * validator accepts the new mode without a second hand-written list.
 */
export const RUN_MODES = ["standard", "adaptive", "spaced", "real"] as const;

export type RunMode = (typeof RUN_MODES)[number];

/**
 * The modes a saved run may be OFFERED BACK from — the three study modes.
 * BR-05.5: the prova real is never offered back to continue, however fresh its
 * row is; it only ever ends through settlement. The list is here, in the shared
 * domain, because both sides of the boundary need it: `examDrafts.list` filters
 * on it server-side (the rule cannot live in whichever screen renders the
 * cards) and the resume UI reads the same constant.
 */
export const RESUMABLE_MODES: readonly RunMode[] = ["standard", "adaptive", "spaced"];

/** BR-05.5 as a predicate: `real` never resumes, the study modes always do. */
export function isResumableMode(mode: string): boolean {
  return RESUMABLE_MODES.some((resumable) => resumable === mode);
}

/** One recorded answer, exactly the shape `sessions.record` takes. */
export interface AnswerDraft {
  questionId: string;
  userAnswer: string;
  correct: boolean;
  timeSpent: number;
}

/**
 * How the run was set up — what the resume path needs to rebuild the screen's
 * header/filters. Discriminated by mode; the spaced and real modes carry no
 * setup at all (their queue is fully described by the frozen `questionIds`).
 */
export type ExamDraftSetup =
  | { mode: "standard"; discipline: string; examBoard: string | null; difficulty: string | null }
  | { mode: "adaptive"; discipline: string; totalQuestions: number }
  | { mode: "spaced" }
  | { mode: "real" };

/**
 * Per-mode progress that is NOT in the universal columns. Cross-out, `checked`,
 * `flagged` and `postponed` are drafts, not progress, and are never persisted
 * (BR-02.3, epic #67 D8).
 */
export type ExamDraftModeState =
  | { mode: "standard"; carriedTime: Record<string, number> }
  | { mode: "spaced" }
  | { mode: "adaptive"; adaptive: AdaptiveState; totalQuestions: number; deferredIds: string[] }
  | { mode: "real" };

/** The universal part of a persisted run — all the pure rules need. */
export interface ExamDraftSnapshot {
  questionIds: readonly string[];
  cursor: number;
  answers: readonly AnswerDraft[];
}

/** Result of reconciling a persisted run against the live question catalog. */
export interface ReconciledRun {
  questionIds: string[];
  cursor: number;
  answers: AnswerDraft[];
  /** How many queued questions vanished from the catalog. */
  dropped: number;
  /** Nothing survived — the run cannot be resumed and must be discarded. */
  discard: boolean;
}

/** No heartbeat for this long ⇒ the prova real tab is dead (3 missed beats). */
export const REAL_RUN_STALE_SECONDS = 180;

/**
 * A blank answer is never recorded (BR-05.6, consistent with BR-03): an
 * unanswered question is not an error, never reaches `user_answers` and never
 * touches the SM-2 schedule.
 */
export function processableAnswers(drafts: readonly AnswerDraft[]): AnswerDraft[] {
  return drafts.filter((a) => a.userAnswer.length > 0);
}

/**
 * Clamps a persisted cursor onto a queue of `survivorCount` questions. The
 * cursor always addresses a question (a live row means the run is unfinished),
 * so the top of the range is the last index. An empty queue yields 0 — that run
 * is discarded by `reconcileRun` anyway.
 */
export function resumeCursor(cursor: number, survivorCount: number): number {
  if (survivorCount <= 0) return 0;
  if (!Number.isFinite(cursor) || cursor < 0) return 0;
  return Math.min(Math.trunc(cursor), survivorCount - 1);
}

/**
 * Drops every question that left the catalog — from the queue AND from the
 * answers — and re-anchors the cursor onto the same question the student was
 * on (or, if that one vanished, onto the survivor that took its place).
 *
 * MUST run before every write of a run's answers: `user_answers.question_id`
 * has an FK to `oab_questions`, so recording an answer to a deleted question
 * takes the whole transaction down (that is also why the server-side
 * settlement of the prova real reconciles first).
 */
export function reconcileRun(run: ExamDraftSnapshot, catalogIds: Iterable<string>): ReconciledRun {
  const catalog = catalogIds instanceof Set ? catalogIds : new Set(catalogIds);
  const questionIds = run.questionIds.filter((id) => catalog.has(id));
  const answers = run.answers.filter((a) => catalog.has(a.questionId));

  const anchorId = run.questionIds[Math.max(0, Math.trunc(run.cursor))];
  const anchored =
    anchorId !== undefined && catalog.has(anchorId)
      ? questionIds.indexOf(anchorId)
      : run.questionIds.slice(0, Math.max(0, run.cursor)).filter((id) => catalog.has(id)).length;

  return {
    questionIds,
    answers,
    cursor: resumeCursor(anchored, questionIds.length),
    dropped: run.questionIds.length - questionIds.length,
    discard: questionIds.length === 0,
  };
}

/** The answers a run may hand to `sessions.record` (never a blank one). */
export function answersForRecord(run: ExamDraftSnapshot): AnswerDraft[] {
  return processableAnswers(run.answers);
}

/** The "n" of the "Continuar (n/N)" card — answered, never the queue length. */
export function answeredOf(run: ExamDraftSnapshot): number {
  return processableAnswers(run.answers).length;
}

/**
 * Whether a prova real must be settled server-side. There is no scheduler in
 * this project (Lambda behind API Gateway, no EventBridge), so an abrupt exit
 * is detected lazily on the student's next authenticated contact: the clock ran
 * out, or the 60 s heartbeat has been silent for `staleSeconds`.
 *
 * A fresh heartbeat before the deadline is NOT abandonment — that is the case
 * that keeps a student who merely opened another tab from being auto-submitted.
 * Unparseable timestamps also answer `false`: never auto-submit on a guess.
 */
export function isRealRunAbandoned({
  deadlineAt,
  lastSavedAt,
  now,
  staleSeconds = REAL_RUN_STALE_SECONDS,
}: {
  deadlineAt: string | null;
  lastSavedAt: string;
  now: string;
  staleSeconds?: number;
}): boolean {
  const nowMs = Date.parse(now);
  if (Number.isNaN(nowMs)) return false;

  if (deadlineAt !== null) {
    const deadlineMs = Date.parse(deadlineAt);
    if (!Number.isNaN(deadlineMs) && deadlineMs <= nowMs) return true;
  }

  const lastSavedMs = Date.parse(lastSavedAt);
  if (Number.isNaN(lastSavedMs)) return false;
  return lastSavedMs < nowMs - staleSeconds * 1000;
}
