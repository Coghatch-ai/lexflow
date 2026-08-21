import { useState, useEffect, useCallback, type ReactElement } from 'react';
import { AlertCircle, Flag } from 'lucide-react';
import { useLov } from '../shared/hooks/use-lov';
import { trpc } from '../shared/lib/trpc';
import { shuffle } from '../shared/lib/shuffle';
import { findNextUnanswered } from '../shared/lib/exam-queue';
import ExamPlaying from './real-exam-playing';
import ExamReview from './real-exam-review';
import QuitTestDialog from './QuitTestDialog';
import type { AiExplanation } from '@shared/domain/ai-eval';
import { useNotesAndBookmarks } from '../shared/hooks/use-notes-bookmarks';
import { useLeaveWarning } from '../shared/hooks/use-leave-warning';
import { useRegisterRun } from '../shared/run-guard-context';
import { type AnswerDraft, exitPrompt, processableAnswers, shouldPromptOnExit } from '../shared/lib/exit-rules';
import {
  NO_ELIMINATIONS,
  eliminatedFor,
  eliminationDropsAnswer,
  toggleElimination,
  type EliminationState,
} from '../shared/lib/eliminations';

type Status = 'setup' | 'playing' | 'review' | 'finished';

type ExamQuestion = {
  id: string;
  questionText: string;
  options: string[];
  correctAnswer: string;
  difficulty: string;
  discipline: string;
  examBoard: string;
  explanation: string;
  aiExplanation: AiExplanation | null;
  legislationTitle: string | null;
};

const EXAM_DURATION = 5 * 60 * 60;
const QUESTIONS_PER_EXAM = 80;

function formatTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

interface ExamSetupProps {
  loading: boolean;
  onStart: () => void;
}

function ExamSetup({ loading, onStart }: ExamSetupProps): ReactElement {
  return (
    <div className="bg-white rounded-xl p-6 shadow">
      <div className="flex items-center gap-3 mb-6">
        <div className="bg-[#16161a] p-3 rounded-lg">
          <Flag className="w-6 h-6 text-white" />
        </div>
        <div>
          <h3 className="text-xl font-bold text-[#16161a]">Simulado Estilo Prova Real</h3>
          <p className="text-sm text-gray-600">Simule as condições reais do exame</p>
        </div>
      </div>

      <div className="bg-[#16161a]/5 rounded-lg p-4 mb-6 space-y-2">
        <h4 className="font-semibold text-[#16161a]">Configuração do Simulado:</h4>
        <ul className="space-y-1 text-sm text-gray-700">
          <li>- {QUESTIONS_PER_EXAM} questões (como a prova real)</li>
          <li>- 5 horas de duração</li>
          <li>- Sem feedback durante o simulado</li>
          <li>- Pode sinalizar questões para revisar depois</li>
          <li>- Pode adiar questões para responder depois</li>
          <li>- Navegue livremente entre questões</li>
          <li>- É preciso responder todas as questões para encerrar manualmente</li>
          <li>- Timer regressivo como na prova real</li>
        </ul>
      </div>

      <div className="bg-red-50 border-2 border-red-200 rounded-lg p-4 mb-6">
        <div className="flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold text-red-700">Atenção!</p>
            <p className="text-sm text-red-600">
              Este simulado simula condições reais de prova. Não haverá feedback
              durante o exame. Certifique-se de ter tempo disponível.
            </p>
          </div>
        </div>
      </div>

      <button
        onClick={onStart}
        disabled={loading}
        className="w-full bg-gradient-to-r from-[#26262c] to-[#26262c] text-white py-3 rounded-lg font-semibold hover:shadow-lg transition disabled:opacity-50 flex items-center justify-center gap-2"
      >
        <Flag className="w-5 h-5" />
        {loading ? 'Carregando...' : 'Iniciar Simulado Real'}
      </button>
    </div>
  );
}

export default function RealExamSimulation({ onExit }: { onExit: () => void }): ReactElement {
  const disciplineLov = useLov('DISCIPLINE');
  const examBoardLov = useLov('EXAM_BOARD');
  const [status, setStatus] = useState<Status>('setup');
  const [questions, setQuestions] = useState<ExamQuestion[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [answers, setAnswers] = useState<Map<number, string>>(new Map());
  const [flagged, setFlagged] = useState<Set<number>>(new Set());
  const [postponed, setPostponed] = useState<Set<number>>(new Set());
  const [timeLeft, setTimeLeft] = useState(EXAM_DURATION);
  const [loading, setLoading] = useState(false);
  const [showConfirmSubmit, setShowConfirmSubmit] = useState(false);
  // Crossed-out alternatives (BR-02) — session-only, never recorded. In the real
  // exam they live for the WHOLE run: the student navigates back and forth and
  // may change an answer until the exam ends, so a cross-out is only dropped
  // when the exam leaves 'playing' (startExam / onReset), never per question.
  const [eliminations, setEliminations] = useState<EliminationState>(NO_ELIMINATIONS);
  // "Encerrar e processar" confirmation (BR-05.5) — the exam stays mounted behind it.
  const [exitOpen, setExitOpen] = useState(false);

  const utils = trpc.useUtils();
  const recordMutation = trpc.sessions.record.useMutation({
    onSuccess: () => {
      void utils.stats.invalidate();
      void utils.sessions.invalidate();
    },
  });

  const notesAndBookmarks = useNotesAndBookmarks();

  const handleSubmit = useCallback(() => {
    setStatus('review');
  }, []);

  useEffect(() => {
    if (status !== 'playing') return;
    const interval = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          clearInterval(interval);
          handleSubmit();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => { clearInterval(interval); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  const startExam = async () => {
    setLoading(true);
    try {
      const rows = await utils.questions.list.fetch({ limit: QUESTIONS_PER_EXAM, phase: '1st' });
      const mapped: ExamQuestion[] = rows.map((r) => ({
        id: r.id,
        questionText: r.questionText,
        options: shuffle(r.options),
        correctAnswer: r.correctAnswer,
        difficulty: r.difficulty,
        discipline: r.discipline,
        examBoard: r.examBoard,
        explanation: r.explanation,
        aiExplanation: r.aiExplanation ?? null,
        legislationTitle: r.legislationTitle,
      }));
      setQuestions(mapped);
      setAnswers(new Map());
      setFlagged(new Set());
      setPostponed(new Set());
      setEliminations(NO_ELIMINATIONS);
      setCurrentIndex(0);
      setTimeLeft(EXAM_DURATION);
      setStatus('playing');
    } finally {
      setLoading(false);
    }
  };

  // Every draft, answered or not — the review screen lists all 80 questions.
  const drafts: AnswerDraft[] = questions.map((q, idx) => ({
    questionId: q.id,
    userAnswer: answers.get(idx) ?? '',
    correct: answers.get(idx) === q.correctAnswer,
    timeSpent: 0,
  }));

  // The single recording path of the exam: the normal "Encerrar", the 5h timer
  // and "Sair da prova" all just move the status to 'review'. Only ANSWERED
  // questions are recorded — a blank is never an error (BR-05.6 / BR-03).
  useEffect(() => {
    if (status !== 'review') return;
    const log = processableAnswers(
      questions.map((q, idx) => ({
        questionId: q.id,
        userAnswer: answers.get(idx) ?? '',
        correct: answers.get(idx) === q.correctAnswer,
        timeSpent: 0,
      })),
    );
    if (log.length > 0) {
      recordMutation.mutate({ discipline: 'Prova Real', difficulty: 'hard', answers: log });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  // Closing the tab or reloading during the exam warns first (BR-05.1).
  useLeaveWarning(status === 'playing' && shouldPromptOnExit(answers.size));
  // Leaving through the sidebar asks the same question, with the prova real
  // warning (BR-05.5), and processes through the same 'review' path (slice S1b).
  useRegisterRun(
    { mode: 'real', running: status === 'playing', answeredCount: answers.size, totalQuestions: questions.length },
    () => { handleQuitAndProcess(); },
  );

  // Leaving the exam asks first and warns it cannot be saved (BR-05.5); with
  // nothing answered there is nothing to process, so it exits silently.
  const requestExit = () => {
    if (!shouldPromptOnExit(answers.size)) {
      onExit();
      return;
    }
    setExitOpen(true);
  };

  // "Encerrar e processar respostas": only moves to 'review'. The effect above
  // is what records, so the exam still makes exactly ONE sessions.record call.
  const handleQuitAndProcess = () => {
    setExitOpen(false);
    setStatus('review');
  };

  const selectAnswer = (option: string) => {
    const newAnswers = new Map(answers);
    newAnswers.set(currentIndex, option);
    setAnswers(newAnswers);
    // Answering clears the postpone mark — the set only holds unanswered indexes.
    setPostponed((prev) => {
      if (!prev.has(currentIndex)) return prev;
      const next = new Set(prev);
      next.delete(currentIndex);
      return next;
    });
  };

  // Cross out / restore an alternative (BR-02). Crossing out the alternative
  // currently chosen drops that answer (BR-02.2) — the question goes back to
  // unanswered, so it counts out of `x/80` again. It is NOT re-marked as
  // "Adiada" and its flag is untouched.
  const handleToggleEliminate = (option: string) => {
    const question = questions.at(currentIndex);
    if (question === undefined) return;
    setEliminations((prev) => toggleElimination(prev, question.id, option));
    if (eliminationDropsAnswer(answers.get(currentIndex) ?? '', option)) {
      setAnswers((prev) => {
        const next = new Map(prev);
        next.delete(currentIndex);
        return next;
      });
    }
  };

  const postponeCurrent = () => {
    const next = findNextUnanswered(questions.length, currentIndex, answers);
    if (next === null) return;
    setPostponed((prev) => new Set(prev).add(currentIndex));
    setCurrentIndex(next);
  };

  const goToFirstUnanswered = () => {
    setShowConfirmSubmit(false);
    const first = questions.findIndex((_, idx) => !answers.has(idx));
    if (first >= 0) setCurrentIndex(first);
  };

  const toggleFlag = () => {
    const newFlagged = new Set(flagged);
    if (newFlagged.has(currentIndex)) {
      newFlagged.delete(currentIndex);
    } else {
      newFlagged.add(currentIndex);
    }
    setFlagged(newFlagged);
  };

  if (status === 'setup') {
    return <ExamSetup loading={loading} onStart={() => { void startExam(); }} />;
  }

  if (status === 'playing') {
    return (
      <>
        <ExamPlaying
          questions={questions}
          currentIndex={currentIndex}
          answers={answers}
          flagged={flagged}
          postponed={postponed}
          timeLeft={timeLeft}
          examDuration={EXAM_DURATION}
          showConfirmSubmit={showConfirmSubmit}
          notesAndBookmarks={notesAndBookmarks}
          disciplineLov={disciplineLov}
          examBoardLov={examBoardLov}
          canPostpone={!answers.has(currentIndex) && findNextUnanswered(questions.length, currentIndex, answers) !== null}
          eliminatedOptions={eliminatedFor(eliminations, questions.at(currentIndex)?.id ?? '')}
          formatTime={formatTime}
          onSelectAnswer={selectAnswer}
          onToggleEliminate={handleToggleEliminate}
          onSetIndex={setCurrentIndex}
          onToggleFlag={toggleFlag}
          onPostpone={postponeCurrent}
          onGoToUnanswered={goToFirstUnanswered}
          onShowConfirmSubmit={() => { setShowConfirmSubmit(true); }}
          onHideConfirmSubmit={() => { setShowConfirmSubmit(false); }}
          onSubmit={handleSubmit}
          onRequestExit={requestExit}
        />
        <QuitTestDialog
          open={exitOpen}
          prompt={exitPrompt('real', answers.size, questions.length)}
          onContinue={() => { setExitOpen(false); }}
          onQuit={handleQuitAndProcess}
        />
      </>
    );
  }

  if (status === 'review') {
    return (
      <ExamReview
        questions={questions}
        answers={answers}
        drafts={drafts}
        timeUsedLabel={formatTime(EXAM_DURATION - timeLeft)}
        disciplineLov={disciplineLov}
        onReset={() => {
          setStatus('setup');
          setQuestions([]);
          setAnswers(new Map());
          setFlagged(new Set());
          setPostponed(new Set());
          setEliminations(NO_ELIMINATIONS);
        }}
      />
    );
  }

  return <div />;
}
