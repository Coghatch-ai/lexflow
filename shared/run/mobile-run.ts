// shared/run/mobile-run.ts
//
// What the MOBILE runner persists and rehydrates (BR-05, epic #67 / #86 M2b).
// Pure: no React, no tRPC — `apps/mobile/src/components/QuestionRunner.tsx` is
// only plumbing around this, exactly as the desktop boards are around
// `run-persistence.ts`.
//
// It MAPS, it does not decide anything new. Every rule already exists:
// `standardDraftPayload` / `spacedDraftPayload` build the save, `resumeStateFrom`
// / `resumeSpacedFrom` rebuild the run, `dedupeAnswers` + `processableAnswers`
// clean the answers. Rewriting any of them here would be a second copy of a rule
// the desktop already answers — which is the drift this file exists to prevent.
//
// It lives under `shared/run/` and NOT in `apps/mobile/`, because
// `vitest.config.ts` does not include `apps/mobile/**`: a test written there
// never runs, so the logic worth testing cannot live there.

import { processableAnswers, type AnswerDraft, type RunMode } from "../domain/exam-draft";
import {
  dedupeAnswers,
  resumeSpacedFrom,
  resumeStateFrom,
  spacedDraftPayload,
  standardDraftPayload,
  type PersistedDraft,
  type SpacedDraftPayload,
  type StandardDraftPayload,
} from "./run-persistence";

/**
 * The three mobile screens a question is answered on: "Praticar"
 * (`PracticePage`), "Treino focado" (`DrillPage`) and "Revisão" (`ReviewPage`).
 *
 * A SURFACE, not a saved mode — the two are deliberately not the same thing
 * (see `mobileRunMode`).
 */
export type MobileSurface = "practice" | "drill" | "review";

/** The `exam_drafts.mode` values a mobile run can own. Never `adaptive`/`real`. */
export type MobileRunMode = Extract<RunMode, "standard" | "spaced">;

/**
 * Which `exam_drafts` row a mobile surface saves into.
 *
 * The product owner's rule, verbatim (#86 EMENDA): "mobile and desktop should
 * have the same rule, we are saving the same database." So the mapping is the
 * PRODUCT's, not the client's: Praticar AND Treino focado write the `standard`
 * row, Revisão writes `spaced`. There is no `mobile-*` mode — inventing one
 * would break BR-05.2 ("a test started on one device can be continued on
 * another"), which is the whole point of persisting server-side.
 *
 * A Drill run has exactly the shape of a standard one (a queue frozen in
 * `questionIds` plus `carriedTime`), so it needs no new mode, no widening of
 * `ExamDraftSetup`/`ExamDraftModeState` and no migration.
 *
 * Praticar and Drill therefore SHARE one slot (`UNIQUE(user_id, mode)`), and
 * that is the rule rather than a defect: starting one while the other is saved
 * lands in BR-05.8 — continue it or discard it, never a silent overwrite.
 */
export function mobileRunMode(surface: MobileSurface): MobileRunMode {
  return surface === "review" ? "spaced" : "standard";
}

/** The live mobile run, as `QuestionRunner` holds it. */
export interface MobileRunState {
  surface: MobileSurface;
  /** The session's discipline label — the standard `setup` stores it. */
  discipline: string;
  /**
   * The run's OWN queue order, i.e. `queue` after every "responder depois"
   * (BR-03), never the `questions` prop the screen was mounted with. Replaying
   * the original order would resurrect a postponed question in front of the
   * student and re-present one already answered.
   */
  questionIds: readonly string[];
  answers: readonly AnswerDraft[];
  /** Seconds banked by postponed questions, by question id (empty on `spaced`). */
  carriedTime: ReadonlyMap<string, number>;
}

/** Exactly what `examDrafts.save` takes for a mobile run. */
export type MobileDraftPayload = StandardDraftPayload | SpacedDraftPayload;

/** The answers a save carries: one per question, last word wins, no blanks. */
function payloadAnswers(answers: readonly AnswerDraft[]): AnswerDraft[] {
  return processableAnswers(dedupeAnswers(answers));
}

/**
 * Where a resume must put the cursor: the first queued question with no answer.
 *
 * Derived from the queue and the answers rather than copied from the screen's
 * index, because the mobile runner reveals the answer in place — the index sits
 * on a question that is already answered until "Próxima" is tapped, and
 * persisting THAT would hand the student back a question they just answered.
 *
 * Everything answered ⇒ the last index, which is where the run is about to end
 * anyway (an empty queue answers 0; `reconcileRun` discards that run).
 */
export function mobileCursor(
  questionIds: readonly string[],
  answers: readonly AnswerDraft[],
): number {
  const answered = new Set(payloadAnswers(answers).map((a) => a.questionId));
  const next = questionIds.findIndex((id) => !answered.has(id));
  if (next >= 0) return next;
  return Math.max(0, questionIds.length - 1);
}

/**
 * The run clock a mobile save persists: the seconds actually MEASURED on the
 * questions that were answered.
 *
 * The mobile runner has no run timer on screen (the desktop board's `timer` has
 * no counterpart here), and BR-05.10 asks for elapsed time that is not counted
 * while the run is saved. Summing the per-question `timeSpent` is the only
 * number this client measured; it is stable across a resume, because the
 * rehydrated answers carry their own `timeSpent` back. Reading a wall clock
 * instead would invent time the student spent elsewhere.
 */
export function mobileElapsedSeconds(answers: readonly AnswerDraft[]): number {
  return payloadAnswers(answers).reduce((total, a) => total + Math.max(0, a.timeSpent), 0);
}

/**
 * The save payload for a mobile run — `standard` or `spaced`, delegated whole.
 *
 * The token arrives as an ARGUMENT and travels VERBATIM: it is the raw PG text
 * of `exam_drafts.last_saved_at`, matched with `=` in SQL, so a token captured
 * in a closure (or normalised through `Date`) silently stops the optimistic
 * guard from guarding.
 */
export function mobileDraftPayload(run: MobileRunState, token: string | null): MobileDraftPayload {
  const questionIds = [...run.questionIds];
  const answers = payloadAnswers(run.answers);
  const cursor = mobileCursor(questionIds, answers);

  if (mobileRunMode(run.surface) === "spaced") {
    return spacedDraftPayload({ questionIds, cursor, answers, token });
  }

  return standardDraftPayload({
    setup: { discipline: run.discipline, examBoard: null, difficulty: null },
    questionIds,
    cursor,
    answers,
    carriedTime: run.carriedTime,
    elapsedSeconds: mobileElapsedSeconds(answers),
    token,
  });
}

/** What the mobile runner must put back on screen to continue a saved run. */
export type MobileResume<Q> =
  | { discard: true; dropped: number }
  | {
      discard: false;
      /** The frozen queue, in the PERSISTED order (never the fetch's order). */
      questions: Q[];
      cursor: number;
      answers: AnswerDraft[];
      /** Empty on `spaced`: that mode's `modeState` carries no `carriedTime`. */
      carriedTime: Map<string, number>;
      elapsedSeconds: number;
      /** The saved session discipline; null on `spaced` (it has no setup). */
      discipline: string | null;
      /** Questions that left the catalog since the run was saved. */
      dropped: number;
    };

/**
 * Rebuilds a mobile run from its saved row plus the questions `questions.byIds`
 * returned — by delegating to the same two resumes the desktop uses, so a run
 * saved on either client comes back identically on the other (BR-05.2).
 *
 * Keyed by the ROW's mode, not by the surface asking: a Drill and a Praticar
 * share the `standard` row, and whoever opens it resumes the same run.
 */
export function mobileResume<Q extends { id: string }>(
  draft: PersistedDraft,
  fetched: readonly Q[],
): MobileResume<Q> {
  if (draft.mode === "spaced") {
    const spaced = resumeSpacedFrom(draft, fetched);
    if (spaced.discard) return { discard: true, dropped: spaced.dropped };
    return {
      discard: false,
      questions: spaced.questions,
      cursor: spaced.cursor,
      answers: spaced.answers,
      carriedTime: new Map(),
      elapsedSeconds: 0,
      discipline: null,
      dropped: spaced.dropped,
    };
  }

  const standard = resumeStateFrom(draft, fetched);
  if (standard.discard) return { discard: true, dropped: standard.dropped };
  return {
    discard: false,
    questions: standard.questions,
    cursor: standard.cursor,
    answers: standard.answers,
    carriedTime: standard.carriedTime,
    elapsedSeconds: standard.elapsedSeconds,
    discipline: standard.setup.discipline,
    dropped: standard.dropped,
  };
}
