import { useState, useEffect, useCallback, type ReactElement } from 'react';
import { Clock, AlertCircle, Flag, ArrowRightToLine } from 'lucide-react';
import { useLov } from '../shared/hooks/use-lov';
import { trpc } from '../shared/lib/trpc';
import { shuffle } from '../shared/lib/shuffle';
import { findNextUnanswered } from '../shared/lib/exam-queue';
import ExamQuestionNav from './ExamQuestionNav';
import ExamFinishDialog from './ExamFinishDialog';
import ExamReview from './real-exam-review';
import QuitTestDialog from './QuitTestDialog';
import type { AiExplanation } from '@shared/domain/ai-eval';
import { useNotesAndBookmarks, type NotesAndBookmarks } from '../shared/hooks/use-notes-bookmarks';
import { useLeaveWarning } from '../shared/hooks/use-leave-warning';
import QuestionCard from '@/shared/components/QuestionCard';
import { type AnswerDraft, exitPrompt, processableAnswers, shouldPromptOnExit } from '../shared/lib/exit-rules';

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

type Lov = { labelOf: (code: string) => string };

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

interface ExamPlayingProps {
  questions: ExamQuestion[];
  currentIndex: number;
  answers: Map<number, string>;
  flagged: Set<number>;
  postponed: Set<number>;
  timeLeft: number;
  showConfirmSubmit: boolean;
  notesAndBookmarks: NotesAndBookmarks;
  disciplineLov: Lov;
  examBoardLov: Lov;
  canPostpone: boolean;
  onSelectAnswer: (option: string) => void;
  onSetIndex: (idx: number) => void;
  onToggleFlag: () => void;
  onPostpone: () => void;
  onGoToUnanswered: () => void;
  onShowConfirmSubmit: () => void;
  onHideConfirmSubmit: () => void;
  onSubmit: () => void;
  onRequestExit: () => void;
}

function ExamPlaying({
  questions, currentIndex, answers, flagged, postponed, timeLeft, showConfirmSubmit,
  notesAndBookmarks, disciplineLov, examBoardLov, canPostpone,
  onSelectAnswer, onSetIndex, onToggleFlag, onPostpone, onGoToUnanswered,
  onShowConfirmSubmit, onHideConfirmSubmit, onSubmit, onRequestExit,
}: ExamPlayingProps): ReactElement {
  const { localNotes, bookmarkedIds, handleNoteChange, handleToggleBookmark } = notesAndBookmarks;
  const currentQuestion = questions[currentIndex];
  const answeredCount = answers.size;
  const flaggedCount = flagged.size;
  const timePercentage = (timeLeft / EXAM_DURATION) * 100;
  const isUrgent = timeLeft < 1800;

  return (
    <div className="space-y-4">
      <div className={`rounded-xl p-4 shadow ${isUrgent ? 'bg-red-50 border-2 border-red-300' : 'bg-white'}`}>
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <Clock className={`w-5 h-5 ${isUrgent ? 'text-red-600 animate-pulse' : 'text-[#16161a]'}`} />
            <span className={`text-lg font-bold ${isUrgent ? 'text-red-600' : 'text-[#16161a]'}`}>
              {formatTime(timeLeft)}
            </span>
          </div>
          <div className="flex items-center gap-4 text-sm text-gray-600">
            <span>{answeredCount}/{questions.length} respondidas</span>
            {flaggedCount > 0 && (
              <span className="text-[#16161a] font-medium">{flaggedCount} sinalizadas</span>
            )}
          </div>
        </div>
        <div className="w-full bg-gray-200 rounded-full h-2">
          <div
            className={`h-2 rounded-full transition-all ${isUrgent ? 'bg-red-500' : 'bg-[#16161a]'}`}
            style={{ width: `${timePercentage}%` }}
          />
        </div>
      </div>

      <div className="bg-white rounded-xl p-4 shadow">
        <div className="flex items-center justify-between mb-3">
          <span className="font-bold text-[#16161a] flex items-center gap-2">
            Questão {currentIndex + 1}
            {postponed.has(currentIndex) && (
              <span className="text-xs font-semibold text-amber-700 bg-amber-100 px-2 py-0.5 rounded-full">
                Adiada
              </span>
            )}
          </span>
          <div className="flex gap-2">
            <button
              onClick={onToggleFlag}
              className={`p-2 rounded-lg transition ${flagged.has(currentIndex) ? 'bg-[#16161a] text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
              title="Sinalizar para revisão"
            >
              <Flag className="w-4 h-4" />
            </button>
            <button
              onClick={onPostpone}
              disabled={!canPostpone}
              className="px-3 py-2 bg-amber-100 text-amber-700 rounded-lg text-sm font-semibold hover:bg-amber-200 transition disabled:opacity-50 flex items-center gap-1.5"
              title={canPostpone ? 'Adiar e ir para a próxima não respondida' : 'Disponível apenas em questões ainda não respondidas'}
            >
              <ArrowRightToLine className="w-4 h-4" />
              Responder depois
            </button>
            <button
              onClick={onRequestExit}
              className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm font-semibold hover:bg-gray-200 transition"
              title="Sair da prova e processar as respostas já dadas"
            >
              Sair da prova
            </button>
            <button
              onClick={onShowConfirmSubmit}
              className="px-4 py-2 bg-[#16161a] text-white rounded-lg text-sm font-semibold hover:bg-[#26262c] transition"
            >
              Encerrar
            </button>
          </div>
        </div>

        <QuestionCard
          disciplineLabel={disciplineLov.labelOf(currentQuestion.discipline)}
          examBoardLabel={examBoardLov.labelOf(currentQuestion.examBoard)}
          questionText={currentQuestion.questionText}
          options={currentQuestion.options}
          selectedAnswer={answers.get(currentIndex) ?? ''}
          onSelect={onSelectAnswer}
          note={localNotes.get(currentQuestion.id) ?? ''}
          onNoteChange={(text) => { handleNoteChange(currentQuestion.id, text); }}
          isBookmarked={bookmarkedIds.has(currentQuestion.id)}
          onToggleBookmark={() => { handleToggleBookmark(currentQuestion.id); }}
        />

        <div className="flex items-center justify-between">
          <button
            onClick={() => { onSetIndex(Math.max(0, currentIndex - 1)); }}
            disabled={currentIndex === 0}
            className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg font-medium hover:bg-gray-300 transition disabled:opacity-50"
          >
            Anterior
          </button>
          <span className="text-sm text-gray-500">{currentIndex + 1} de {questions.length}</span>
          <button
            onClick={() => { onSetIndex(Math.min(questions.length - 1, currentIndex + 1)); }}
            disabled={currentIndex === questions.length - 1}
            className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg font-medium hover:bg-gray-300 transition disabled:opacity-50"
          >
            Próxima
          </button>
        </div>
      </div>

      <ExamQuestionNav
        total={questions.length}
        currentIndex={currentIndex}
        answered={new Set(answers.keys())}
        flagged={flagged}
        postponed={postponed}
        onSelect={onSetIndex}
      />

      <ExamFinishDialog
        open={showConfirmSubmit}
        answeredCount={answeredCount}
        total={questions.length}
        onClose={onHideConfirmSubmit}
        onConfirm={() => { onHideConfirmSubmit(); onSubmit(); }}
        onGoToUnanswered={onGoToUnanswered}
      />
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
          showConfirmSubmit={showConfirmSubmit}
          notesAndBookmarks={notesAndBookmarks}
          disciplineLov={disciplineLov}
          examBoardLov={examBoardLov}
          canPostpone={!answers.has(currentIndex) && findNextUnanswered(questions.length, currentIndex, answers) !== null}
          onSelectAnswer={selectAnswer}
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
        }}
      />
    );
  }

  return <div />;
}
