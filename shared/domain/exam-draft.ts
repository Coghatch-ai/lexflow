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
// and are re-exported by `shared/run/exit-rules.ts`, not the other way
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

/** The difficulty a finished run is filed under (`study_sessions.difficulty`). */
export type SessionDifficulty = "easy" | "medium" | "hard";

/**
 * What a finished PROVA REAL is filed as — the pair the browser has always sent
 * from RealExamSimulation. Here, in the shared domain, and not next to one of
 * the two writers, because BOTH paths that end a real run have to agree: the
 * server-side settlement (`settleRealRun`) and the student's own submit
 * (`sessions.record`). One run = one filing, whichever door it leaves by.
 */
export const REAL_EXAM_DISCIPLINE = "Prova Real";
export const REAL_EXAM_DIFFICULTY: SessionDifficulty = "hard";

/** How a finished run is filed: the two `study_sessions` label columns. */
export interface SessionFiling {
  discipline: string;
  difficulty: SessionDifficulty;
}

/**
 * BR-05.5 as a function: a prova real ALWAYS becomes a "Prova Real"/hard
 * session, whatever the caller asked for. The mode of the row that was actually
 * CLAIMED decides — never the payload, because the payload is client input.
 *
 * `examDrafts.get({ mode: "real" })` hands the browser the real draft's id AND
 * its token, so `sessions.record` can consume a prova real through the
 * study-mode door. Without this the SAME run produces two different session
 * rows depending on which path won the race (the client's `discipline` on one
 * side, "Prova Real" on the other) — against BR-05.5, which says a real run
 * always ends through the same processing. Refusing the claim instead was the
 * alternative and was rejected: RealExamSimulation submits the real exam
 * through `sessions.record` itself, so a refusal would break the exam's own
 * ending. Forcing the labels keeps ONE door and makes it impossible to mislabel
 * a run through it.
 *
 * `claimedMode` is `string | null` on purpose — it comes from
 * `exam_drafts.mode` (a text column), not from a trusted union, and `null`
 * means "no draft was claimed" (a run that was never persisted).
 */
export function filingForClaimedMode(
  claimedMode: string | null,
  requested: SessionFiling,
): SessionFiling {
  if (claimedMode !== "real") return requested;
  return { discipline: REAL_EXAM_DISCIPLINE, difficulty: REAL_EXAM_DIFFICULTY };
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
 *
 * `runNonce` is on EVERY member and is not per-mode progress at all: it is the
 * per-run identity a tab mints once and stamps into every save
 * (`run-claimless.ts`), so a row this tab wrote is recognisable as ours even
 * when its response was lost and the payload has since moved on. It rides in
 * this jsonb precisely so it needs no column and no migration.
 *
 * Optional because a row written before this existed simply has none, and
 * "absent" must read as "not ours" (fail-closed), never as a match. Written
 * `?: string | undefined`, not `?: string`, because the API program runs with
 * `exactOptionalPropertyTypes` and the router's zod `.optional()` hands the
 * insert exactly a `string | undefined` — the narrower form makes the write of
 * a nonce-less payload a type error.
 */
export type ExamDraftModeState =
  | { mode: "standard"; carriedTime: Record<string, number>; runNonce?: string | undefined }
  | { mode: "spaced"; runNonce?: string | undefined }
  | {
      mode: "adaptive";
      adaptive: AdaptiveState;
      totalQuestions: number;
      deferredIds: string[];
      runNonce?: string | undefined;
    }
  | { mode: "real"; runNonce?: string | undefined };

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

/** The prova real lasts 5 h — the window `deadline_at` is minted from (D8). */
export const REAL_EXAM_DURATION_SECONDS = 5 * 60 * 60;

/**
 * A blank answer is never recorded (BR-05.6, consistent with BR-03): an
 * unanswered question is not an error, never reaches `user_answers` and never
 * touches the SM-2 schedule.
 *
 * Generic over the answer type (#86 M2b) so a caller that keeps MORE than the
 * draft on each entry keeps it through the filter — the mobile runner tracks the
 * question text and options alongside each answer for its result recap, and a
 * signature fixed to `AnswerDraft` would hand those back stripped. The rule is
 * unchanged: a blank `userAnswer` never survives.
 */
export function processableAnswers<A extends AnswerDraft>(drafts: readonly A[]): A[] {
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
 * The re-anchoring is POSITIONAL — how many survivors sit BEFORE the cursor —
 * never `indexOf(anchorId)`. The adaptive mode serves the same question twice
 * on purpose (`park` leaves it in the served list and `serveDeferred`
 * re-appends it), so `questionIds` legitimately holds duplicates, and `indexOf`
 * answers with the FIRST occurrence: resuming a run parked on the second copy
 * would throw the cursor backwards onto a question already answered. Counting
 * survivors is identical to `indexOf` on a duplicate-free queue and correct on
 * one with duplicates.
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

  const cursor = Number.isFinite(run.cursor) ? Math.max(0, Math.trunc(run.cursor)) : 0;
  const anchored = run.questionIds.slice(0, cursor).filter((id) => catalog.has(id)).length;

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
 * The "N" of the "Continuar (n/N)" card — how many questions the run is FOR.
 *
 * For the standard and spaced modes the queue is materialized up front, so its
 * length IS the target. The adaptive mode has no queue: `questionIds` holds the
 * questions SERVED so far (with a duplicate whenever a postponed one came
 * back), which grows one per answer — reading it as the total would offer
 * "Continuar (3/4)" for a simulado of 10. Its target is the number the student
 * picked in the setup, carried in `modeState.totalQuestions`.
 */
export function draftTotalOf(draft: {
  questionIds: readonly string[];
  modeState: ExamDraftModeState;
}): number {
  if (draft.modeState.mode === "adaptive") return draft.modeState.totalQuestions;
  return draft.questionIds.length;
}

/**
 * The two shapes a timestamp column legitimately arrives in, and NOTHING else:
 * the ISO string the browser mints (`2026-08-21T14:30:04.210Z`) and the raw PG
 * text drizzle hands back for `mode: "string"` (`2026-08-21 14:30:04.210932+00`).
 *
 * Stricter than `Date.parse` ON PURPOSE, and this is the parser EVERY read-path
 * decision below uses — `Date.parse` reached for directly is a bug here.
 * `Date.parse` is generous exactly where a clock must not be: `"2026"` answers
 * 1 Jan 2026 (a whole year read as an instant) and a JS `Date.toString()`
 * answers a locale-shaped guess. Those are the very values Postgres itself
 * refuses (22007 / 22023) and the reason `examDrafts.save` normalises the field
 * with a `.transform` — but that guards the WRITE path only. A row written
 * before it existed, or by anything other than that mutation, still reaches
 * these functions, and reading a guess out of one is how a student's exam gets
 * force-submitted on a value nobody measured.
 */
const TIMESTAMP_TEXT = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?(\d{2})?)?$/;

/**
 * Milliseconds of a timestamp in one of the two accepted shapes, or null.
 *
 * Exported because the WRITE path needs the SAME parser, not a second one:
 * `examDrafts.save` validates `deadlineAt` with this predicate, so a value the
 * reads below would refuse never gets stored in the first place. Two parsers
 * for one column is how "accepted on write, unreadable on read" happens.
 */
export function timestampMs(value: string): number | null {
  if (!TIMESTAMP_TEXT.test(value)) return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : ms;
}

/**
 * Whether a prova real must be settled server-side. There is no scheduler in
 * this project (Lambda behind API Gateway, no EventBridge), so an abrupt exit
 * is detected lazily on the student's next authenticated contact: the clock ran
 * out, or the 60 s heartbeat has been silent for `staleSeconds`.
 *
 * A fresh heartbeat before the deadline is NOT abandonment — that is the case
 * that keeps a student who merely opened another tab from being auto-submitted.
 *
 * FAILS CLOSED, per field, through `timestampMs`: a value that cannot be read
 * STRICTLY disables the half of the judgement that needed it, and never stands
 * in for it. Settling force-submits an exam and DELETEs its draft — it is
 * irreversible and it is the student's grade, so the two errors are not
 * symmetric. The cost of failing closed is bounded: an unreadable `deadline_at`
 * leaves only the heartbeat judging (a quiet one still settles), and a row that
 * no half can judge is cleared by the `force` of the next `startReal`
 * (BR-05.5), so nothing is stranded forever. The cost of failing open is a
 * student mid-exam losing it to a value `Date.parse` invented.
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
  const nowMs = timestampMs(now);
  if (nowMs === null) return false;

  if (deadlineAt !== null) {
    const deadlineMs = timestampMs(deadlineAt);
    if (deadlineMs !== null && deadlineMs <= nowMs) return true;
  }

  const lastSavedMs = timestampMs(lastSavedAt);
  if (lastSavedMs === null) return false;
  return lastSavedMs < nowMs - staleSeconds * 1000;
}

/**
 * Seconds left of a prova real, derived from the ABSOLUTE `deadline_at` and
 * never from a local counter (D8): reloading the tab must not hand back time,
 * and the clock does not pause the way the study modes' `elapsed_seconds` does.
 *
 * Floors at 0 — a deadline in the past means "no time left", never a negative
 * countdown — and answers `null` when there is no usable deadline at all, which
 * the caller must treat as "do not decide", not as "0 seconds left". "Usable"
 * is `timestampMs`, the same strict read `isRealRunAbandoned` makes: a countdown
 * painted from a guess is a number nobody measured.
 */
export function realSecondsLeft({
  deadlineAt,
  now,
}: {
  deadlineAt: string | null;
  now: string;
}): number | null {
  if (deadlineAt === null) return null;
  const deadlineMs = timestampMs(deadlineAt);
  if (deadlineMs === null) return null;
  const nowMs = timestampMs(now);
  if (nowMs === null) return null;
  return Math.max(0, Math.floor((deadlineMs - nowMs) / 1000));
}

/**
 * What the prova real screen does on mount — the whole of BR-05.5 as one pure
 * decision, so "does the student get their exam back?" is provable without a
 * browser:
 *
 * - `start` — no row at all, or a row whose deadline cannot be read. A prova
 *   real is NEVER offered back to continue, so "no row" is simply the setup
 *   screen; an unreadable deadline is settled by the `startReal` of the next
 *   start (`force`), never auto-submitted here on a guess. "Cannot be read" is
 *   `timestampMs`, not `Date.parse`: `null` and `"2026"` carry the same amount
 *   of information about when this exam ends, so they get the same verdict.
 * - `resume` — the row is alive: not abandoned AND with time left. This is the
 *   tab that OWNS the exam coming back from a reload, and it is the branch that
 *   keeps a student who merely opened a second tab from being auto-submitted.
 * - `settle` — the deadline passed or the heartbeat went quiet: the exam ended
 *   while nobody was watching and its answers still owe a session.
 *
 * Reuses `isRealRunAbandoned` and `realSecondsLeft` rather than re-deriving
 * either: the server judges abandonment with the first of those, and a second
 * copy of the rule here is how the two sides start disagreeing about whose
 * exam is still running.
 */
export type RealMountDecision = "start" | "resume" | "settle";

export function realMountDecision({
  draft,
  now,
  staleSeconds = REAL_RUN_STALE_SECONDS,
}: {
  draft: { deadlineAt: string | null; lastSavedAt: string } | null;
  now: string;
  staleSeconds?: number;
}): RealMountDecision {
  if (draft === null) return "start";
  if (isRealRunAbandoned({ ...draft, now, staleSeconds })) return "settle";
  const left = realSecondsLeft({ deadlineAt: draft.deadlineAt, now });
  // No usable deadline: the row is not judged abandoned (the heartbeat is
  // fresh) but there is no clock to run it against either. Back to setup.
  if (left === null) return "start";
  return left > 0 ? "resume" : "settle";
}
