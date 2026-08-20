import { useState, useEffect, type ReactElement } from 'react';
import { useSession } from '../auth';
import { useLov } from '../shared/hooks/use-lov';
import { trpc } from '../shared/lib/trpc';
import { nextDifficulty } from '@shared/domain/adaptive';
import { mapAdaptiveRows, useAdaptivePool } from './adaptive-pool';
import { useNotesAndBookmarks } from '../shared/hooks/use-notes-bookmarks';
import { useLeaveWarning } from '../shared/hooks/use-leave-warning';
import QuitTestDialog from './QuitTestDialog';
import { exitPrompt, processableAnswers, shouldPromptOnExit } from '../shared/lib/exit-rules';
import { canPostponeAdaptive, shouldServeDeferred } from '../shared/lib/exam-queue';
import {
  NO_ELIMINATIONS,
  clearForQuestion,
  eliminatedFor,
  eliminationDropsAnswer,
  toggleElimination,
  type EliminationState,
} from '../shared/lib/eliminations';
import {
  type Difficulty,
  type AdaptiveQuestion,
  type AdaptiveState,
  AdaptiveSetup,
  AdaptivePlaying,
  AdaptiveFeedback,
  AdaptiveFinished,
} from './adaptive-screens';

type Status = 'setup' | 'playing' | 'feedback' | 'finished';

const INITIAL_ADAPTIVE: AdaptiveState = {
  currentDifficulty: 'medium',
  consecutiveCorrect: 0,
  consecutiveWrong: 0,
  totalCorrect: 0,
  totalAnswered: 0,
  difficultyHistory: [],
};

export default function AdaptiveSimulation({ onExit }: { onExit: () => void }): ReactElement {
  const { user } = useSession();
  const disciplineLov = useLov('DISCIPLINE');
  const examBoardLov = useLov('EXAM_BOARD');
  const difficultyLov = useLov('DIFFICULTY');
  const [status, setStatus] = useState<Status>('setup');
  const [selectedDiscipline, setSelectedDiscipline] = useState('');
  const [totalQuestions, setTotalQuestions] = useState(10);
  // The drawable pool, the served questions + cursor, and the deferred FIFO
  // that "Responder depois" parks into (BR-03.1) — see ./adaptive-pool.
  const pool = useAdaptivePool();
  const { questions, currentIndex, deferred } = pool;
  const [selectedAnswer, setSelectedAnswer] = useState('');
  const [adaptive, setAdaptive] = useState<AdaptiveState>(INITIAL_ADAPTIVE);
  const [questionTime, setTimeSpent] = useState(0);
  const [timer, setTimer] = useState(0);
  const [loading, setLoading] = useState(false);
  const [lastCorrect, setLastCorrect] = useState<boolean | null>(null);
  const [answerLog, setAnswerLog] = useState<
    { questionId: string; userAnswer: string; correct: boolean; timeSpent: number }[]
  >([]);
  // Crossed-out alternatives (BR-02) — session-only, never recorded. Cleared
  // per question once its answer is recorded; this screen has no "checked"
  // state (feedback is a separate screen), so `locked` is never passed.
  const [eliminations, setEliminations] = useState<EliminationState>(NO_ELIMINATIONS);
  // "Sair e processar" confirmation (BR-05) — the run stays mounted behind it.
  const [exitOpen, setExitOpen] = useState(false);

  const utils = trpc.useUtils();
  const recordMutation = trpc.sessions.record.useMutation({
    onSuccess: () => {
      void utils.stats.invalidate();
      void utils.sessions.invalidate();
    },
  });

  const notesAndBookmarks = useNotesAndBookmarks();
  const currentQuestion = questions[currentIndex];

  useEffect(() => {
    if (status === 'playing' && currentIndex < questions.length) {
      const interval = setInterval(() => {
        setTimer((t) => t + 1);
        setTimeSpent((t) => t + 1);
      }, 1000);
      return () => { clearInterval(interval); };
    }
  }, [status, currentIndex, questions.length]);

  const startSimulation = async () => {
    setLoading(true);
    try {
      const rows = await utils.questions.list.fetch({
        discipline: selectedDiscipline !== '' ? selectedDiscipline : undefined,
        limit: 100,
        phase: '1st',
      });
      const mapped = mapAdaptiveRows(rows);
      const firstQuestion = mapped.find((q) => q.difficulty === 'medium') ?? mapped.at(0);
      if (firstQuestion !== undefined) {
        pool.start(mapped, firstQuestion);
        setAnswerLog([]);
        setEliminations(NO_ELIMINATIONS);
        setAdaptive({ ...INITIAL_ADAPTIVE, difficultyHistory: ['medium'] });
        setSelectedAnswer('');
        setTimeSpent(0);
        setTimer(0);
        setLastCorrect(null);
        setStatus('playing');
      }
    } finally {
      setLoading(false);
    }
  };

  const running = status === 'playing' || status === 'feedback';
  // Closing the tab or reloading with answers already given warns first (BR-05.1).
  useLeaveWarning(running && shouldPromptOnExit(answerLog.length));

  const finish = (
    log: { questionId: string; userAnswer: string; correct: boolean; timeSpent: number }[]
  ) => {
    setStatus('finished');
    if (log.length > 0) {
      recordMutation.mutate({
        discipline: selectedDiscipline !== '' ? selectedDiscipline : 'Geral',
        difficulty: adaptive.currentDifficulty,
        answers: log,
      });
    }
  };

  // Leaving a running simulado asks first (BR-05.4); with nothing answered
  // there is nothing to process, so the mode is left silently.
  const requestExit = () => {
    if (!shouldPromptOnExit(answerLog.length)) {
      onExit();
      return;
    }
    setExitOpen(true);
  };

  // "Sair e processar respostas": `finish` is the same path the normal end of
  // the simulado takes. Unanswered questions are never recorded (BR-05.6 / BR-03).
  const handleQuitAndProcess = () => {
    setExitOpen(false);
    const log = processableAnswers(answerLog);
    if (log.length === 0) {
      onExit();
      return;
    }
    finish(log);
  };

  const quitDialog = (
    <QuitTestDialog
      open={exitOpen}
      prompt={exitPrompt('adaptive', answerLog.length, totalQuestions)}
      onContinue={() => { setExitOpen(false); }}
      onQuit={handleQuitAndProcess}
    />
  );

  const handleAnswer = () => {
    if (!user || currentIndex >= questions.length) return;
    const correct = selectedAnswer === currentQuestion.correctAnswer;
    setLastCorrect(correct);
    const totalTimeSpent = questionTime + pool.carriedFor(currentQuestion.id);
    setAnswerLog((log) => [
      ...log,
      { questionId: currentQuestion.id, userAnswer: selectedAnswer, correct, timeSpent: totalTimeSpent },
    ]);
    // The answer is recorded — its cross-outs have served their purpose.
    setEliminations((prev) => clearForQuestion(prev, currentQuestion.id));
    setAdaptive({
      currentDifficulty: adaptive.currentDifficulty,
      consecutiveCorrect: correct ? adaptive.consecutiveCorrect + 1 : 0,
      consecutiveWrong: correct ? 0 : adaptive.consecutiveWrong + 1,
      totalCorrect: adaptive.totalCorrect + (correct ? 1 : 0),
      totalAnswered: adaptive.totalAnswered + 1,
      difficultyHistory: [...adaptive.difficultyHistory, adaptive.currentDifficulty],
    });
    setStatus('feedback');
  };

  // Cross out / restore an alternative (BR-02); crossing out the chosen one
  // drops the selection (BR-02.2).
  const handleToggleEliminate = (option: string) => {
    setEliminations((prev) => toggleElimination(prev, currentQuestion.id, option));
    if (eliminationDropsAnswer(selectedAnswer, option)) setSelectedAnswer('');
  };

  // "Responder depois" (BR-03.1) in a pool-driven simulado: park the question in
  // the deferred FIFO and serve a substitute AT THE SAME DIFFICULTY — nothing was
  // answered, so there is no signal for `nextDifficulty` and none of
  // totalAnswered / consecutive* / difficultyHistory may move. No blank answer
  // is ever recorded; the cross-outs travel with the question.
  const handlePostpone = () => {
    const substitute = pool.fetchQuestion(adaptive.currentDifficulty);
    if (substitute === null) return;
    pool.park(currentQuestion, questionTime);
    pool.advance(substitute);
    setSelectedAnswer('');
    setTimeSpent(0);
  };

  // Put `question` on screen as the next one, at `difficulty` — one history
  // entry per question served, whether it was drawn from the pool or came back
  // from the deferred FIFO (a deferred question is fixed, so the level shown
  // must be its own).
  const advanceTo = (question: AdaptiveQuestion, difficulty: Difficulty) => {
    setAdaptive((prev) => ({
      ...prev,
      currentDifficulty: difficulty,
      difficultyHistory: [...prev.difficultyHistory, difficulty],
    }));
    pool.advance(question);
    setSelectedAnswer('');
    setTimeSpent(0);
    setLastCorrect(null);
    setStatus('playing');
  };

  // Serve the head of the deferred FIFO at the TAIL of the simulado — the
  // remaining slots are down to the deferred count, or the pool ran dry.
  const serveDeferred = (head: AdaptiveQuestion) => {
    pool.dropHead();
    advanceTo(head, head.difficulty);
  };

  const handleNext = () => {
    if (adaptive.totalAnswered >= totalQuestions) {
      finish(answerLog);
      return;
    }
    const head = pool.head;
    const drain = shouldServeDeferred({
      totalAnswered: adaptive.totalAnswered, totalQuestions,
      deferredCount: deferred.length, poolExhausted: !pool.hasUnseen,
    });
    if (head !== undefined && drain) {
      serveDeferred(head);
      return;
    }
    const nextDiff = nextDifficulty(
      adaptive.currentDifficulty, adaptive.consecutiveCorrect, adaptive.consecutiveWrong
    );
    const nextQuestion = pool.fetchQuestion(nextDiff);
    if (nextQuestion !== null) {
      advanceTo(nextQuestion, nextDiff);
    } else if (head !== undefined) {
      // Pool dry but questions still owed: the deferred FIFO is what is left.
      serveDeferred(head);
    } else {
      finish(answerLog);
    }
  };

  if (status === 'setup') {
    return (
      <AdaptiveSetup
        selectedDiscipline={selectedDiscipline}
        totalQuestions={totalQuestions}
        loading={loading}
        disciplineOptions={disciplineLov.options}
        onDisciplineChange={setSelectedDiscipline}
        onTotalQuestionsChange={setTotalQuestions}
        onStart={() => { void startSimulation(); }}
      />
    );
  }

  if (status === 'playing') {
    return (
      <>
        <AdaptivePlaying
          adaptive={adaptive}
          totalQuestions={totalQuestions}
          timer={timer}
          currentQuestion={currentQuestion}
          selectedAnswer={selectedAnswer}
          notesAndBookmarks={notesAndBookmarks}
          disciplineLov={disciplineLov}
          examBoardLov={examBoardLov}
          difficultyLov={difficultyLov}
          canPostpone={canPostponeAdaptive({
            totalAnswered: adaptive.totalAnswered,
            totalQuestions,
            deferredCount: deferred.length,
            hasReplacement: pool.hasUnseen,
          })}
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
        <AdaptiveFeedback
          adaptive={adaptive}
          totalQuestions={totalQuestions}
          lastCorrect={lastCorrect}
          currentQuestion={currentQuestion}
          difficultyLov={difficultyLov}
          onNext={handleNext}
          onRequestExit={requestExit}
        />
        {quitDialog}
      </>
    );
  }

  return (
    <AdaptiveFinished
      adaptive={adaptive}
      timer={timer}
      onReset={() => {
        setStatus('setup');
        setAdaptive(INITIAL_ADAPTIVE);
        setEliminations(NO_ELIMINATIONS);
        pool.reset();
      }}
    />
  );
}
