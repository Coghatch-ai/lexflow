import { useState, useEffect, useRef, type ReactElement } from 'react';
import { useSession } from '../auth';
import { Clock, ChevronRight, BookOpen, ArrowRightToLine } from 'lucide-react';
import { useLov } from '../shared/hooks/use-lov';
import AdaptiveSimulation from '../components/AdaptiveSimulation';
import SpacedRepetition from '../components/SpacedRepetition';
import RealExamSimulation from '../components/RealExamSimulation';
import { trpc } from '../shared/lib/trpc';
import { shuffle } from '../shared/lib/shuffle';
import { moveToEnd } from '../shared/lib/exam-queue';
import { useNotesAndBookmarks, type NotesAndBookmarks } from '../shared/hooks/use-notes-bookmarks';
import { useLeaveWarning } from '../shared/hooks/use-leave-warning';
import QuestionCard from '@/shared/components/QuestionCard';
import AiExplanationButton from '@/shared/components/AiExplanationButton';
import QuitTestDialog from '../components/QuitTestDialog';
import { exitPrompt, processableAnswers, shouldPromptOnExit } from '../shared/lib/exit-rules';
import TestCompleted from './testing-completed';
import { primaryLabel, primaryDisabled, canPostponeGuard } from './testing-flow-guards';
import { ModeSelection, type Mode } from './testing-mode-selection';
import {
  NO_ELIMINATIONS,
  clearForQuestion,
  eliminatedFor,
  toggleElimination,
  type EliminationState,
} from '../shared/lib/eliminations';

type QuestionStatus = 'not-started' | 'in-progress' | 'completed';

type TestQuestion = {
  id: string;
  questionText: string;
  options: string[];
  correctAnswer: string;
  difficulty: string;
  discipline: string;
  examBoard: string;
  explanation: string;
  legislationTitle: string | null;
};

interface Answer {
  questionId: string;
  userAnswer: string;
  correct: boolean;
  timeSpent: number;
}

type Lov = { options: { code: string; value: string }[]; labelOf: (code: string) => string };

interface NotStartedProps {
  discipline: string;
  examBoard: string;
  difficulty: string;
  loading: boolean;
  disciplineLov: Lov;
  examBoardLov: Lov;
  difficultyLov: Lov;
  onDisciplineChange: (val: string) => void;
  onExamBoardChange: (val: string) => void;
  onDifficultyChange: (val: string) => void;
  onBack: () => void;
  onStart: () => void;
}

function NotStarted({
  discipline, examBoard, difficulty, loading,
  disciplineLov, examBoardLov, difficultyLov,
  onDisciplineChange, onExamBoardChange, onDifficultyChange, onBack, onStart,
}: NotStartedProps): ReactElement {
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3 mb-2">
        <button onClick={onBack} className="text-sm text-[#16161a] hover:text-[#26262c] font-medium transition">
          Voltar aos modos
        </button>
      </div>

      <div className="bg-gradient-to-r from-[#16161a] to-[#26262c] rounded-xl p-6 text-white">
        <h3 className="text-xl font-bold mb-2">Simulado Padrão</h3>
        <p className="text-white/80">Configure os filtros e comece a resolver questões reais de provas anteriores.</p>
      </div>

      <div className="grid md:grid-cols-3 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Disciplina</label>
          <select value={discipline} onChange={(e) => { onDisciplineChange(e.target.value); }}
            className="w-full px-4 py-2 border-2 border-gray-200 rounded-lg focus:outline-none focus:border-[#16161a]"
          >
            <option value="">Todas</option>
            {disciplineLov.options.map((o) => <option key={o.code} value={o.code}>{o.value}</option>)}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Banca</label>
          <select value={examBoard} onChange={(e) => { onExamBoardChange(e.target.value); }}
            className="w-full px-4 py-2 border-2 border-gray-200 rounded-lg focus:outline-none focus:border-[#16161a]"
          >
            <option value="">Todas</option>
            {examBoardLov.options.map((o) => <option key={o.code} value={o.code}>{o.value}</option>)}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Dificuldade</label>
          <select value={difficulty} onChange={(e) => { onDifficultyChange(e.target.value); }}
            className="w-full px-4 py-2 border-2 border-gray-200 rounded-lg focus:outline-none focus:border-[#16161a]"
          >
            <option value="">Todas</option>
            {difficultyLov.options.map((o) => <option key={o.code} value={o.code}>{o.value}</option>)}
          </select>
        </div>
      </div>

      <button
        onClick={onStart}
        disabled={loading}
        className="w-full bg-gradient-to-r from-[#26262c] to-[#26262c] text-white py-3 rounded-lg font-semibold hover:shadow-lg transition disabled:opacity-50 flex items-center justify-center gap-2"
      >
        <BookOpen className="w-5 h-5" />
        {loading ? 'Carregando...' : 'Começar Simulado'}
      </button>
    </div>
  );
}

interface InProgressProps {
  currentQuestion: TestQuestion;
  currentIndex: number;
  totalAnswered: number;
  totalQuestions: number;
  timer: number;
  selectedAnswer: string;
  checked: boolean;
  onCheck: () => void;
  notesAndBookmarks: NotesAndBookmarks;
  disciplineLov: Lov;
  examBoardLov: Lov;
  onBack: () => void;
  onSelect: (answer: string) => void;
  onNext: () => void;
  canPostpone: boolean;
  onPostpone: () => void;
  eliminatedOptions: readonly string[];
  onToggleEliminate: (option: string) => void;
}

function InProgress({
  currentQuestion, currentIndex, totalAnswered, totalQuestions, timer, selectedAnswer,
  checked, onCheck,
  notesAndBookmarks, disciplineLov, examBoardLov, onBack, onSelect, onNext, canPostpone, onPostpone,
  eliminatedOptions, onToggleEliminate,
}: InProgressProps): ReactElement {
  const { localNotes, bookmarkedIds, handleNoteChange, handleToggleBookmark } = notesAndBookmarks;
  const progress = (totalAnswered / (totalQuestions > 0 ? totalQuestions : 1)) * 100;
  const isLast = currentIndex + 1 === totalQuestions;
  const btnLabel = primaryLabel({ checked, isLast });
  const btnDisabled = primaryDisabled({ checked, selected: selectedAnswer });

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3 mb-2">
        <button onClick={onBack} className="text-sm text-[#16161a] hover:text-[#26262c] font-medium transition">
          Voltar aos modos
        </button>
      </div>

      <div className="space-y-2">
        <div className="flex justify-between items-center">
          <span className="text-sm font-medium text-gray-700">
            Questão {currentIndex + 1} de {totalQuestions}
          </span>
          <div className="flex items-center gap-2 text-sm text-gray-600">
            <Clock className="w-4 h-4" />
            {Math.floor(timer / 60)}:{String(timer % 60).padStart(2, '0')}
          </div>
        </div>
        <div className="w-full bg-gray-200 rounded-full h-2">
          <div
            className="bg-gradient-to-r from-[#16161a] to-[#26262c] h-2 rounded-full transition-all"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      <div className="bg-white rounded-xl p-6 shadow">
        <QuestionCard
          disciplineLabel={disciplineLov.labelOf(currentQuestion.discipline)}
          examBoardLabel={examBoardLov.labelOf(currentQuestion.examBoard)}
          questionText={currentQuestion.questionText}
          options={currentQuestion.options}
          selectedAnswer={selectedAnswer}
          onSelect={onSelect}
          note={localNotes.get(currentQuestion.id) ?? ''}
          onNoteChange={(text) => { handleNoteChange(currentQuestion.id, text); }}
          isBookmarked={bookmarkedIds.has(currentQuestion.id)}
          onToggleBookmark={() => { handleToggleBookmark(currentQuestion.id); }}
          locked={checked}
          correctAnswer={currentQuestion.correctAnswer}
          eliminatedOptions={eliminatedOptions}
          onToggleEliminate={onToggleEliminate}
        />

        {checked && (<>
          <div className={`p-3 rounded-lg text-sm font-medium mb-2 ${selectedAnswer === currentQuestion.correctAnswer ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
            {selectedAnswer === currentQuestion.correctAnswer ? 'Correto!' : `Incorreto. Resposta certa: ${currentQuestion.correctAnswer}`}
          </div>
          <AiExplanationButton questionId={currentQuestion.id} explanation={currentQuestion.explanation} aiExplanation={null} />
        </>)}

        <div className="flex gap-3">
          {canPostpone && (
            <button
              onClick={onPostpone}
              title="Mover esta questão para o fim do simulado"
              className="flex-1 bg-gray-200 text-gray-700 py-3 rounded-lg font-semibold hover:bg-gray-300 transition flex items-center justify-center gap-2"
            >
              <ArrowRightToLine className="w-5 h-5" />
              Responder depois
            </button>
          )}
          <button
            onClick={checked ? onNext : onCheck}
            disabled={btnDisabled}
            className="flex-1 bg-gradient-to-r from-[#26262c] to-[#26262c] text-white py-3 rounded-lg font-semibold hover:shadow-lg transition disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {btnLabel}
            <ChevronRight className="w-5 h-5" />
          </button>
        </div>
      </div>
    </div>
  );
}

export default function TestingPage(): ReactElement {
  const { user } = useSession();
  const disciplineLov = useLov('DISCIPLINE');
  const examBoardLov = useLov('EXAM_BOARD');
  const difficultyLov = useLov('DIFFICULTY');
  const utils = trpc.useUtils();
  const recordMutation = trpc.sessions.record.useMutation({
    onSuccess: () => {
      void utils.stats.invalidate();
      void utils.sessions.invalidate();
    },
  });

  const notesAndBookmarks = useNotesAndBookmarks();

  const [mode, setMode] = useState<Mode | null>(null);
  const [status, setStatus] = useState<QuestionStatus>('not-started');
  const [questions, setQuestions] = useState<TestQuestion[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [selectedAnswer, setSelectedAnswer] = useState('');
  const [checked, setChecked] = useState(false);
  const [answers, setAnswers] = useState<Answer[]>([]);
  const [loading, setLoading] = useState(false);
  const [timeSpent, setTimeSpent] = useState(0);
  const [timer, setTimer] = useState(0);
  // Crossed-out alternatives (BR-02) — session-only, never recorded.
  const [eliminations, setEliminations] = useState<EliminationState>(NO_ELIMINATIONS);
  // "Sair e processar" confirmation (BR-05) — the run stays mounted behind it.
  const [exitOpen, setExitOpen] = useState(false);

  const [discipline, setDiscipline] = useState('');
  const [examBoard, setExamBoard] = useState('');
  const [difficulty, setDifficulty] = useState('');

  // Time already spent on questions postponed via "Responder depois",
  // keyed by question id, re-added when the question is finally answered.
  const carriedTimeRef = useRef<Map<string, number>>(new Map());

  useEffect(() => {
    if (status === 'in-progress' && currentIndex < questions.length) {
      const interval = setInterval(() => {
        setTimer((t) => t + 1);
        setTimeSpent((t) => t + 1);
      }, 1000);
      return () => { clearInterval(interval); };
    }
  }, [status, currentIndex, questions.length]);

  // A question already checked counts as answered: it is locked and joins the
  // payload on exit, exactly as "Próxima" would have recorded it.
  const answeredCount = answers.length + (checked ? 1 : 0);

  // Closing the tab or reloading with answers already given warns first (BR-05.1).
  useLeaveWarning(status === 'in-progress' && shouldPromptOnExit(answeredCount));

  if (mode === 'adaptive') return <AdaptiveSimulation onExit={() => { setMode(null); }} />;
  if (mode === 'spaced') return <SpacedRepetition onExit={() => { setMode(null); }} />;
  if (mode === 'real') return <RealExamSimulation onExit={() => { setMode(null); }} />;

  if (mode === null) {
    return <ModeSelection onSelect={setMode} />;
  }

  const loadQuestions = async () => {
    setLoading(true);
    try {
      const rows = await utils.questions.list.fetch({
        discipline: discipline !== '' ? discipline : undefined,
        examBoard: examBoard !== '' ? (examBoard as 'FGV' | 'CESPE') : undefined,
        difficulty: difficulty !== '' ? (difficulty as 'easy' | 'medium' | 'hard') : undefined,
        limit: 10,
      });
      const mapped: TestQuestion[] = rows.map((r) => ({
        id: r.id,
        questionText: r.questionText,
        options: shuffle(r.options),
        correctAnswer: r.correctAnswer,
        difficulty: r.difficulty,
        discipline: r.discipline,
        examBoard: r.examBoard,
        explanation: r.explanation,
        legislationTitle: r.legislationTitle,
      }));
      setQuestions(mapped);
      setStatus('in-progress');
      setCurrentIndex(0);
      setAnswers([]);
      setSelectedAnswer('');
      setChecked(false);
      setTimeSpent(0);
      setTimer(0);
      setEliminations(NO_ELIMINATIONS);
      carriedTimeRef.current = new Map();
    } finally {
      setLoading(false);
    }
  };

  const currentQuestion = questions[currentIndex];

  const handleNext = () => {
    if (!user || currentIndex >= questions.length) return;
    const correct = selectedAnswer === currentQuestion.correctAnswer;
    const totalTimeSpent = timeSpent + (carriedTimeRef.current.get(currentQuestion.id) ?? 0);
    const updated: Answer[] = [
      ...answers,
      { questionId: currentQuestion.id, userAnswer: selectedAnswer, correct, timeSpent: totalTimeSpent },
    ];
    setAnswers(updated);
    // The answer is recorded — its cross-outs have served their purpose.
    setEliminations((prev) => clearForQuestion(prev, currentQuestion.id));

    if (currentIndex + 1 >= questions.length) {
      setStatus('completed');
      recordMutation.mutate({
        discipline: discipline !== '' ? discipline : 'Geral',
        difficulty: difficulty !== '' ? (difficulty as 'easy' | 'medium' | 'hard') : 'medium',
        answers: updated,
      });
    } else {
      setCurrentIndex(currentIndex + 1);
      setSelectedAnswer('');
      setChecked(false);
      setTimeSpent(0);
    }
  };

  // Leaving a running test asks first (BR-05.4); with nothing answered there is
  // nothing to process, so the mode is left silently.
  const requestExit = () => {
    if (!shouldPromptOnExit(answeredCount)) {
      setMode(null);
      setStatus('not-started');
      return;
    }
    setExitOpen(true);
  };

  // "Sair e processar respostas": record what was answered through the normal
  // path and show the normal result screen. The current question only joins the
  // payload once it was checked (same Answer as handleNext builds); an
  // unanswered question is never recorded (BR-05.6 / BR-03).
  const handleQuitAndProcess = () => {
    setExitOpen(false);
    const carried = carriedTimeRef.current.get(currentQuestion.id) ?? 0;
    const finalAnswers: Answer[] = processableAnswers(
      checked
        ? [
          ...answers,
          {
            questionId: currentQuestion.id,
            userAnswer: selectedAnswer,
            correct: selectedAnswer === currentQuestion.correctAnswer,
            timeSpent: timeSpent + carried,
          },
        ]
        : answers,
    );
    if (finalAnswers.length === 0) {
      setMode(null);
      setStatus('not-started');
      return;
    }
    setAnswers(finalAnswers);
    setStatus('completed');
    recordMutation.mutate({
      discipline: discipline !== '' ? discipline : 'Geral',
      difficulty: difficulty !== '' ? (difficulty as 'easy' | 'medium' | 'hard') : 'medium',
      answers: finalAnswers,
    });
  };

  // Cross out / restore an alternative (BR-02). A crossed-out alternative can
  // no longer be the answer, so it drops the current selection.
  const handleToggleEliminate = (option: string) => {
    setEliminations((prev) => toggleElimination(prev, currentQuestion.id, option));
    if (selectedAnswer === option) setSelectedAnswer('');
  };

  // Moves the current question to the end of the queue without recording an
  // answer; currentIndex stays put so the next question slides into place.
  // Disabled on the last pending question — every question must be answered.
  const handlePostpone = () => {
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

  if (status === 'not-started') {
    return (
      <NotStarted
        discipline={discipline}
        examBoard={examBoard}
        difficulty={difficulty}
        loading={loading}
        disciplineLov={disciplineLov}
        examBoardLov={examBoardLov}
        difficultyLov={difficultyLov}
        onDisciplineChange={setDiscipline}
        onExamBoardChange={setExamBoard}
        onDifficultyChange={setDifficulty}
        onBack={() => { setMode(null); }}
        onStart={() => { void loadQuestions(); }}
      />
    );
  }

  if (status === 'in-progress') {
    return (
      <>
        <InProgress
          currentQuestion={currentQuestion}
          currentIndex={currentIndex}
          totalAnswered={answers.length}
          totalQuestions={questions.length}
          timer={timer}
          selectedAnswer={selectedAnswer}
          checked={checked}
          onCheck={() => { setChecked(true); }}
          notesAndBookmarks={notesAndBookmarks}
          disciplineLov={disciplineLov}
          examBoardLov={examBoardLov}
          onBack={requestExit}
          onSelect={setSelectedAnswer}
          onNext={handleNext}
          canPostpone={canPostponeGuard({ checked, hasMoreQuestions: currentIndex < questions.length - 1 })}
          onPostpone={handlePostpone}
          eliminatedOptions={eliminatedFor(eliminations, currentQuestion.id)}
          onToggleEliminate={handleToggleEliminate}
        />
        <QuitTestDialog
          open={exitOpen}
          prompt={exitPrompt('standard', answeredCount, questions.length)}
          onContinue={() => { setExitOpen(false); }}
          onQuit={handleQuitAndProcess}
        />
      </>
    );
  }

  return (
    <TestCompleted
      questions={questions}
      answers={answers}
      disciplineLov={disciplineLov}
      onSwitchMode={() => { setStatus('not-started'); setMode(null); }}
      onRestart={() => { setStatus('not-started'); }}
    />
  );
}
