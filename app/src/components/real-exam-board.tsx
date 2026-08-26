// The Simulado Real while it is being taken (BR-05.5, epic #67 slice S2d).
//
// What makes this board different from the three study boards: the prova real
// persists to be AUTO-SUBMITTED, never to be picked back up. So there is no
// "Salvar e sair" here — no `onSave` on the dialog, no `save` handler in
// `useRegisterRun` — and the run ends the same way whichever door it leaves by:
//
//   timer hits 0, tab open   → flush → `examDrafts.processReal` (= settlement)
//   tab closed / crashed     → nothing now; the server settles it lazily on the
//                              student's next authenticated contact
//   "Encerrar" / "Sair"      → flush → `sessions.record` WITH the draft claim
//
// Both auto-submit doors can fire for one run. They cannot double-record: the
// draft DELETE is the first statement of the recording transaction and acts as
// the mutex — the loser deletes 0 rows and writes nothing. That guarantee is
// why no path here may record WITHOUT a `draftId`: a claimless recording writes
// the session and leaves the draft alive on top of it, and the next settlement
// records a SECOND one.
//
// A missing token is NOT proof that there is nothing to claim (the save can
// commit and lose its response), so in this mode `flush()` probes the server
// before it ever answers "record with no claim" — `needsClaimlessProbe` /
// `claimlessVerdictFor` in `shared/lib/run-persistence.ts`. A row that comes
// back is terminal here, like any other CONFLICT.
//
// The clock is derived from the ABSOLUTE `deadlineAt`, never counted locally:
// reloading the tab cannot hand back time and the exam does not pause (D8).
// The 60 s heartbeat is what tells the server this tab is alive — without it a
// student who leaves the exam open in a background tab is judged abandoned
// after 3 missed beats and auto-submitted mid-exam.
//
// The deadline door may only SETTLE once its flush landed (`deadlineSettlementFor`).
// It is the one exit with no manual retry behind it — the clock is at 0, so the
// student cannot press "Encerrar" again — which is exactly why a failed flush
// here may not close the run and show the review screen: that discards every
// answer that never reached the server and announces a result that does not
// exist. A failed flush HOLDS instead: `submit-failed`, whose button re-runs the
// submission (`realBoardScreen`).
//
// A CONFLICT NEVER opens the conflict dialog here. "Recarregar do servidor" and
// "Descartar esta cópia" are choices about a run that can be continued; this one
// cannot, and "discard" is precisely what BR-05.5 forbids. A CONFLICT — from the
// save, the heartbeat or the recording — means the exam already ended somewhere
// else, so it is terminal: back to the setup card with a line saying so.

import { useEffect, useMemo, useState, type ReactElement } from 'react';
import { useLov } from '../shared/hooks/use-lov';
import { trpc } from '../shared/lib/trpc';
import { findNextUnanswered } from '../shared/lib/exam-queue';
import { useNotesAndBookmarks } from '../shared/hooks/use-notes-bookmarks';
import { useLeaveWarning } from '../shared/hooks/use-leave-warning';
import { useRegisterRun } from '../shared/run-guard-context';
import { useRunPersistence } from '../shared/hooks/use-run-persistence';
import ExamPlaying from './real-exam-playing';
import ExamReview from './real-exam-review';
import QuitTestDialog from './QuitTestDialog';
import RealExamFailureCard from './real-exam-failure-card';
import RunFailureDialog from '../pages/testing-run-failure';
import {
  deadlineSettlementFor,
  deadlineSubmitFailure,
  realBoardScreen,
} from './real-exam-failures';
import {
  exitPrompt,
  processableAnswers,
  shouldPromptOnExit,
  type AnswerDraft,
} from '../shared/lib/exit-rules';
import {
  appendAnswer,
  dedupeAnswers,
  realDraftPayload,
  type DraftClaim,
  type RunConflictKind,
} from '../shared/lib/run-persistence';
import {
  REAL_EXAM_DIFFICULTY,
  REAL_EXAM_DISCIPLINE,
  REAL_EXAM_DURATION_SECONDS,
  realSecondsLeft,
} from '@shared/domain/exam-draft';
import {
  NO_ELIMINATIONS,
  eliminatedFor,
  eliminationDropsAnswer,
  toggleElimination,
  type EliminationState,
} from '../shared/lib/eliminations';
import { answeredIndexes, formatTime, type RealRunStart } from './real-exam-types';
import { useHeartbeat, useTickingNow } from '../shared/hooks/use-real-exam-clock';
import { useRealExamMarks } from '../shared/hooks/use-real-exam-marks';
import {
  useAdoptedDraft,
  useDeadlineAutoSubmit,
  useFirstSave,
} from '../shared/hooks/use-real-exam-lifecycle';

interface RealExamBoardProps {
  start: RealRunStart;
  /** Leave the mode entirely (nothing answered, or nothing left to do). */
  onExitToModes: () => void;
  /** "Fazer Outro Simulado Real" — back to the setup card. */
  onRestart: () => void;
  /**
   * A CONFLICT ended this tab's exam: terminal, with a pt-BR line picked from
   * the conflict's KIND — a `live` one means the prova real is still running
   * elsewhere, not that it was processed (`realConflictNotice`).
   */
  onSettledElsewhere: (kind: RunConflictKind) => void;
}

export default function RealExamBoard({
  start,
  onExitToModes,
  onRestart,
  onSettledElsewhere,
}: RealExamBoardProps): ReactElement {
  const disciplineLov = useLov('DISCIPLINE');
  const examBoardLov = useLov('EXAM_BOARD');
  const utils = trpc.useUtils();
  const notesAndBookmarks = useNotesAndBookmarks();

  const [questions] = useState(start.questions);
  const [currentIndex, setCurrentIndex] = useState(start.cursor);
  const [answers, setAnswers] = useState<AnswerDraft[]>(start.answers);
  const marks = useRealExamMarks();
  const [eliminations, setEliminations] = useState<EliminationState>(NO_ELIMINATIONS);
  const [reviewing, setReviewing] = useState(false);
  const [busy, setBusy] = useState(false);
  // The deadline fired and its flush did NOT land. Terminal for the exam (it
  // can never be answered again) but NOT for the answers: they are still here
  // and the screen this raises is how they get sent.
  const [submitFailed, setSubmitFailed] = useState(false);
  const [exitOpen, setExitOpen] = useState(false);
  const [showConfirmSubmit, setShowConfirmSubmit] = useState(false);
  const now = useTickingNow(!reviewing);

  const recordMutation = trpc.sessions.record.useMutation({
    onSuccess: () => {
      void utils.stats.invalidate();
      void utils.sessions.invalidate();
      void utils.examDrafts.invalidate();
    },
  });
  const processRealMutation = trpc.examDrafts.processReal.useMutation();

  const persistence = useRunPersistence('real', (token) =>
    reviewing
      ? null
      : realDraftPayload({
          questionIds: questions.map((q) => q.id),
          cursor: currentIndex,
          answers,
          deadlineAt: start.deadlineAt,
          token,
        }),
  );
  const { conflict, failure } = persistence;

  // A rehydrated run already owns its row (`useAdoptedDraft` explains why it is
  // a render-time ref write and not an effect).
  useAdoptedDraft(start.draft, persistence.adopt);

  // The answers, in the two shapes the screens need. Keyed by QUESTION ID
  // because that is how they are persisted (D8); the index set is derived from
  // it for the nav and for `findNextUnanswered`, never stored.
  const answersByQuestionId = useMemo(() => {
    const map = new Map<string, string>();
    for (const answer of processableAnswers(answers)) map.set(answer.questionId, answer.userAnswer);
    return map;
  }, [answers]);
  const answered = useMemo(
    () => answeredIndexes(questions, answersByQuestionId),
    [questions, answersByQuestionId],
  );
  const answeredCount = answered.size;

  // DERIVED, never counted down locally — that is the whole of criterion 5.
  // A row whose deadline cannot be read never reaches this board (the container
  // sends it to the setup card), so 0 here really means "time is up".
  const secondsLeft = realSecondsLeft({ deadlineAt: start.deadlineAt, now }) ?? 0;

  useHeartbeat(!reviewing, persistence.beat);

  // The exam already ended elsewhere (another tab's submit, or a lazy
  // settlement that won the race). Terminal — never the conflict dialog.
  useEffect(() => {
    if (conflict !== null) onSettledElsewhere(conflict.kind);
  }, [conflict, onSettledElsewhere]);

  // The FIRST save of a fresh run — what writes `deadline_at` (`useFirstSave`).
  useFirstSave(start.draft === null, persistence.scheduleSave);

  useLeaveWarning(!reviewing && shouldPromptOnExit(answeredCount));

  const recordRun = async (
    finalAnswers: AnswerDraft[],
    claim: DraftClaim | undefined,
  ): Promise<void> => {
    try {
      await recordMutation.mutateAsync({
        // BR-05.5: filed as "Prova Real"/hard whichever door it left by. The
        // server forces the same pair off the CLAIMED row, so the two settlement
        // paths can never disagree about how one run was filed.
        discipline: REAL_EXAM_DISCIPLINE,
        difficulty: REAL_EXAM_DIFFICULTY,
        answers: dedupeAnswers(finalAnswers),
        ...(claim !== undefined ? { draft: claim } : {}),
      });
      persistence.close();
    } catch (error: unknown) {
      // A CONFLICT is the exam having ended elsewhere — the effect above turns
      // it terminal. Anything else leaves the run on screen for a retry, which
      // is safe by construction: `dedupeAnswers` keeps one entry per question.
      persistence.reportError(error);
      setReviewing(false);
    }
  };

  // The 5 h ran out with the tab open. Same settlement the server would have
  // done, asked for by the client so the student sees their result now.
  //
  // The flush is a GATE, not a formality (audit of #79): it is what puts the
  // answers on the server, and `processReal` settles the SERVER's row — so a
  // failed flush means settling would file an exam missing everything typed
  // since the last save, or (for a run whose first save never landed) an exam
  // that does not exist at all. There is no manual retry behind this door, so
  // it holds the run in `submit-failed` instead of discarding it: nothing is
  // closed, `reviewing` is never set, and the card's button lands right back
  // here. A CONFLICT also arrives as `ok: false`, and the effect above turns
  // that one terminal before this screen can be seen.
  const finishByDeadline = async (): Promise<void> => {
    setBusy(true);
    setSubmitFailed(false);
    const flushed = await persistence.flush();
    if (deadlineSettlementFor(flushed) === 'hold') {
      setSubmitFailed(true);
      setBusy(false);
      return;
    }
    try {
      await processRealMutation.mutateAsync();
      void utils.stats.invalidate();
      void utils.sessions.invalidate();
      void utils.examDrafts.invalidate();
    } catch {
      // Deliberately not surfaced. `processReal` is an ACCELERATOR, not the
      // guarantee: the row is on the server with its deadline in the past, so
      // the next authenticated contact settles it (`users.me` / `list` /
      // `startReal`). A "tente de novo" dialog over the result screen would
      // offer a retry that changes nothing. `settled: false` is not an error
      // either — it means someone else got there first.
    }
    persistence.close();
    setBusy(false);
    setReviewing(true);
  };

  // Fires exactly once (`useDeadlineAutoSubmit` owns the ref guard and the race
  // `blocked` is there for). The RETRY on a held submission is not this effect —
  // it is the card's button calling `finishByDeadline` again.
  useDeadlineAutoSubmit({ blocked: reviewing || busy, secondsLeft, submit: finishByDeadline });

  // "Encerrar" / "Sair da prova" / the sidebar guard: process what was
  // answered through the normal recording path, WITH the claim.
  const handleQuitAndProcess = async (): Promise<void> => {
    if (busy) {
      persistence.reportBusy();
      return;
    }
    const finalAnswers = processableAnswers(answers);
    if (finalAnswers.length === 0) {
      // Nothing to record. The row (if any) is left for the settlement to
      // delete — `sessions.record` refuses an empty payload, and an untouched
      // exam is not a result (criterion 2).
      setExitOpen(false);
      persistence.close();
      onExitToModes();
      return;
    }
    setBusy(true);
    const flushed = await persistence.flush();
    setBusy(false);
    setExitOpen(false);
    // A failed flush records NOTHING: without a landed token the claim is
    // unknown, and a claimless recording leaves the draft alive on top of the
    // session — the second settlement would then write a twin.
    if (!flushed.ok) return;
    setReviewing(true);
    await recordRun(finalAnswers, flushed.claim);
  };

  // Leaving asks first and warns the exam cannot be saved (BR-05.5); with
  // nothing answered there is nothing to process, so it exits silently.
  const requestExit = (): void => {
    if (!shouldPromptOnExit(answeredCount)) {
      persistence.close();
      onExitToModes();
      return;
    }
    setExitOpen(true);
  };

  // NO `save` handler — that absence IS the rule (BR-05.5): `RunGuardProvider`
  // derives the third button from it, and `exitPrompt('real')` refuses the
  // label anyway. Both locks, deliberately.
  useRegisterRun(
    { mode: 'real', running: !reviewing, answeredCount, totalQuestions: questions.length },
    () => {
      void handleQuitAndProcess();
    },
  );

  const selectAnswer = (option: string): void => {
    const question = questions[currentIndex];
    // `appendAnswer`, never a spread: the real exam lets the student change an
    // answer for 5 h, so the same question is answered many times over.
    setAnswers((prev) =>
      appendAnswer(prev, {
        questionId: question.id,
        userAnswer: option,
        correct: option === question.correctAnswer,
        // The prova real has no per-question timer — only the 5 h deadline.
        timeSpent: 0,
      }),
    );
    marks.unpostpone(currentIndex);
    persistence.scheduleSave();
  };

  // Cross out / restore an alternative (BR-02). Crossing out the chosen one
  // drops that answer (BR-02.2) — and here the drop must be PERSISTED too:
  // unlike the Padrão, this exam writes an answer the moment it is picked, so
  // taking it away has to reach the server or the run would be settled with an
  // answer the student removed.
  const handleToggleEliminate = (option: string): void => {
    const question = questions[currentIndex];
    setEliminations((prev) => toggleElimination(prev, question.id, option));
    if (eliminationDropsAnswer(answersByQuestionId.get(question.id) ?? '', option)) {
      setAnswers((prev) => prev.filter((entry) => entry.questionId !== question.id));
      persistence.scheduleSave();
    }
  };

  const postponeCurrent = (): void => {
    const next = findNextUnanswered(questions.length, currentIndex, answered);
    if (next === null) return;
    marks.postpone(currentIndex);
    setCurrentIndex(next);
  };

  const screen = realBoardScreen({ reviewing, submitFailed });

  // The deadline passed with answers still in this tab. NOT `ExamPlaying` (the
  // exam is over) and NOT `ExamReview` (nothing was processed) — the card says
  // so and its button re-runs the submission. `failure` rides along so the
  // student is told WHY (offline / session expired / server), and the failure
  // DIALOG is skipped here: it would only repeat this card behind a backdrop
  // whose button dismisses instead of retrying.
  if (screen === 'submit-failed') {
    return (
      <RealExamFailureCard
        failure={deadlineSubmitFailure(failure?.body ?? null)}
        busy={busy}
        onRetry={() => {
          void finishByDeadline();
        }}
        onExit={onExitToModes}
      />
    );
  }

  if (screen === 'review') {
    return (
      <ExamReview
        questions={questions}
        answersByQuestionId={answersByQuestionId}
        drafts={answers}
        timeUsedLabel={formatTime(REAL_EXAM_DURATION_SECONDS - secondsLeft)}
        disciplineLov={disciplineLov}
        onReset={onRestart}
      />
    );
  }

  return (
    <>
      <ExamPlaying
        questions={questions}
        currentIndex={currentIndex}
        answersByQuestionId={answersByQuestionId}
        answeredIndexes={answered}
        flagged={marks.flagged}
        postponed={marks.postponed}
        timeLeft={secondsLeft}
        examDuration={REAL_EXAM_DURATION_SECONDS}
        showConfirmSubmit={showConfirmSubmit}
        notesAndBookmarks={notesAndBookmarks}
        disciplineLov={disciplineLov}
        examBoardLov={examBoardLov}
        canPostpone={
          !answered.has(currentIndex) &&
          findNextUnanswered(questions.length, currentIndex, answered) !== null
        }
        eliminatedOptions={eliminatedFor(eliminations, questions[currentIndex].id)}
        formatTime={formatTime}
        onSelectAnswer={selectAnswer}
        onToggleEliminate={handleToggleEliminate}
        onSetIndex={setCurrentIndex}
        onToggleFlag={() => {
          marks.toggleFlag(currentIndex);
        }}
        onPostpone={postponeCurrent}
        onGoToUnanswered={() => {
          setShowConfirmSubmit(false);
          const first = questions.findIndex((_, idx) => !answered.has(idx));
          if (first >= 0) setCurrentIndex(first);
        }}
        onShowConfirmSubmit={() => {
          setShowConfirmSubmit(true);
        }}
        onHideConfirmSubmit={() => {
          setShowConfirmSubmit(false);
        }}
        onSubmit={() => {
          void handleQuitAndProcess();
        }}
        onRequestExit={requestExit}
      />
      <QuitTestDialog
        open={exitOpen}
        prompt={exitPrompt('real', answeredCount, questions.length)}
        busy={busy}
        onContinue={() => {
          setExitOpen(false);
        }}
        onQuit={() => {
          void handleQuitAndProcess();
        }}
      />
      {/* Only the FAILURE half of `RunOverlays` (see the file header): the
          conflict half offers to reload or discard a run that never resumes. */}
      {failure !== null && (
        <RunFailureDialog failure={failure} busy={busy} onDismiss={persistence.dismissFailure} />
      )}
    </>
  );
}
