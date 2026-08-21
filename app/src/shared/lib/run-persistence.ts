// app/src/shared/lib/run-persistence.ts
//
// Everything the persisted-run wiring DECIDES (BR-05, epic #67 slice S2b), as
// pure functions: the payload a save carries, what a resume rehydrates, the
// draft claim a recording carries, and the two pt-BR copies of a CONFLICT.
// No React, no tRPC — `use-run-persistence.ts` is only plumbing around this.
//
// THE TOKEN TRAVELS VERBATIM. `lastSavedAt` is the raw PG text of
// `exam_drafts.last_saved_at` (`"2026-08-21 14:30:04.210932+00"` — microseconds,
// no `T`, no `Z`: drizzle overrides the TIMESTAMPTZ parser to identity for
// `mode: "string"`), and BOTH the optimistic save (`eq(examDrafts.lastSavedAt,
// input.token)`) and the claiming DELETE in `api/lib/record-session.ts` match it
// with `=` in SQL. Passing it through `new Date(...)`, `toISOString()` or
// `Date.parse` eats the microseconds and the guard silently stops guarding.
// `deadlineAt` is the exact opposite — it is COMPARED, never echoed, so it is
// normalisable. Two string fields of the same row, opposite rules.

import {
  reconcileRun,
  type AnswerDraft,
  type ExamDraftModeState,
  type ExamDraftSetup,
  type RunMode,
} from "@shared/domain/exam-draft";

/** The Simulado Padrão filters, as the setup column stores them. */
export interface StandardSetup {
  discipline: string;
  examBoard: string | null;
  difficulty: string | null;
}

/** The live Simulado Padrão run, as the screen holds it. */
export interface StandardRunState {
  setup: StandardSetup;
  /** Frozen queue order — resume replays THIS, never a fresh questions.list. */
  questionIds: readonly string[];
  cursor: number;
  answers: readonly AnswerDraft[];
  /** Seconds already spent on postponed questions, by question id. */
  carriedTime: ReadonlyMap<string, number>;
  elapsedSeconds: number;
  /** `last_saved_at` observed for this draft; null before the first save. */
  token: string | null;
}

/** Exactly the input `examDrafts.save` takes for a standard run. */
export interface StandardDraftPayload {
  mode: "standard";
  setup: Extract<ExamDraftSetup, { mode: "standard" }>;
  questionIds: string[];
  cursor: number;
  answers: AnswerDraft[];
  modeState: Extract<ExamDraftModeState, { mode: "standard" }>;
  elapsedSeconds: number;
  token: string | null;
}

/**
 * The save payload. `deadlineAt` is ABSENT, not null: only the prova real has
 * an absolute deadline, and the study modes' clock is `elapsedSeconds`.
 *
 * The queue order is copied as-is — after a "Responder depois" it is no longer
 * the order the questions were drawn in, and that reordering IS progress
 * (BR-03): replaying anything else would resurrect a postponed question in
 * front of the student.
 */
export function standardDraftPayload(run: StandardRunState): StandardDraftPayload {
  return {
    mode: "standard",
    setup: { mode: "standard", ...run.setup },
    questionIds: [...run.questionIds],
    cursor: run.cursor,
    answers: [...run.answers],
    modeState: { mode: "standard", carriedTime: Object.fromEntries(run.carriedTime) },
    elapsedSeconds: run.elapsedSeconds,
    // Verbatim. See the file header: normalising this kills the guard.
    token: run.token,
  };
}

/** The columns of an `exam_drafts` row a resume reads (`examDrafts.get`). */
export interface PersistedDraft {
  id: string;
  mode: string;
  setup: ExamDraftSetup;
  questionIds: string[];
  cursor: number;
  answers: AnswerDraft[];
  modeState: ExamDraftModeState;
  elapsedSeconds: number;
  lastSavedAt: string;
}

/**
 * `examDrafts.get` answers `null` when the student has no run in that mode —
 * but the FRONTEND program cannot see that: it compiles the api/ graph without
 * `noUncheckedIndexedAccess` (only `tsconfig.api.json` enables it), so drizzle's
 * `const [row] = await db.select()` infers as non-optional there and the `| null`
 * is lost by the time the router's return type reaches this side.
 *
 * Passing the fetch through here restores the honest type, so the null check
 * that follows is a real check instead of dead code the linter removes.
 */
export function persistedDraftOf(row: PersistedDraft | null | undefined): PersistedDraft | null {
  return row ?? null;
}

/** What the screen must put back on the board to continue the run. */
export type ResumeState<Q> =
  | { discard: true; dropped: number }
  | {
      discard: false;
      questions: Q[];
      cursor: number;
      answers: AnswerDraft[];
      carriedTime: Map<string, number>;
      setup: StandardSetup;
      elapsedSeconds: number;
      /** The current question restarts from zero (D8). */
      timeSpent: 0;
      /** Never persisted: a resume lands on the START of the question (D8). */
      checked: false;
      /** Questions that left the catalog since the run was saved. */
      dropped: number;
    };

const EMPTY_SETUP: StandardSetup = { discipline: "", examBoard: null, difficulty: null };

function setupOf(draft: PersistedDraft): StandardSetup {
  if (draft.setup.mode !== "standard") return EMPTY_SETUP;
  const { discipline, examBoard, difficulty } = draft.setup;
  return { discipline, examBoard, difficulty };
}

function carriedTimeOf(
  state: ExamDraftModeState,
  survivors: ReadonlySet<string>,
): Map<string, number> {
  const carried = new Map<string, number>();
  if (state.mode !== "standard") return carried;
  for (const [id, seconds] of Object.entries(state.carriedTime)) {
    // A question that left the catalog takes its carried time with it —
    // otherwise the map grows a key no queue entry will ever consume.
    if (survivors.has(id)) carried.set(id, seconds);
  }
  return carried;
}

/**
 * Rebuilds the run from the saved row plus the questions fetched by
 * `questions.byIds`.
 *
 * `byIds` uses `inArray`, which returns rows in DATABASE order — the frozen
 * queue is re-imposed here. Re-querying `questions.list` instead is what must
 * never happen: it orders by `random()`, so it would swap the question set out
 * from under the cursor.
 */
export function resumeStateFrom<Q extends { id: string }>(
  draft: PersistedDraft,
  fetched: readonly Q[],
): ResumeState<Q> {
  const byId = new Map(fetched.map((q) => [q.id, q]));
  const reconciled = reconcileRun(
    { questionIds: draft.questionIds, cursor: draft.cursor, answers: draft.answers },
    byId.keys(),
  );

  if (reconciled.discard) return { discard: true, dropped: reconciled.dropped };

  const questions: Q[] = [];
  for (const id of reconciled.questionIds) {
    const question = byId.get(id);
    if (question !== undefined) questions.push(question);
  }

  return {
    discard: false,
    questions,
    cursor: reconciled.cursor,
    answers: reconciled.answers,
    carriedTime: carriedTimeOf(draft.modeState, new Set(reconciled.questionIds)),
    setup: setupOf(draft),
    elapsedSeconds: draft.elapsedSeconds,
    timeSpent: 0,
    checked: false,
    dropped: reconciled.dropped,
  };
}

/** The draft claim `sessions.record` consumes the run with. */
export interface DraftClaim {
  id: string;
  lastSavedAt: string;
}

/**
 * The claim, or nothing at all. The id NEVER travels alone: the pair is what
 * `recordInput.draft` takes, and an id-only claim would let a stale tab delete
 * the row a fresher one just wrote. `undefined` (never a half-built object) is
 * the honest answer for a run that was never persisted.
 */
export function claimFor(draftId: string | null, token: string | null): DraftClaim | undefined {
  if (draftId === null || draftId.length === 0) return undefined;
  if (token === null || token.length === 0) return undefined;
  return { id: draftId, lastSavedAt: token };
}

/** Which copy of a CONFLICT the student is looking at. */
export type RunConflictKind = "remote" | "live";

export interface RunConflict {
  kind: RunConflictKind;
  title: string;
  body: string;
  /** Both flavours reload the server's copy (`get` + rehydrate). */
  reloadLabel: string;
  discardLabel: string;
  /**
   * `local` throws away THIS tab's copy and leaves the server draft alive;
   * `server` calls `examDrafts.discard` and starts over.
   */
  discardTarget: "local" | "server";
}

/**
 * The two flavours of CONFLICT, told apart by whether this tab HAD a token.
 *
 * With a token, the save lost an optimistic race: the run was continued
 * somewhere else. Without one, the FIRST save hit a row that already exists
 * (`exam-drafts.router.ts` OVERWRITE_CONFLICT) — BR-05.8's safety net for a
 * draft born on another device between choosing the mode and answering.
 * Never a silent overwrite in either case.
 */
export function conflictFor(hadToken: boolean): RunConflict {
  if (hadToken) {
    return {
      kind: "remote",
      title: "Este teste foi continuado em outro aparelho.",
      body: "Para não sobrescrever o progresso mais recente, o salvamento automático desta aba foi interrompido.",
      reloadLabel: "Recarregar do servidor",
      discardLabel: "Descartar esta cópia",
      discardTarget: "local",
    };
  }
  return {
    kind: "live",
    title: "Já existe um teste em andamento neste modo.",
    body: "Continue o teste salvo ou descarte-o para começar um novo.",
    reloadLabel: "Continuar o salvo",
    discardLabel: "Descartar o salvo",
    discardTarget: "server",
  };
}

/**
 * Whether a failed call is the optimistic guard firing (tRPC `CONFLICT`) rather
 * than a network blip. Only a CONFLICT stops the autosave for good: a dropped
 * request must be retried by the next debounce, or one bad tunnel would end
 * the persistence of a run that is perfectly fine.
 *
 * Shape-checked instead of `instanceof TRPCClientError` on purpose — the error
 * crosses the tRPC client boundary and this module stays free of React/tRPC so
 * the rule is testable with plain vitest.
 */
export function isConflictError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const data: unknown = (error as { data?: unknown }).data;
  if (typeof data !== "object" || data === null) return false;
  return (data as { code?: unknown }).code === "CONFLICT";
}

/** One entry of `examDrafts.list` — the "Continuar (n/N)" of a mode card. */
export interface ResumableDraft {
  mode: string;
  answered: number;
  total: number;
  lastSavedAt: string;
}

/**
 * The saved run offered on a given mode's card, if any. `examDrafts.list`
 * already excludes the prova real server-side (BR-05.5); this only picks the
 * mode being rendered and never invents one.
 */
export function resumableFor(
  drafts: readonly ResumableDraft[] | undefined,
  mode: RunMode,
): ResumableDraft | null {
  if (drafts === undefined) return null;
  return drafts.find((draft) => draft.mode === mode) ?? null;
}
