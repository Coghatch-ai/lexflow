// The Simulado Adaptativo run itself (BR-05, epic #67 slice S2c): the drawn
// pool, the ladder, the deferred FIFO — plus the server-side persistence wired
// onto them.
//
// Mounted with a `key` per run (see `AdaptiveSimulation`), so a fresh simulado
// gets a fresh scheduler and a fresh draft identity without any reset path to
// get wrong. Everything it DECIDES comes from pure modules
// (`shared/domain/adaptive`, `shared/lib/exam-queue`,
// `shared/lib/run-persistence`); this file only wires.
//
// What is persisted (D8): the SERVED list (`questionIds`, duplicates and all),
// its cursor, the answers, the ladder verbatim and the deferred FIFO's ids.
// What is not: the candidate pool — re-drawn from the persisted filters — and
// the carried time of a postponed question.

import { useRef, useState, type ReactElement } from 'react';
import { useSession } from '../auth';
import { useLov } from '../shared/hooks/use-lov';
import { trpc } from '../shared/lib/trpc';
import { canPostponeAdaptive, nextAdaptiveStep } from '../shared/lib/exam-queue';
import { useNotesAndBookmarks } from '../shared/hooks/use-notes-bookmarks';
import { useLeaveWarning } from '../shared/hooks/use-leave-warning';
import { useRegisterRun } from '../shared/run-guard-context';
import { useRunPersistence } from '../shared/hooks/use-run-persistence';
import { useRunClock } from '../shared/hooks/use-run-clock';
import {
  processableAnswers,
  shouldPromptOnExit,
  type AnswerDraft,
} from '../shared/lib/exit-rules';
import {
  adaptiveDraftPayload,
  appendAnswer,
  dedupeAnswers,
  type DraftClaim,
} from '../shared/lib/run-persistence';
import {
  NO_ELIMINATIONS,
  clearForQuestion,
  eliminatedFor,
  eliminationDropsAnswer,
  toggleElimination,
  type EliminationState,
} from '../shared/lib/eliminations';
import { useAdaptivePool } from './adaptive-pool';
import {
  type AdaptiveQuestion,
  type AdaptiveState,
  type Difficulty,
} from './adaptive-screens';
import AdaptiveBoardView from './adaptive-board-view';
import type { AdaptiveRunStart } from './adaptive-types';

interface AdaptiveBoardProps {
  start: AdaptiveRunStart;
  /** pt-BR warning carried in from a reconciled resume, or null. */
  notice: string | null;
  onExitToModes: () => void;
  /** The server's copy was discarded — back to the setup screen. */
  onRestart: () => void;
  /** CONFLICT → rehydrate from the server's copy. */
  onReloadFromServer: () => void;
}

export default function AdaptiveBoard({
  start,
  notice,
  onExitToModes,
  onRestart,
  onReloadFromServer,
}: AdaptiveBoardProps): ReactElement {
  const { user } = useSession();
  const disciplineLov = useLov('DISCIPLINE');
  const examBoardLov = useLov('EXAM_BOARD');
  const difficultyLov = useLov('DIFFICULTY');
  const utils = trpc.useUtils();
  const notesAndBookmarks = useNotesAndBookmarks();

  // Seeded from `start` — a fresh simulado or a resumed one, one shape either
  // way. `AdaptiveBoard` is mounted with a `key` per run, so the initial state
  // IS the run: nothing has to re-seed it later.
  const pool = useAdaptivePool({
    pool: start.pool,
    questions: start.questions,
    currentIndex: start.cursor,
    deferred: start.deferred,
  });
  const { questions, currentIndex, deferred } = pool;
  const [answers, setAnswers] = useState<AnswerDraft[]>(start.answers);
  const [adaptive, setAdaptive] = useState<AdaptiveState>(start.adaptive);
  const [selectedAnswer, setSelectedAnswer] = useState('');
  const [lastCorrect, setLastCorrect] = useState<boolean | null>(null);
  const [checked, setChecked] = useState(false);
  const [finished, setFinished] = useState(false);
  const [busy, setBusy] = useState(false);
  const [eliminations, setEliminations] = useState<EliminationState>(NO_ELIMINATIONS);
  const [exitOpen, setExitOpen] = useState(false);

  const totalQuestions = start.setup.totalQuestions;

  const recordMutation = trpc.sessions.record.useMutation({
    onSuccess: () => {
      void utils.stats.invalidate();
      void utils.sessions.invalidate();
      // The draft died in the same transaction — the card must stop offering it.
      void utils.examDrafts.invalidate();
    },
  });

  const persistence = useRunPersistence('adaptive', (token) =>
    finished
      ? null
      : adaptiveDraftPayload({
          setup: start.setup,
          questionIds: questions.map((q) => q.id),
          cursor: currentIndex,
          answers,
          adaptive,
          deferredIds: deferred.map((q) => q.id),
          elapsedSeconds: timer,
          token,
        }),
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
  const answeredCount = answers.length;
  const { timer, questionTime, resetQuestion } = useRunClock(!finished, start.elapsedSeconds);

  useLeaveWarning(!finished && shouldPromptOnExit(answeredCount));

  const recordRun = async (
    finalAnswers: AnswerDraft[],
    claim: DraftClaim | undefined,
  ): Promise<void> => {
    try {
      await recordMutation.mutateAsync({
        discipline: start.setup.discipline !== '' ? start.setup.discipline : 'Geral',
        difficulty: adaptive.currentDifficulty,
        // One answer per question, always — the last word wins. A retry after
        // a failed recording re-enters here and must never write a twin.
        answers: dedupeAnswers(finalAnswers),
        // Criterion 6: a persisted run is NEVER recorded without its claim, or
        // the draft would survive its own session and come back as "Continuar".
        ...(claim !== undefined ? { draft: claim } : {}),
      });
      persistence.close();
    } catch (error: unknown) {
      persistence.reportError(error);
      setFinished(false);
    }
  };

  /** The single door out of a run: flush FIRST, then record with the claim. */
  const finish = async (log: AnswerDraft[]): Promise<void> => {
    setBusy(true);
    setFinished(true);
    const flushed = await persistence.flush();
    setBusy(false);
    if (!flushed.ok) {
      setFinished(false);
      return;
    }
    await recordRun(log, flushed.claim);
  };

  const handleAnswer = (): void => {
    if (!user || checked) return;
    const correct = selectedAnswer === currentQuestion.correctAnswer;
    setLastCorrect(correct);
    // `appendAnswer`, never a spread: after a failed recording the run comes
    // back on screen with this question ALREADY in `answers`.
    setAnswers(
      appendAnswer(answers, {
        questionId: currentQuestion.id,
        userAnswer: selectedAnswer,
        correct,
        timeSpent: questionTime + pool.carriedFor(currentQuestion.id),
      }),
    );
    setEliminations((prev) => clearForQuestion(prev, currentQuestion.id));
    setAdaptive({
      currentDifficulty: adaptive.currentDifficulty,
      consecutiveCorrect: correct ? adaptive.consecutiveCorrect + 1 : 0,
      consecutiveWrong: correct ? 0 : adaptive.consecutiveWrong + 1,
      totalCorrect: adaptive.totalCorrect + (correct ? 1 : 0),
      totalAnswered: adaptive.totalAnswered + 1,
      difficultyHistory: [...adaptive.difficultyHistory, adaptive.currentDifficulty],
    });
    setChecked(true);
    persistence.scheduleSave();
  };

  // Put `question` on screen as the next one, at `difficulty` — one history
  // entry per question served, whether it was drawn from the pool or came back
  // from the deferred FIFO (a deferred question is fixed, so the level shown
  // must be its own).
  const advanceTo = (question: AdaptiveQuestion, difficulty: Difficulty): void => {
    setAdaptive((prev) => ({
      ...prev,
      currentDifficulty: difficulty,
      difficultyHistory: [...prev.difficultyHistory, difficulty],
    }));
    pool.advance(question);
    setSelectedAnswer('');
    resetQuestion();
    setLastCorrect(null);
    setChecked(false);
    persistence.scheduleSave();
  };

  // Serve the head of the deferred FIFO at the TAIL of the simulado.
  const serveDeferred = (head: AdaptiveQuestion): void => {
    pool.dropHead();
    advanceTo(head, head.difficulty);
  };

  const handleNext = async (): Promise<void> => {
    if (busy) {
      persistence.reportBusy();
      return;
    }
    const step = nextAdaptiveStep({
      adaptive,
      totalQuestions,
      deferredCount: deferred.length,
      poolExhausted: !pool.hasUnseen,
    });
    const head = pool.head;
    if (step.kind === 'finish') {
      await finish(answers);
      return;
    }
    if (step.kind === 'deferred' && head !== undefined) {
      serveDeferred(head);
      return;
    }
    const drawn = step.kind === 'draw' ? pool.fetchQuestion(step.difficulty) : null;
    if (drawn !== null && step.kind === 'draw') {
      advanceTo(drawn, step.difficulty);
    } else if (head !== undefined) {
      // Pool dry but questions still owed: the deferred FIFO is what is left.
      serveDeferred(head);
    } else {
      await finish(answers);
    }
  };

  // Leaving a running simulado asks first (BR-05.4); with nothing answered
  // there is nothing to process, so the mode is left silently.
  const requestExit = (): void => {
    if (!shouldPromptOnExit(answeredCount)) {
      onExitToModes();
      return;
    }
    setExitOpen(true);
  };

  const handleQuitAndProcess = async (): Promise<void> => {
    if (busy) {
      persistence.reportBusy();
      return;
    }
    const finalAnswers = processableAnswers(answers);
    if (finalAnswers.length === 0) {
      setExitOpen(false);
      onExitToModes();
      return;
    }
    setExitOpen(false);
    // A CONFLICT inside `finish` records NOTHING and puts the run back.
    await finish(finalAnswers);
  };

  // "Salvar e sair" (BR-05.3). Resolves true only once the run is safely on the
  // server, so the sidebar guard knows whether it may navigate.
  const handleSaveAndExit = async (): Promise<boolean> => {
    if (busy) {
      persistence.reportBusy();
      return false;
    }
    setBusy(true);
    // Marks the run dirty so the flush ALWAYS writes.
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

  useRegisterRun(
    { mode: 'adaptive', running: !finished, answeredCount, totalQuestions },
    () => {
      void handleQuitAndProcess();
    },
    handleSaveAndExit,
  );

  // Cross out / restore an alternative (BR-02); crossing out the chosen one
  // drops the selection (BR-02.2). Never saved.
  const handleToggleEliminate = (option: string): void => {
    setEliminations((prev) => toggleElimination(prev, currentQuestion.id, option));
    if (eliminationDropsAnswer(selectedAnswer, option)) setSelectedAnswer('');
  };

  // "Responder depois" (BR-03.1) in a pool-driven simulado: park the question in
  // the deferred FIFO and serve a substitute AT THE SAME DIFFICULTY — nothing
  // was answered, so no streak moves. Deliberately does NOT save (BR-02.3 / D8):
  // the parking reaches the server with the next answer.
  const handlePostpone = (): void => {
    const substitute = pool.fetchQuestion(adaptive.currentDifficulty);
    if (substitute === null) return;
    pool.park(currentQuestion, questionTime);
    pool.advance(substitute);
    setSelectedAnswer('');
    resetQuestion();
  };

  return (
    <AdaptiveBoardView
      adaptive={adaptive} totalQuestions={totalQuestions} answeredCount={answeredCount}
      timer={timer} currentQuestion={currentQuestion} selectedAnswer={selectedAnswer}
      lastCorrect={lastCorrect} checked={checked} finished={finished} busy={busy}
      exitOpen={exitOpen} notice={notice} persistence={persistence}
      canPostpone={canPostponeAdaptive({
        totalAnswered: adaptive.totalAnswered,
        totalQuestions,
        deferredCount: deferred.length,
        hasReplacement: pool.hasUnseen,
      })}
      eliminatedOptions={eliminatedFor(eliminations, currentQuestion.id)}
      notesAndBookmarks={notesAndBookmarks} disciplineLov={disciplineLov}
      examBoardLov={examBoardLov} difficultyLov={difficultyLov}
      onSelect={setSelectedAnswer} onToggleEliminate={handleToggleEliminate}
      onPostpone={handlePostpone} onAnswer={handleAnswer}
      onNext={() => { void handleNext(); }} onRequestExit={requestExit}
      onContinueRun={() => { setExitOpen(false); }}
      onQuitAndProcess={() => { void handleQuitAndProcess(); }}
      onSaveAndExit={() => { void handleSaveAndExit(); }}
      onReloadFromServer={onReloadFromServer} onRestart={onRestart}
      onExitToModes={onExitToModes}
    />
  );
}
