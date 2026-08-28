// The Simulado Padrão run itself (BR-05, epic #67 slice S2b): the queue, the
// clock, the answers — plus the server-side persistence wired onto them.
//
// Mounted with a `key` per run, so a fresh run gets a fresh scheduler and a
// fresh draft identity without any reset path to get wrong. Everything it
// DECIDES comes from pure modules (`shared/run/run-persistence`,
// `shared/run/exit-rules`, `shared/domain/exam-draft`); this file only wires.
//
// Where the flush lives is load-bearing: it is the FIRST awaited instruction of
// `handleSaveAndExit` / `handleQuitAndProcess`, never inside `QuitTestDialog`
// or `RunGuardProvider` (both are presentation and cannot wait on a promise).
// While one runs, `busy` disables every action so there is no second entry.
//
// A failed exit puts the run BACK on screen, so the student clicks again —
// that retry is safe by construction, not by a disabled button: answers are
// built with `appendAnswer` and recorded through `dedupeAnswers`, one entry per
// question, last word wins. Every failure is shown (`persistence.failure`);
// clicking into silence is what produced the double-count in the first place.

import { useEffect, useRef, useState, type ReactElement } from 'react';
import { useSession } from '../auth';
import { useLov } from '../shared/hooks/use-lov';
import { runPersistenceIO, trpc } from '../shared/lib/trpc';
import { canPostponeGuard, moveToEnd } from '@shared/domain/exam-queue';
import { useNotesAndBookmarks } from '../shared/hooks/use-notes-bookmarks';
import { useLeaveWarning } from '../shared/hooks/use-leave-warning';
import { useRegisterRun } from '../shared/run-guard-context';
import { useRunPersistence } from '@shared/react/use-run-persistence';
import QuitTestDialog from '../components/QuitTestDialog';
import {
  exitPrompt,
  processableAnswers,
  shouldPromptOnExit,
  type AnswerDraft,
} from '@shared/run/exit-rules';
import {
  appendAnswer,
  dedupeAnswers,
  standardDraftPayload,
  type DraftClaim,
} from '@shared/run/run-persistence';
import TestCompleted from './testing-completed';
import StandardQuestion from './testing-standard-question';
import RunOverlays from './testing-run-overlays';
import type { StandardRunStart, TestQuestion } from './testing-standard-types';
import {
  NO_ELIMINATIONS,
  clearForQuestion,
  eliminatedFor,
  eliminationDropsAnswer,
  toggleElimination,
  type EliminationState,
} from '@shared/domain/eliminations';

interface StandardBoardProps {
  start: StandardRunStart;
  /** pt-BR warning carried in from a reconciled resume, or null. */
  notice: string | null;
  onExitToModes: () => void;
  onRestart: () => void;
  /** CONFLICT → rehydrate from the server's copy. */
  onReloadFromServer: () => void;
}

export default function StandardBoard({
  start,
  notice,
  onExitToModes,
  onRestart,
  onReloadFromServer,
}: StandardBoardProps): ReactElement {
  const { user } = useSession();
  const disciplineLov = useLov('DISCIPLINE');
  const examBoardLov = useLov('EXAM_BOARD');
  const utils = trpc.useUtils();
  const notesAndBookmarks = useNotesAndBookmarks();

  const [questions, setQuestions] = useState<TestQuestion[]>(start.questions);
  const [currentIndex, setCurrentIndex] = useState(start.cursor);
  const [answers, setAnswers] = useState<AnswerDraft[]>(start.answers);
  const [selectedAnswer, setSelectedAnswer] = useState('');
  const [checked, setChecked] = useState(false);
  const [finished, setFinished] = useState(false);
  const [busy, setBusy] = useState(false);
  const [timeSpent, setTimeSpent] = useState(0);
  const [timer, setTimer] = useState(start.elapsedSeconds);
  const [eliminations, setEliminations] = useState<EliminationState>(NO_ELIMINATIONS);
  const [exitOpen, setExitOpen] = useState(false);
  const carriedTimeRef = useRef<Map<string, number>>(start.carriedTime);

  const recordMutation = trpc.sessions.record.useMutation({
    onSuccess: () => {
      void utils.stats.invalidate();
      void utils.sessions.invalidate();
      // The draft died in the same transaction — the card must stop offering
      // it, and `get` must stop handing the dead row to the NEXT run's
      // `learnDraftId` (a stale id there claims zero rows = a false CONFLICT).
      void utils.examDrafts.invalidate();
    },
  });

  const persistence = useRunPersistence('standard', (token) =>
    finished
      ? null
      : standardDraftPayload({
          setup: {
            discipline: start.filters.discipline,
            examBoard: start.filters.examBoard !== '' ? start.filters.examBoard : null,
            difficulty: start.filters.difficulty !== '' ? start.filters.difficulty : null,
          },
          questionIds: questions.map((q) => q.id),
          cursor: currentIndex,
          answers,
          carriedTime: carriedTimeRef.current,
          elapsedSeconds: timer,
          token,
        }),
    runPersistenceIO,
  );

  // A resumed run already owns its row: adopting during render (a ref write,
  // nothing painted) keeps the token out of an effect, where a re-run would
  // overwrite a fresher token with the one this mount started from.
  const adoptedRef = useRef(false);
  if (!adoptedRef.current) {
    adoptedRef.current = true;
    if (start.draft !== null) persistence.adopt(start.draft.id, start.draft.token);
  }

  const currentQuestion = questions[currentIndex];
  // A question already checked counts as answered: it is locked and joins the
  // payload on exit, exactly as "Próxima" would have recorded it. It is NOT
  // persisted (D8), so the card's "(n/N)" may show one less than this.
  const answeredCount = answers.length + (checked ? 1 : 0);

  useEffect(() => {
    if (finished || currentIndex >= questions.length) return;
    const interval = setInterval(() => {
      setTimer((t) => t + 1);
      setTimeSpent((t) => t + 1);
    }, 1000);
    return () => {
      clearInterval(interval);
    };
  }, [finished, currentIndex, questions.length]);

  useLeaveWarning(!finished && shouldPromptOnExit(answeredCount));

  const recordRun = async (
    finalAnswers: AnswerDraft[],
    claim: DraftClaim | undefined,
  ): Promise<void> => {
    try {
      await recordMutation.mutateAsync({
        discipline: start.filters.discipline !== '' ? start.filters.discipline : 'Geral',
        difficulty:
          start.filters.difficulty !== ''
            ? (start.filters.difficulty as 'easy' | 'medium' | 'hard')
            : 'medium',
        // One answer per question, always — the last word wins. A retry after
        // a failed recording re-enters through here and must never write the
        // same question twice (two `user_answers` rows, an 11-of-10 run, SM-2
        // stepped twice).
        answers: dedupeAnswers(finalAnswers),
        // Criterion 5: a persisted run is NEVER recorded without its claim, or
        // the draft would survive its own session and come back as "Continuar".
        ...(claim !== undefined ? { draft: claim } : {}),
      });
      persistence.close();
    } catch (error: unknown) {
      // The draft moved between the flush and the claim — nothing was written.
      persistence.reportError(error);
      setFinished(false);
    }
  };

  const handleNext = async (): Promise<void> => {
    if (!user || currentIndex >= questions.length || busy) return;
    const correct = selectedAnswer === currentQuestion.correctAnswer;
    const totalTimeSpent = timeSpent + (carriedTimeRef.current.get(currentQuestion.id) ?? 0);
    // `appendAnswer`, never a spread: after a failed recording the run comes
    // back on screen with this question ALREADY in `answers`, and the second
    // click must overwrite that entry instead of adding a twin.
    const updated: AnswerDraft[] = appendAnswer(answers, {
      questionId: currentQuestion.id,
      userAnswer: selectedAnswer,
      correct,
      timeSpent: totalTimeSpent,
    });
    setAnswers(updated);
    // The answer is recorded — its cross-outs have served their purpose.
    setEliminations((prev) => clearForQuestion(prev, currentQuestion.id));

    if (currentIndex + 1 < questions.length) {
      setCurrentIndex(currentIndex + 1);
      setSelectedAnswer('');
      setChecked(false);
      setTimeSpent(0);
      persistence.scheduleSave();
      return;
    }

    setBusy(true);
    setFinished(true);
    const flushed = await persistence.flush();
    setBusy(false);
    if (!flushed.ok) {
      setFinished(false);
      return;
    }
    await recordRun(updated, flushed.claim);
  };

  // Leaving a running test asks first (BR-05.4); with nothing answered there is
  // nothing to process, so the mode is left silently.
  const requestExit = (): void => {
    if (!shouldPromptOnExit(answeredCount)) {
      onExitToModes();
      return;
    }
    setExitOpen(true);
  };

  // "Sair e processar respostas": record what was answered through the normal
  // path and show the normal result screen. The current question only joins the
  // payload once it was checked (BR-05.6 / BR-03).
  const handleQuitAndProcess = async (): Promise<void> => {
    // Reachable without any dialog open: the final flush of `handleNext` holds
    // `busy` while the sidebar guard can still fire. Silence here is what let
    // the student click into nothing.
    if (busy) {
      persistence.reportBusy();
      return;
    }
    const carried = carriedTimeRef.current.get(currentQuestion.id) ?? 0;
    const finalAnswers = processableAnswers(
      checked
        ? appendAnswer(answers, {
          questionId: currentQuestion.id,
          userAnswer: selectedAnswer,
          correct: selectedAnswer === currentQuestion.correctAnswer,
          timeSpent: timeSpent + carried,
        })
        : answers,
    );
    if (finalAnswers.length === 0) {
      setExitOpen(false);
      onExitToModes();
      return;
    }
    setBusy(true);
    const flushed = await persistence.flush();
    setBusy(false);
    setExitOpen(false);
    // A CONFLICT here records NOTHING: whoever continued this run continued it
    // FROM this state, and a session recorded without the claim would leave the
    // draft alive on top of it.
    if (!flushed.ok) return;
    setAnswers(finalAnswers);
    setFinished(true);
    await recordRun(finalAnswers, flushed.claim);
  };

  // "Salvar e sair" (BR-05.3). Resolves true only once the run is safely on the
  // server, so the sidebar guard knows whether it may navigate.
  const handleSaveAndExit = async (): Promise<boolean> => {
    // Same silent path as above, through the guard's "Salvar e sair".
    if (busy) {
      persistence.reportBusy();
      return false;
    }
    setBusy(true);
    // Marks the run dirty so the flush ALWAYS writes: a student who saves
    // between two debounce windows must still find the run waiting.
    persistence.scheduleSave();
    const flushed = await persistence.flush();
    setBusy(false);
    if (!flushed.ok) {
      setExitOpen(false);
      return false;
    }
    persistence.close();
    void utils.examDrafts.invalidate();
    setExitOpen(false);
    onExitToModes();
    return true;
  };

  // Leaving through the sidebar asks the same question (slice S1b) and, since
  // S2b, offers the same "Salvar e sair" — registered before any early return.
  useRegisterRun(
    { mode: 'standard', running: !finished, answeredCount, totalQuestions: questions.length },
    () => {
      void handleQuitAndProcess();
    },
    handleSaveAndExit,
  );

  // Cross out / restore an alternative (BR-02). A crossed-out alternative can
  // no longer be the answer, so it drops the current selection. Never saved.
  const handleToggleEliminate = (option: string): void => {
    setEliminations((prev) => toggleElimination(prev, currentQuestion.id, option));
    if (eliminationDropsAnswer(selectedAnswer, option)) setSelectedAnswer('');
  };

  // Moves the current question to the end of the queue without recording an
  // answer. Deliberately does NOT save (BR-02.3 / D8: a draft is not progress):
  // closing the tab right after postponing loses that reordering until the
  // next answer.
  const handlePostpone = (): void => {
    if (currentIndex >= questions.length - 1) return;
    carriedTimeRef.current.set(
      currentQuestion.id,
      (carriedTimeRef.current.get(currentQuestion.id) ?? 0) + timeSpent,
    );
    setQuestions((prev) => moveToEnd(prev, currentIndex));
    setSelectedAnswer('');
    setChecked(false);
    setTimeSpent(0);
  };

  if (finished) {
    return (
      <TestCompleted
        questions={questions}
        answers={answers}
        disciplineLov={disciplineLov}
        onSwitchMode={onExitToModes}
        onRestart={onRestart}
      />
    );
  }

  return (
    <>
      <StandardQuestion
        currentQuestion={currentQuestion}
        currentIndex={currentIndex}
        totalAnswered={answers.length}
        totalQuestions={questions.length}
        timer={timer}
        selectedAnswer={selectedAnswer}
        checked={checked}
        busy={busy}
        notice={notice}
        onCheck={() => { setChecked(true); }}
        notesAndBookmarks={notesAndBookmarks}
        disciplineLov={disciplineLov}
        examBoardLov={examBoardLov}
        onBack={requestExit}
        onSelect={setSelectedAnswer}
        onNext={() => { void handleNext(); }}
        canPostpone={canPostponeGuard({ checked, hasMoreQuestions: currentIndex < questions.length - 1 })}
        onPostpone={handlePostpone}
        eliminatedOptions={eliminatedFor(eliminations, currentQuestion.id)}
        onToggleEliminate={handleToggleEliminate}
      />
      <QuitTestDialog
        open={exitOpen}
        prompt={exitPrompt('standard', answeredCount, questions.length)}
        busy={busy}
        onContinue={() => { setExitOpen(false); }}
        onQuit={() => { void handleQuitAndProcess(); }}
        onSave={() => { void handleSaveAndExit(); }}
      />
      <RunOverlays
        persistence={persistence}
        busy={busy}
        onReload={onReloadFromServer}
        onRestart={onRestart}
        onExitToModes={onExitToModes}
      />
    </>
  );
}
