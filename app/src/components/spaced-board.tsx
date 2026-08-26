// The Revisão Espaçada run itself (BR-05, epic #67 slice S2c): the ≤5 queue,
// the answers — plus the server-side persistence wired onto them.
//
// Mounted with a `key` per run (see `SpacedRepetition`), so a fresh review gets
// a fresh scheduler and a fresh draft identity without any reset path to get
// wrong. Everything it DECIDES comes from pure modules
// (`shared/lib/run-persistence`, `shared/lib/exit-rules`); this file only wires.
//
// Two things are deliberately NOT persisted here (D8): the per-question timer's
// carried time — a review postponed and answered later starts its clock at zero
// — and any run clock at all, so the payload's `elapsedSeconds` is 0. Inventing
// one to look like BR-05.10 would report a number nothing measured.
//
// SM-2 never moves on a save: `upsertSm2States` runs inside `sessions.record`
// only. A review saved and left unprocessed changes no schedule, by
// construction rather than by a filter.

import { useRef, useState, type ReactElement } from 'react';
import { useSession } from '../auth';
import { useLov } from '../shared/hooks/use-lov';
import { trpc } from '../shared/lib/trpc';
import { moveToEnd } from '../shared/lib/exam-queue';
import { useNotesAndBookmarks } from '../shared/hooks/use-notes-bookmarks';
import { useLeaveWarning } from '../shared/hooks/use-leave-warning';
import { useRegisterRun } from '../shared/run-guard-context';
import { useRunPersistence } from '../shared/hooks/use-run-persistence';
import QuitTestDialog from './QuitTestDialog';
import RunOverlays from '../pages/testing-run-overlays';
import {
  exitPrompt,
  processableAnswers,
  shouldPromptOnExit,
  type AnswerDraft,
} from '../shared/lib/exit-rules';
import {
  appendAnswer,
  dedupeAnswers,
  spacedDraftPayload,
  type DraftClaim,
} from '../shared/lib/run-persistence';
import { displayIntervalDays } from '@shared/domain/spaced-repetition';
import {
  NO_ELIMINATIONS,
  clearForQuestion,
  eliminatedFor,
  eliminationDropsAnswer,
  toggleElimination,
  type EliminationState,
} from '../shared/lib/eliminations';
import { SpacedDone, SpacedFeedback, SpacedPlaying } from './spaced-screens';
import type { SpacedRunStart } from './spaced-types';

interface SpacedBoardProps {
  start: SpacedRunStart;
  /** pt-BR warning carried in from a reconciled resume, or null. */
  notice: string | null;
  onExitToModes: () => void;
  /** The server's copy was discarded — reload a fresh queue. */
  onRestart: () => void;
  /** CONFLICT → rehydrate from the server's copy. */
  onReloadFromServer: () => void;
}

export default function SpacedBoard({
  start,
  notice,
  onExitToModes,
  onRestart,
  onReloadFromServer,
}: SpacedBoardProps): ReactElement {
  const { user } = useSession();
  const disciplineLov = useLov('DISCIPLINE');
  const examBoardLov = useLov('EXAM_BOARD');
  const utils = trpc.useUtils();
  const notesAndBookmarks = useNotesAndBookmarks();

  const [questions, setQuestions] = useState(start.questions);
  const [currentIndex, setCurrentIndex] = useState(start.cursor);
  const [answers, setAnswers] = useState<AnswerDraft[]>(start.answers);
  const [selectedAnswer, setSelectedAnswer] = useState('');
  const [lastCorrect, setLastCorrect] = useState<boolean | null>(null);
  const [nextIntervalDays, setNextIntervalDays] = useState(1);
  const [questionTime, setTimeSpent] = useState(0);
  const [checked, setChecked] = useState(false);
  const [finished, setFinished] = useState(false);
  const [busy, setBusy] = useState(false);
  const [eliminations, setEliminations] = useState<EliminationState>(NO_ELIMINATIONS);
  const [exitOpen, setExitOpen] = useState(false);
  // Session-only (D8): a postponed review answered later restarts at zero.
  const carriedTimeRef = useRef<Map<string, number>>(new Map());

  const recordMutation = trpc.sessions.record.useMutation({
    onSuccess: () => {
      void utils.stats.invalidate();
      void utils.sessions.invalidate();
      // The SM-2 schedule moved and the draft died in the same transaction.
      void utils.questions.invalidate();
      void utils.examDrafts.invalidate();
    },
  });

  const persistence = useRunPersistence('spaced', (token) =>
    finished
      ? null
      : spacedDraftPayload({
          questionIds: questions.map((q) => q.id),
          cursor: currentIndex,
          answers,
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
  const correctCount = answers.filter((a) => a.correct).length;

  useLeaveWarning(!finished && shouldPromptOnExit(answeredCount));

  const recordRun = async (
    finalAnswers: AnswerDraft[],
    claim: DraftClaim | undefined,
  ): Promise<void> => {
    try {
      await recordMutation.mutateAsync({
        // From the REHYDRATED queue on a resume — never from a stale closure.
        discipline: currentQuestion.discipline,
        difficulty: 'medium',
        // One answer per question, always: a retry after a failed recording
        // re-enters here and must not step the same card's SM-2 twice.
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

  const handleAnswer = (): void => {
    if (!user || checked) return;
    const correct = selectedAnswer === currentQuestion.correctAnswer;
    setLastCorrect(correct);
    setNextIntervalDays(
      displayIntervalDays(
        { interval: currentQuestion.interval, repetitions: currentQuestion.repetitions },
        correct,
      ),
    );
    // `appendAnswer`, never a spread: after a failed recording the run comes
    // back on screen with this review ALREADY in `answers`, and the second
    // click must overwrite that entry instead of adding a twin.
    setAnswers(
      appendAnswer(answers, {
        questionId: currentQuestion.id,
        userAnswer: selectedAnswer,
        correct,
        timeSpent: questionTime + (carriedTimeRef.current.get(currentQuestion.id) ?? 0),
      }),
    );
    setEliminations((prev) => clearForQuestion(prev, currentQuestion.id));
    setChecked(true);
    persistence.scheduleSave();
  };

  const handleNext = async (): Promise<void> => {
    if (busy) {
      persistence.reportBusy();
      return;
    }
    if (currentIndex + 1 < questions.length) {
      setCurrentIndex(currentIndex + 1);
      setSelectedAnswer('');
      setLastCorrect(null);
      setTimeSpent(0);
      setChecked(false);
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
    await recordRun(answers, flushed.claim);
  };

  // Leaving a running review asks first (BR-05.4); with nothing answered there
  // is nothing to process, so the mode is left silently.
  const requestExit = (): void => {
    if (!shouldPromptOnExit(answeredCount)) {
      onExitToModes();
      return;
    }
    setExitOpen(true);
  };

  // "Sair e processar respostas": a review never answered is never recorded
  // (BR-05.6 / BR-03) and keeps its SM-2 schedule untouched.
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
    setBusy(true);
    const flushed = await persistence.flush();
    setBusy(false);
    setExitOpen(false);
    // A CONFLICT here records NOTHING: whoever continued this review continued
    // it FROM this state, and a session without the claim would leave the draft
    // alive on top of it.
    if (!flushed.ok) return;
    setFinished(true);
    await recordRun(finalAnswers, flushed.claim);
  };

  // "Salvar e sair" (BR-05.3). Resolves true only once the review is safely on
  // the server, so the sidebar guard knows whether it may navigate.
  const handleSaveAndExit = async (): Promise<boolean> => {
    if (busy) {
      persistence.reportBusy();
      return false;
    }
    setBusy(true);
    // Marks the run dirty so the flush ALWAYS writes: a student who saves
    // between two debounce windows must still find the review waiting.
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
    { mode: 'spaced', running: !finished, answeredCount, totalQuestions: questions.length },
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

  // "Responder depois" (BR-03.1): the queue is a materialized ≤5 array, so "end
  // of the queue" is literal. Deliberately does NOT save (BR-02.3 / D8) — the
  // reordering reaches the server with the next answer.
  const handlePostpone = (): void => {
    if (currentIndex >= questions.length - 1) return;
    carriedTimeRef.current.set(
      currentQuestion.id,
      (carriedTimeRef.current.get(currentQuestion.id) ?? 0) + questionTime,
    );
    setQuestions((prev) => moveToEnd(prev, currentIndex));
    setSelectedAnswer('');
    setTimeSpent(0);
  };

  const overlays = (
    <RunOverlays
      persistence={persistence}
      busy={busy}
      onReload={onReloadFromServer}
      onRestart={onRestart}
      onExitToModes={onExitToModes}
    />
  );

  if (finished) {
    return (
      <>
        <SpacedDone sessionCorrect={correctCount} sessionTotal={answeredCount} onReload={onRestart} />
        {overlays}
      </>
    );
  }

  const quitDialog = (
    <QuitTestDialog
      open={exitOpen}
      prompt={exitPrompt('spaced', answeredCount, questions.length)}
      busy={busy}
      onContinue={() => { setExitOpen(false); }}
      onQuit={() => { void handleQuitAndProcess(); }}
      onSave={() => { void handleSaveAndExit(); }}
    />
  );

  if (checked) {
    return (
      <>
        <SpacedFeedback
          currentIndex={currentIndex}
          total={questions.length}
          currentQuestion={currentQuestion}
          lastCorrect={lastCorrect}
          nextIntervalDays={nextIntervalDays}
          onNext={() => { void handleNext(); }}
          onRequestExit={requestExit}
        />
        {quitDialog}
        {overlays}
      </>
    );
  }

  return (
    <>
      <SpacedPlaying
        currentIndex={currentIndex}
        total={questions.length}
        currentQuestion={currentQuestion}
        selectedAnswer={selectedAnswer}
        notice={notice}
        notesAndBookmarks={notesAndBookmarks}
        disciplineLov={disciplineLov}
        examBoardLov={examBoardLov}
        canPostpone={currentIndex < questions.length - 1}
        eliminatedOptions={eliminatedFor(eliminations, currentQuestion.id)}
        onSelect={setSelectedAnswer}
        onToggleEliminate={handleToggleEliminate}
        onPostpone={handlePostpone}
        onAnswer={handleAnswer}
        onRequestExit={requestExit}
      />
      {quitDialog}
      {overlays}
    </>
  );
}
