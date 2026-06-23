import { useState, useEffect, useCallback, type ReactElement } from 'react';
import { useSession } from '../auth';
import { useLov } from '../shared/hooks/use-lov';
import { trpc } from '../shared/lib/trpc';
import { shuffle } from '../shared/lib/shuffle';
import { nextDifficulty } from '@shared/domain/adaptive';
import { useNotesAndBookmarks } from '../shared/hooks/use-notes-bookmarks';
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

export default function AdaptiveSimulation(): ReactElement {
  const { user } = useSession();
  const disciplineLov = useLov('DISCIPLINE');
  const examBoardLov = useLov('EXAM_BOARD');
  const difficultyLov = useLov('DIFFICULTY');
  const [status, setStatus] = useState<Status>('setup');
  const [selectedDiscipline, setSelectedDiscipline] = useState('');
  const [totalQuestions, setTotalQuestions] = useState(10);
  const [questions, setQuestions] = useState<AdaptiveQuestion[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [selectedAnswer, setSelectedAnswer] = useState('');
  const [adaptive, setAdaptive] = useState<AdaptiveState>(INITIAL_ADAPTIVE);
  const [questionPool, setQuestionPool] = useState<AdaptiveQuestion[]>([]);
  const [questionTime, setTimeSpent] = useState(0);
  const [timer, setTimer] = useState(0);
  const [loading, setLoading] = useState(false);
  const [lastCorrect, setLastCorrect] = useState<boolean | null>(null);
  const [answerLog, setAnswerLog] = useState<
    { questionId: string; userAnswer: string; correct: boolean; timeSpent: number }[]
  >([]);

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

  const fetchQuestion = useCallback(
    (difficulty: Difficulty): AdaptiveQuestion | null => {
      const answeredIds = questions.map((q) => q.id);
      const unseen = questionPool.filter((q) => !answeredIds.includes(q.id));
      const atDifficulty = unseen.filter((q) => q.difficulty === difficulty);
      const fromPool = atDifficulty.length > 0 ? atDifficulty : unseen;
      if (fromPool.length === 0) return null;
      return fromPool.at(Math.floor(Math.random() * fromPool.length)) ?? null;
    },
    [questionPool, questions]
  );

  const startSimulation = async () => {
    setLoading(true);
    try {
      const rows = await utils.questions.list.fetch({
        discipline: selectedDiscipline !== '' ? selectedDiscipline : undefined,
        limit: 100,
      });
      const mapped: AdaptiveQuestion[] = rows.map((r) => ({
        id: r.id,
        questionText: r.questionText,
        options: shuffle(r.options),
        correctAnswer: r.correctAnswer,
        difficulty: r.difficulty as Difficulty,
        discipline: r.discipline,
        examBoard: r.examBoard,
        explanation: r.explanation,
        aiExplanation: r.aiExplanation ?? null,
        legislationTitle: r.legislationTitle,
      }));
      setQuestionPool(mapped);
      const pool = mapped.filter((q) => q.difficulty === 'medium');
      const firstQuestion = (pool.length > 0 ? pool : mapped).at(0);
      if (firstQuestion !== undefined) {
        setQuestions([firstQuestion]);
        setAnswerLog([]);
        setAdaptive({ ...INITIAL_ADAPTIVE, difficultyHistory: ['medium'] });
        setCurrentIndex(0);
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

  const handleAnswer = () => {
    if (!user || currentIndex >= questions.length) return;
    const correct = selectedAnswer === currentQuestion.correctAnswer;
    setLastCorrect(correct);
    setAnswerLog((log) => [
      ...log,
      { questionId: currentQuestion.id, userAnswer: selectedAnswer, correct, timeSpent: questionTime },
    ]);
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

  const handleNext = () => {
    if (adaptive.totalAnswered >= totalQuestions) {
      finish(answerLog);
      return;
    }
    const nextDiff = nextDifficulty(
      adaptive.currentDifficulty, adaptive.consecutiveCorrect, adaptive.consecutiveWrong
    );
    const nextQuestion = fetchQuestion(nextDiff);
    if (nextQuestion !== null) {
      setAdaptive((prev) => ({
        ...prev,
        currentDifficulty: nextDiff,
        difficultyHistory: [...prev.difficultyHistory, nextDiff],
      }));
      setQuestions((prev) => [...prev, nextQuestion]);
      setCurrentIndex((prev) => prev + 1);
      setSelectedAnswer('');
      setTimeSpent(0);
      setLastCorrect(null);
      setStatus('playing');
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
        onSelect={setSelectedAnswer}
        onAnswer={handleAnswer}
      />
    );
  }

  if (status === 'feedback') {
    return (
      <AdaptiveFeedback
        adaptive={adaptive}
        totalQuestions={totalQuestions}
        lastCorrect={lastCorrect}
        currentQuestion={currentQuestion}
        difficultyLov={difficultyLov}
        onNext={handleNext}
      />
    );
  }

  return (
    <AdaptiveFinished
      adaptive={adaptive}
      timer={timer}
      onReset={() => {
        setStatus('setup');
        setQuestions([]);
        setAdaptive(INITIAL_ADAPTIVE);
      }}
    />
  );
}
