import { useEffect, useRef, useState, type ReactElement } from 'react';
import { useSession } from '../auth';
import { useLov } from '../shared/hooks/use-lov';
import { trpc } from '../shared/lib/trpc';
import { shuffle } from '../shared/lib/shuffle';
import { useNotesAndBookmarks } from '../shared/hooks/use-notes-bookmarks';
import { useLeaveWarning } from '../shared/hooks/use-leave-warning';
import { useRegisterRun } from '../shared/run-guard-context';
import QuitTestDialog from './QuitTestDialog';
import { exitPrompt, processableAnswers, shouldPromptOnExit } from '../shared/lib/exit-rules';
import { moveToEnd } from '../shared/lib/exam-queue';
import {
  NO_ELIMINATIONS,
  clearForQuestion,
  eliminatedFor,
  eliminationDropsAnswer,
  toggleElimination,
  type EliminationState,
} from '../shared/lib/eliminations';
import {
  type ReviewItem,
  SpacedDone,
  SpacedEmptyState,
  SpacedFeedback,
  SpacedPlaying,
} from './spaced-screens';

type Status = 'loading' | 'empty' | 'playing' | 'feedback' | 'done';

export default function SpacedRepetition({ onExit }: { onExit: () => void }): ReactElement {
  const { user } = useSession();
  const disciplineLov = useLov('DISCIPLINE');
  const examBoardLov = useLov('EXAM_BOARD');
  const reviewQuery = trpc.questions.reviewQueue.useQuery();
  const dueCountQuery = trpc.questions.dueCount.useQuery();
  const utils = trpc.useUtils();
  const recordMutation = trpc.sessions.record.useMutation({
    onSuccess: () => {
      void utils.stats.invalidate();
      void utils.sessions.invalidate();
      void utils.questions.invalidate();
    },
  });

  const notesAndBookmarks = useNotesAndBookmarks();

  const [status, setStatus] = useState<Status>('loading');
  const [reviewQuestions, setReviewQuestions] = useState<ReviewItem[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [selectedAnswer, setSelectedAnswer] = useState('');
  const [lastCorrect, setLastCorrect] = useState<boolean | null>(null);
  const [nextIntervalDays, setNextIntervalDays] = useState<number>(1);
  const [questionTime, setTimeSpent] = useState(0);
  const [sessionCorrect, setSessionCorrect] = useState(0);
  const [sessionTotal, setSessionTotal] = useState(0);
  const [answerLog, setAnswerLog] = useState<
    { questionId: string; userAnswer: string; correct: boolean; timeSpent: number }[]
  >([]);
  // Crossed-out alternatives (BR-02) — session-only, never recorded, never fed
  // to SM-2. Cleared per question once its answer is recorded; this screen has
  // no "checked" state, so `locked` is never passed to the card.
  const [eliminations, setEliminations] = useState<EliminationState>(NO_ELIMINATIONS);
  // "Sair e processar" confirmation (BR-05) — the review stays mounted behind it.
  const [exitOpen, setExitOpen] = useState(false);

  // Time already spent on a review postponed via "Responder depois", keyed by
  // question id and re-added when the review is finally answered.
  const carriedTimeRef = useRef<Map<string, number>>(new Map());

  // Map the review queue into session state only while in 'loading' status and
  // never against an in-flight fetch: background refetches (window focus after
  // staleTime, invalidate on record) must not replace — and reshuffle — the
  // questions mid-session.
  useEffect(() => {
    if (!user || status !== 'loading' || reviewQuery.isFetching) return;
    const data = reviewQuery.data ?? [];
    if (data.length === 0) {
      setStatus('empty');
      return;
    }
    const items: ReviewItem[] = data.slice(0, 5).map((q) => ({
      id: q.id,
      questionText: q.questionText,
      options: shuffle(q.options),
      correctAnswer: q.correctAnswer,
      explanation: q.explanation,
      aiExplanation: q.aiExplanation ?? null,
      discipline: q.discipline,
      examBoard: q.examBoard,
      difficulty: q.difficulty,
      legislationTitle: q.legislationTitle,
      interval: q.interval,
      repetitions: q.repetitions,
      nextReviewAt: q.nextReviewAt,
      lastCorrect: q.lastCorrect ?? null,
    }));
    setReviewQuestions(items);
    setStatus('playing');
  }, [user, status, reviewQuery.isFetching, reviewQuery.data]);

  const currentQuestion = reviewQuestions[currentIndex];
  const dueCount = dueCountQuery.data?.count ?? 0;

  const handleAnswer = () => {
    if (!user || currentIndex >= reviewQuestions.length) return;

    const correct = selectedAnswer === currentQuestion.correctAnswer;
    setLastCorrect(correct);

    const reps = currentQuestion.repetitions;
    let displayInterval: number;
    if (!correct) {
      displayInterval = 1;
    } else if (reps === 0) {
      displayInterval = 1;
    } else if (reps === 1) {
      displayInterval = 6;
    } else {
      displayInterval = Math.round(currentQuestion.interval * 2.5);
    }
    setNextIntervalDays(displayInterval);

    const totalTimeSpent = questionTime + (carriedTimeRef.current.get(currentQuestion.id) ?? 0);
    setAnswerLog((log) => [
      ...log,
      {
        questionId: currentQuestion.id,
        userAnswer: selectedAnswer,
        correct,
        timeSpent: totalTimeSpent,
      },
    ]);
    // The answer is recorded — its cross-outs have served their purpose.
    setEliminations((prev) => clearForQuestion(prev, currentQuestion.id));

    if (correct) setSessionCorrect((c) => c + 1);
    setSessionTotal((t) => t + 1);
    setStatus('feedback');
  };

  const running = status === 'playing' || status === 'feedback';
  // Closing the tab or reloading with reviews already answered warns first (BR-05.1).
  useLeaveWarning(running && shouldPromptOnExit(answerLog.length));
  // Leaving through the sidebar asks the same question (slice S1b).
  useRegisterRun(
    { mode: 'spaced', running, answeredCount: answerLog.length, totalQuestions: reviewQuestions.length },
    () => { handleQuitAndProcess(); },
  );

  // Leaving a running review asks first (BR-05.4); with nothing answered there
  // is nothing to process, so the mode is left silently.
  const requestExit = () => {
    if (!shouldPromptOnExit(answerLog.length)) {
      onExit();
      return;
    }
    setExitOpen(true);
  };

  // "Sair e processar respostas": record what was answered through the same path
  // a finished review uses. A question never answered is never recorded
  // (BR-05.6 / BR-03) and keeps its SM-2 schedule untouched.
  const handleQuitAndProcess = () => {
    setExitOpen(false);
    const log = processableAnswers(answerLog);
    if (log.length === 0) {
      onExit();
      return;
    }
    setStatus('done');
    recordMutation.mutate({
      discipline: currentQuestion.discipline,
      difficulty: 'medium',
      answers: log,
    });
  };

  const quitDialog = (
    <QuitTestDialog
      open={exitOpen}
      prompt={exitPrompt('spaced', answerLog.length, reviewQuestions.length)}
      onContinue={() => { setExitOpen(false); }}
      onQuit={handleQuitAndProcess}
    />
  );

  // Cross out / restore an alternative (BR-02). Crossing out the chosen one
  // drops the selection (BR-02.2); nothing here reaches sessions.record or SM-2.
  const handleToggleEliminate = (option: string) => {
    setEliminations((prev) => toggleElimination(prev, currentQuestion.id, option));
    if (eliminationDropsAnswer(selectedAnswer, option)) setSelectedAnswer('');
  };

  // "Responder depois" (BR-03.1): the review queue is a materialized ≤5 array,
  // so "end of the queue" is literal — `moveToEnd` with `currentIndex` staying
  // put, exactly like the Simulado Padrão. NO answer is recorded, so SM-2 is
  // untouched: only sessions.record moves a card's schedule.
  const handlePostpone = () => {
    if (currentIndex >= reviewQuestions.length - 1) return;
    carriedTimeRef.current.set(
      currentQuestion.id,
      (carriedTimeRef.current.get(currentQuestion.id) ?? 0) + questionTime,
    );
    setReviewQuestions((prev) => moveToEnd(prev, currentIndex));
    setSelectedAnswer('');
    setTimeSpent(0);
  };

  const handleNext = () => {
    if (currentIndex + 1 >= reviewQuestions.length) {
      setStatus('done');
      if (answerLog.length > 0) {
        recordMutation.mutate({
          discipline: currentQuestion.discipline,
          difficulty: 'medium',
          answers: answerLog,
        });
      }
    } else {
      setCurrentIndex((i) => i + 1);
      setSelectedAnswer('');
      setLastCorrect(null);
      setTimeSpent(0);
      setStatus('playing');
    }
  };

  if (status === 'loading') {
    return (
      <div className="bg-white rounded-xl p-6 shadow flex items-center justify-center h-48">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#16161a]" />
      </div>
    );
  }

  if (status === 'empty') {
    return <SpacedEmptyState dueCount={dueCount} />;
  }

  if (status === 'playing') {
    return (
      <>
        <SpacedPlaying
          currentIndex={currentIndex}
          total={reviewQuestions.length}
          currentQuestion={currentQuestion}
          selectedAnswer={selectedAnswer}
          notesAndBookmarks={notesAndBookmarks}
          disciplineLov={disciplineLov}
          examBoardLov={examBoardLov}
          canPostpone={currentIndex < reviewQuestions.length - 1}
          eliminatedOptions={eliminatedFor(eliminations, currentQuestion.id)}
          onSelect={setSelectedAnswer}
          onToggleEliminate={handleToggleEliminate}
          onPostpone={handlePostpone}
          onAnswer={handleAnswer}
          onRequestExit={requestExit}
        />
        {quitDialog}
      </>
    );
  }

  if (status === 'feedback') {
    return (
      <>
        <SpacedFeedback
          currentIndex={currentIndex}
          total={reviewQuestions.length}
          currentQuestion={currentQuestion}
          lastCorrect={lastCorrect}
          nextIntervalDays={nextIntervalDays}
          onNext={handleNext}
          onRequestExit={requestExit}
        />
        {quitDialog}
      </>
    );
  }

  return (
    <SpacedDone
      sessionCorrect={sessionCorrect}
      sessionTotal={sessionTotal}
      onReload={() => {
        void reviewQuery.refetch();
        setStatus('loading');
        setCurrentIndex(0);
        setAnswerLog([]);
        setSessionCorrect(0);
        setSessionTotal(0);
        setEliminations(NO_ELIMINATIONS);
        carriedTimeRef.current = new Map();
      }}
    />
  );
}
