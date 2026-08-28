// apps/mobile/src/components/use-run-exit.ts
//
// The BR-05 wiring of the mobile runner (#86 M2b): the autosave, the exit
// dialog's two doors and the flush-before-record contract. Extracted from
// `QuestionRunner.tsx` so the component stays a component — the rules it obeys
// live in `@shared/run/*` and the plumbing that calls them lives here.
//
// It DECIDES nothing. `mobileDraftPayload` builds the save, `shouldPromptOnExit`
// says whether leaving must ask, `useRunPersistence` owns the cadence and the
// exit listeners (`wireExitFlush(scheduler, { window, document })` — on iOS the
// real exit is `visibilitychange: hidden`, and that is the hook's first door).
//
// The order is the contract, and it is the desktop's: FLUSH first, and record
// only when the flush answered `ok`. A CONFLICT records NOTHING — whoever
// continued this run continued it from this state, and a session recorded
// without its claim would leave the draft alive on top of the result.

import { useRef, useState, type MutableRefObject } from "react";
import { useRunPersistence, type RunPersistence } from "@shared/react/use-run-persistence";
import { processableAnswers, shouldPromptOnExit } from "@shared/run/exit-rules";
import { appendAnswer, dedupeAnswers, type DraftClaim } from "@shared/run/run-persistence";
import { mobileDraftPayload, mobileRunMode, type MobileSurface } from "@shared/run/mobile-run";
import type { CarriedTime } from "@shared/domain/exam-queue";
import { runPersistenceIO } from "../lib/trpc";
import type { AnswerRecap } from "../state/practice-context";

/**
 * One answer as the mobile runner holds it: the draft `sessions.record` takes,
 * plus the question text/options the Result screen shows in its recap.
 */
export type TrackedAnswer = AnswerRecap & { timeSpent: number };

/** The saved row a resumed run already owns. */
export interface AdoptedDraft {
  id: string;
  token: string;
}

/** What the runner lends this hook to read its live state and act on it. */
export interface RunExitIO {
  surface: MobileSurface;
  /** The session's discipline label — what the standard `setup` stores. */
  discipline: string;
  /**
   * The run's OWN queue ids, read at SEND time: "responder depois" reorders the
   * queue, and that reordering IS progress (BR-03). Reading the `questions`
   * prop instead would resurrect the postponed question in front of the student.
   */
  queueIds: () => string[];
  answers: MutableRefObject<TrackedAnswer[]>;
  carried: MutableRefObject<CarriedTime>;
  /** The answer revealed but not yet confirmed with "Próxima", or null. */
  pending: () => TrackedAnswer | null;
  /** `sessions.record` + the Result screen. Rejects when the recording failed. */
  record: (answers: TrackedAnswer[], claim: DraftClaim | undefined) => Promise<void>;
  /** The row this run rehydrated from, or null for a fresh run. */
  adopted: AdoptedDraft | null;
  /** Leave the immersive run: refresh the saved-run cards and go Home. */
  exit: () => void;
}

/** Everything `QuestionRunner` needs from the persistence side. */
export interface RunExit {
  persistence: RunPersistence;
  /** A save or a recording is in flight — no second entry into either. */
  busy: boolean;
  /** The run ended: nothing more is persisted (the snapshot answers null). */
  finished: boolean;
  exitOpen: boolean;
  /** The ArrowLeft: ask first, or leave silently when nothing was answered. */
  requestExit: (answeredCount: number) => void;
  /** "Continuar" — the dialog closes and the run goes on. */
  dismissExit: () => void;
  /** The last question was answered: flush, then record. */
  finishRun: (all: readonly TrackedAnswer[]) => Promise<void>;
  /** "Sair e processar respostas" (BR-05.4). */
  quitAndProcess: () => Promise<void>;
  /** "Salvar e sair" (BR-05.3). */
  saveAndExit: () => Promise<void>;
}

interface ExitCtx {
  io: RunExitIO;
  persistence: RunPersistence;
  busy: boolean;
  setBusy: (value: boolean) => void;
  setFinished: (value: boolean) => void;
  setExitOpen: (value: boolean) => void;
}

/**
 * Records the run, or puts it back on screen WITH the reason.
 *
 * `dedupeAnswers` because a retry after a failed recording re-enters here with
 * the same question already in the list: two `user_answers` rows would count 11
 * of 10 and step the SM-2 schedule twice. Silence is the other half of that bug
 * — a student who clicks into nothing clicks again.
 */
async function recordVia(
  ctx: ExitCtx,
  answers: readonly TrackedAnswer[],
  claim: DraftClaim | undefined,
): Promise<void> {
  try {
    await ctx.io.record(dedupeAnswers(answers), claim);
    ctx.persistence.close();
  } catch (error: unknown) {
    ctx.persistence.reportError(error);
    ctx.setFinished(false);
  }
}

/** The last question was answered: land the draft, then record with its claim. */
function finishRunWith(ctx: ExitCtx): (all: readonly TrackedAnswer[]) => Promise<void> {
  return async (all) => {
    if (ctx.busy) {
      ctx.persistence.reportBusy();
      return;
    }
    ctx.setBusy(true);
    ctx.setFinished(true);
    const flushed = await ctx.persistence.flush();
    ctx.setBusy(false);
    if (!flushed.ok) {
      ctx.setFinished(false);
      return;
    }
    await recordVia(ctx, all, flushed.claim);
  };
}

/**
 * "Sair e processar respostas": record what was answered through the normal
 * path. The revealed-but-unconfirmed question joins the payload exactly as
 * "Próxima" would have recorded it; blanks never do (BR-05.6 / BR-03).
 */
function quitAndProcessWith(ctx: ExitCtx): () => Promise<void> {
  return async () => {
    if (ctx.busy) {
      ctx.persistence.reportBusy();
      return;
    }
    const pending = ctx.io.pending();
    const held = ctx.io.answers.current;
    const finalAnswers = processableAnswers(pending === null ? held : appendAnswer(held, pending));
    if (finalAnswers.length === 0) {
      ctx.setExitOpen(false);
      ctx.io.exit();
      return;
    }
    ctx.setBusy(true);
    const flushed = await ctx.persistence.flush();
    ctx.setBusy(false);
    ctx.setExitOpen(false);
    if (!flushed.ok) return;
    ctx.io.answers.current = finalAnswers;
    ctx.setFinished(true);
    await recordVia(ctx, finalAnswers, flushed.claim);
  };
}

/**
 * "Salvar e sair" (BR-05.3): the run stays on the server, intact, and can be
 * continued from any device (BR-05.2). `scheduleSave` first marks it dirty, so
 * a student who saves between two debounce windows still finds it waiting.
 */
function saveAndExitWith(ctx: ExitCtx): () => Promise<void> {
  return async () => {
    if (ctx.busy) {
      ctx.persistence.reportBusy();
      return;
    }
    ctx.setBusy(true);
    ctx.persistence.scheduleSave();
    const flushed = await ctx.persistence.flush();
    ctx.setBusy(false);
    ctx.setExitOpen(false);
    if (!flushed.ok) return;
    ctx.persistence.close();
    ctx.io.exit();
  };
}

export function useRunExit(io: RunExitIO): RunExit {
  const [busy, setBusy] = useState(false);
  const [finished, setFinished] = useState(false);
  const [exitOpen, setExitOpen] = useState(false);

  const persistence = useRunPersistence(
    mobileRunMode(io.surface),
    (token) =>
      finished
        ? null
        : mobileDraftPayload(
            {
              surface: io.surface,
              discipline: io.discipline,
              questionIds: io.queueIds(),
              answers: io.answers.current,
              carriedTime: io.carried.current,
            },
            token,
          ),
    runPersistenceIO,
  );

  // A resumed run already owns its row. Adopting during render (a ref write,
  // nothing painted) keeps the token out of an effect, where a re-run would
  // overwrite a fresher token with the one this mount started from.
  const adoptedRef = useRef(false);
  if (!adoptedRef.current) {
    adoptedRef.current = true;
    if (io.adopted !== null) persistence.adopt(io.adopted.id, io.adopted.token);
  }

  const ctx: ExitCtx = { io, persistence, busy, setBusy, setFinished, setExitOpen };

  return {
    persistence,
    busy,
    finished,
    exitOpen,
    requestExit: (answeredCount: number): void => {
      // Nothing answered ⇒ nothing to process and nothing to lose, so the run
      // is left silently (`sessions.record` refuses an empty payload anyway).
      if (!shouldPromptOnExit(answeredCount)) {
        io.exit();
        return;
      }
      setExitOpen(true);
    },
    dismissExit: (): void => {
      setExitOpen(false);
    },
    finishRun: finishRunWith(ctx),
    quitAndProcess: quitAndProcessWith(ctx),
    saveAndExit: saveAndExitWith(ctx),
  };
}
