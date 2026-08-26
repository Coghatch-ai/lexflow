// api/trpc/routers/exam-drafts.router.ts
//
// Server-side persistence of an exam still IN PROGRESS — the student's
// unfinished attempt, kept as a DRAFT (BR-05, epic #67 S2). A draft becomes a
// `sessions` row once it is processed; until then it lives only here.
// Every procedure is protected and every statement is scoped through
// `ctx.db.conditions(examDrafts)` — `exam_drafts` is a per-user table and its
// TABLE_SCOPE entry (api/db/scope.ts) is what keeps one student's unfinished
// draft invisible to every other student.
//
// Concurrency: `last_saved_at` IS the token. A save carrying a stale token
// (another device continued the same run) updates 0 rows and raises CONFLICT
// instead of silently overwriting the other device's progress. There is no
// revision column and no status column: the row exists ⇔ the run is unfinished.

import { z } from "zod";
import { and, eq, inArray, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { db } from "../../db/client";
import { examDrafts } from "../../../drizzle/schema";
import { protectedProcedure, router } from "../procedures";
import { settleRealRun } from "../../lib/settle-real-run";
import {
  RESUMABLE_MODES,
  RUN_MODES,
  answeredOf,
  draftTotalOf,
  isResumableMode,
} from "../../../shared/domain/exam-draft";

// Built FROM the shared `RUN_MODES` tuple, not from a second hand-written list:
// a mode added to `RunMode` is accepted here with no edit, and one removed stops
// compiling instead of silently staying valid input.
const runMode = z.enum(RUN_MODES);
const difficulty = z.enum(["easy", "medium", "hard"]);

const answerDraft = z.object({
  questionId: z.string().min(1),
  userAnswer: z.string(),
  correct: z.boolean(),
  timeSpent: z.number().int().min(0),
});

const setup = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("standard"),
    discipline: z.string(),
    examBoard: z.string().nullable(),
    difficulty: z.string().nullable(),
  }),
  z.object({
    mode: z.literal("adaptive"),
    discipline: z.string(),
    totalQuestions: z.number().int().min(1),
  }),
  z.object({ mode: z.literal("spaced") }),
  z.object({ mode: z.literal("real") }),
]);

const adaptiveState = z.object({
  currentDifficulty: difficulty,
  consecutiveCorrect: z.number().int().min(0),
  consecutiveWrong: z.number().int().min(0),
  totalCorrect: z.number().int().min(0),
  totalAnswered: z.number().int().min(0),
  difficultyHistory: z.array(difficulty),
});

const modeState = z.discriminatedUnion("mode", [
  // carriedTime keeps the seconds already spent on a postponed question — drop
  // it and the resumed run silently forgets that time (BR-03 + BR-05.10).
  z.object({ mode: z.literal("standard"), carriedTime: z.record(z.string(), z.number()) }),
  z.object({ mode: z.literal("spaced") }),
  z.object({
    mode: z.literal("adaptive"),
    adaptive: adaptiveState,
    totalQuestions: z.number().int().min(1),
    // The FIFO of postponed questions IS progress (BR-03); the candidate pool
    // is not — it is re-drawn from the same filters on resume.
    deferredIds: z.array(z.string()),
  }),
  z.object({ mode: z.literal("real") }),
]);

const saveInput = z
  .object({
    mode: runMode,
    setup,
    /** Frozen queue order — resume replays THIS array, never a fresh query. */
    questionIds: z.array(z.string().min(1)),
    cursor: z.number().int().min(0),
    answers: z.array(answerDraft),
    modeState,
    elapsedSeconds: z.number().int().min(0),
    /**
     * Only the prova real has an absolute deadline; null on the study modes.
     *
     * It must accept BOTH shapes of the same instant, because both are legal
     * input: the ISO string the browser mints (`toISOString()`) AND the raw PG
     * text this very API hands back — drizzle overrides the TIMESTAMPTZ parser
     * to identity for `mode: "string"`, so `get` returns
     * `"2026-08-21 14:30:04.210932+00"` (µs, no `T`, no `Z`). A rehydrating
     * screen echoes back what it read, and `z.string().datetime({ offset: true })`
     * REFUSED exactly that value — BAD_REQUEST on the API's own output, or, for
     * a client that dropped the field to get past it, a silently erased deadline
     * (`:deadlineAt` below writes `?? null` on the UPDATE too), which kills the
     * D8 absolute deadline the auto-submit depends on.
     *
     * Parseability is the whole contract here: `deadline_at` is COMPARED
     * (`isRealRunAbandoned` reads it through the strict `timestampMs`, NOT
     * `Date.parse`), never echoed as a token, so normalising is harmless and
     * only the instant matters. That is the exact
     * opposite of `token`/`lastSavedAt` below, which must travel VERBATIM: it is
     * matched with `=` against the column, and normalising it through `Date`
     * drops the microseconds and breaks the optimistic guard for good. Two
     * string fields of the same row, opposite rules — hence the note.
     *
     * The `transform` is the second half, and it is what keeps a bad input a
     * BAD_REQUEST instead of a 500: `Date.parse` is far more generous than
     * Postgres, so the `refine` alone lets through values the driver then dies
     * on — `"2026"` (a whole YEAR, PG 22007) and a JS `Date.toString()`
     * (PG 22023). Normalising to ISO here is safe for exactly the reason above
     * (the column is compared, never echoed) and NEVER acceptable on `token`.
     * Known cost, accepted: it truncates µs to ms, which is nothing against a
     * 5 h exam but IS a contract change — the deadline stored is the instant
     * asked for, to the millisecond.
     */
    deadlineAt: z
      .string()
      .min(1)
      .refine((v) => Number.isFinite(Date.parse(v)), {
        message: "deadlineAt precisa ser uma data/hora reconhecível",
      })
      .transform((v) => new Date(v).toISOString())
      .nullable()
      .optional(),
    /** `last_saved_at` of the row this save is based on; null = first save. */
    token: z.string().nullable(),
  })
  // The three discriminators describe ONE run, so they must agree. A payload
  // like `{ mode: 'real', modeState: { mode: 'standard', … } }` type-checks
  // against each member on its own and would persist a draft the resume path
  // cannot rehydrate (it reads mode_state by `mode`). Rejected at the door.
  .refine((v) => v.mode === v.setup.mode && v.mode === v.modeState.mode, {
    message: "mode, setup.mode e modeState.mode precisam ser o mesmo modo",
    path: ["mode"],
  });

const conflict = (message = "Este teste foi continuado em outro aparelho."): never => {
  throw new TRPCError({ code: "CONFLICT", message });
};

/** BR-05.8: an unfinished run is never overwritten silently — the student is
 * asked to continue it or discard it. A `token: null` save is by definition a
 * FIRST save, so a row already sitting on `(user, mode)` means the caller is
 * about to bulldoze a live run (worse on `real`: those answers would vanish
 * without ever becoming a session, against BR-05.5). Replacing it is a
 * deliberate act with its own procedure — `discard` on the study modes,
 * `startReal` (which settles the old one) on the prova real. */
const OVERWRITE_CONFLICT = "Já existe um teste em andamento neste modo. Continue-o ou descarte-o.";

export const examDraftsRouter = router({
  // The mode-selection cards' "Continuar (n/N)". Settles an abandoned prova
  // real FIRST, so a dead real exam is processed instead of being listed.
  //
  // `real` is then excluded outright: BR-05.5 — a prova real is NEVER offered
  // back to continue, not even while it is still fresh (the tab that owns it
  // resumes from its own state, not from this list). The rule belongs here, on
  // the server, not in whichever screen happens to render the cards.
  list: protectedProcedure.query(async ({ ctx }) => {
    await settleRealRun(ctx.userId);
    const rows = await db
      .select()
      .from(examDrafts)
      .where(and(ctx.db.conditions(examDrafts), inArray(examDrafts.mode, [...RESUMABLE_MODES])));
    return rows.map((draft) => ({
      mode: draft.mode,
      answered: answeredOf(draft),
      // NOT `questionIds.length`: in the adaptive mode that array is the
      // questions SERVED so far (it grows one per answer, with a duplicate
      // whenever a postponed one comes back), so it would offer "Continuar
      // (3/4)" for a simulado of 10. `draftTotalOf` reads the target the
      // student picked; the other modes still count their frozen queue.
      total: draftTotalOf(draft),
      lastSavedAt: draft.lastSavedAt,
    }));
  }),

  // The raw row the screen rehydrates from (questions come from questions.byIds
  // and are re-ordered by `questionIds`, which the DB does not preserve).
  get: protectedProcedure.input(z.object({ mode: runMode })).query(async ({ ctx, input }) => {
    const [draft] = await db
      .select()
      .from(examDrafts)
      .where(and(ctx.db.conditions(examDrafts), eq(examDrafts.mode, input.mode)))
      .limit(1);
    return draft ?? null;
  }),

  save: protectedProcedure.input(saveInput).mutation(async ({ ctx, input }) => {
    const values = {
      mode: input.mode,
      setup: input.setup,
      questionIds: input.questionIds,
      cursor: input.cursor,
      answers: input.answers,
      modeState: input.modeState,
      elapsedSeconds: input.elapsedSeconds,
      deadlineAt: input.deadlineAt ?? null,
      lastSavedAt: sql`now()`,
      lastUpdBy: ctx.userId,
    };

    if (input.token === null) {
      // DoNothing, not DoUpdate: the existing row wins (BR-05.8 above).
      const [row] = await db
        .insert(examDrafts)
        .values({ ...values, userId: ctx.userId, createdBy: ctx.userId })
        .onConflictDoNothing({ target: [examDrafts.userId, examDrafts.mode] })
        .returning({ lastSavedAt: examDrafts.lastSavedAt });
      if (row === undefined) return conflict(OVERWRITE_CONFLICT);
      return { lastSavedAt: row.lastSavedAt };
    }

    const [row] = await db
      .update(examDrafts)
      .set(values)
      .where(
        and(
          ctx.db.conditions(examDrafts),
          eq(examDrafts.mode, input.mode),
          eq(examDrafts.lastSavedAt, input.token),
        ),
      )
      .returning({ lastSavedAt: examDrafts.lastSavedAt });
    if (row === undefined) return conflict();
    return { lastSavedAt: row.lastSavedAt };
  }),

  // The prova real's 60 s heartbeat: one column, no jsonb rewrite. It is what
  // tells the server the tab is still alive (3 missed beats = abandoned).
  touch: protectedProcedure
    .input(z.object({ mode: runMode, token: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const [row] = await db
        .update(examDrafts)
        .set({ lastSavedAt: sql`now()`, lastUpdBy: ctx.userId })
        .where(
          and(
            ctx.db.conditions(examDrafts),
            eq(examDrafts.mode, input.mode),
            eq(examDrafts.lastSavedAt, input.token),
          ),
        )
        .returning({ lastSavedAt: examDrafts.lastSavedAt });
      if (row === undefined) return conflict();
      return { lastSavedAt: row.lastSavedAt };
    }),

  // "Descartar" on the mode card: the draft is dropped, nothing is recorded.
  //
  // Study modes ONLY (BR-05.5). Throwing away a prova real would delete answers
  // that must still become a session — the real exam ends exclusively through
  // settlement (`startReal` / `processReal`), which is what the comment on
  // OVERWRITE_CONFLICT above declares. The narrowing lives here, on the server,
  // for the same reason `list` filters on RESUMABLE_MODES: "no screen calls it
  // with `real` today" is a property of today's UI, not a guarantee.
  discard: protectedProcedure
    .input(
      z.object({
        mode: runMode.refine(isResumableMode, {
          message: "A prova real não pode ser descartada — ela só termina por processamento.",
        }),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await db
        .delete(examDrafts)
        .where(and(ctx.db.conditions(examDrafts), eq(examDrafts.mode, input.mode)));
      return { discarded: true };
    }),

  // The client's own auto-submit when the 5 h timer reaches zero.
  processReal: protectedProcedure.mutation(async ({ ctx }) => settleRealRun(ctx.userId)),

  // Asking for a new prova real settles the pending one unconditionally: a real
  // exam is never offered back (BR-05.5).
  startReal: protectedProcedure.mutation(async ({ ctx }) =>
    settleRealRun(ctx.userId, { force: true }),
  ),
});
