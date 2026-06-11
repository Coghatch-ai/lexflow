import { useState, useEffect, useRef, type ReactElement } from 'react';
import { useSession } from '../auth';
import { Clock, CheckCircle, XCircle, ChevronRight, BookOpen, ArrowRightToLine } from 'lucide-react';
import { useLov } from '../shared/hooks/use-lov';
import AdaptiveSimulation from '../components/AdaptiveSimulation';
import SpacedRepetition from '../components/SpacedRepetition';
import RealExamSimulation from '../components/RealExamSimulation';
import { trpc } from '../shared/lib/trpc';
import { shuffle } from '../shared/lib/shuffle';
import { moveToEnd } from '../shared/lib/exam-queue';
import { accuracyPct } from '@shared/domain/scoring';
import { useNotesAndBookmarks, type NotesAndBookmarks } from '../shared/hooks/use-notes-bookmarks';
import QuestionCard from '@/shared/components/QuestionCard';

type Mode = 'standard' | 'adaptive' | 'spaced' | 'real';
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

interface ModeSelectionProps {
  onSelect: (mode: Mode) => void;
}

function ModeSelection({ onSelect }: ModeSelectionProps): ReactElement {
  return (
    <div className="space-y-6">
      <div className="bg-gradient-to-r from-[#16161a] to-[#26262c] rounded-xl p-6 text-white">
        <h3 className="text-xl font-bold mb-2">Escolha o Modo de Estudo</h3>
        <p className="text-white/80">Selecione o tipo de simulado que melhor atende suas necessidades</p>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <button
          onClick={() => { onSelect('standard'); }}
          className="bg-white rounded-xl p-6 shadow hover:shadow-lg transition text-left border-2 border-transparent hover:border-[#16161a]"
        >
          <div className="bg-[#26262c] p-3 rounded-lg w-fit mb-4"><BookOpen className="w-6 h-6 text-white" /></div>
          <h4 className="text-lg font-bold text-[#16161a] mb-2">Simulado Padrao</h4>
          <p className="text-sm text-gray-600">10 questoes com filtros por disciplina, banca e dificuldade. Feedback imediato.</p>
        </button>

        <button
          onClick={() => { onSelect('adaptive'); }}
          className="bg-white rounded-xl p-6 shadow hover:shadow-lg transition text-left border-2 border-transparent hover:border-[#16161a]"
        >
          <div className="bg-[#16161a] p-3 rounded-lg w-fit mb-4"><span className="text-white text-xl font-bold">A</span></div>
          <h4 className="text-lg font-bold text-[#16161a] mb-2">Simulado Adaptativo</h4>
          <p className="text-sm text-gray-600">Dificuldade ajusta automaticamente conforme seu desempenho em tempo real.</p>
          <span className="inline-block mt-2 text-xs font-bold text-[#16161a] bg-[#16161a]/10 px-2 py-1 rounded">INTELIGENTE</span>
        </button>

        <button
          onClick={() => { onSelect('spaced'); }}
          className="bg-white rounded-xl p-6 shadow hover:shadow-lg transition text-left border-2 border-transparent hover:border-[#16161a]"
        >
          <div className="bg-[#26262c] p-3 rounded-lg w-fit mb-4"><span className="text-white text-xl font-bold">R</span></div>
          <h4 className="text-lg font-bold text-[#16161a] mb-2">Revisao Espacada</h4>
          <p className="text-sm text-gray-600">Revise questoes nos intervalos ideais para maximizar retencao a longo prazo.</p>
          <span className="inline-block mt-2 text-xs font-bold text-[#26262c] bg-[#26262c]/10 px-2 py-1 rounded">RETENCAO</span>
        </button>

        <button
          onClick={() => { onSelect('real'); }}
          className="bg-white rounded-xl p-6 shadow hover:shadow-lg transition text-left border-2 border-transparent hover:border-red-400"
        >
          <div className="bg-red-600 p-3 rounded-lg w-fit mb-4"><span className="text-white text-xl font-bold">P</span></div>
          <h4 className="text-lg font-bold text-[#16161a] mb-2">Simulado Prova Real</h4>
          <p className="text-sm text-gray-600">80 questoes, 5 horas, sem feedback. Simule as condicoes reais do exame.</p>
          <span className="inline-block mt-2 text-xs font-bold text-red-600 bg-red-50 px-2 py-1 rounded">INTENSO</span>
        </button>
      </div>
    </div>
  );
}

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
        <h3 className="text-xl font-bold mb-2">Simulado Padrao</h3>
        <p className="text-white/80">Configure os filtros e comece a resolver questoes reais de provas anteriores.</p>
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
        {loading ? 'Carregando...' : 'Comecar Simulado'}
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
  notesAndBookmarks: NotesAndBookmarks;
  disciplineLov: Lov;
  examBoardLov: Lov;
  onBack: () => void;
  onSelect: (answer: string) => void;
  onNext: () => void;
  canPostpone: boolean;
  onPostpone: () => void;
}

function InProgress({
  currentQuestion, currentIndex, totalAnswered, totalQuestions, timer, selectedAnswer,
  notesAndBookmarks, disciplineLov, examBoardLov, onBack, onSelect, onNext, canPostpone, onPostpone,
}: InProgressProps): ReactElement {
  const { localNotes, bookmarkedIds, handleNoteChange, handleToggleBookmark } = notesAndBookmarks;
  const progress = (totalAnswered / (totalQuestions > 0 ? totalQuestions : 1)) * 100;

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
            Questao {currentIndex + 1} de {totalQuestions}
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
        />

        <div className="flex gap-3">
          <button
            onClick={onPostpone}
            disabled={!canPostpone}
            title={canPostpone ? 'Mover esta questão para o fim do simulado' : 'Última questão pendente — responda para finalizar'}
            className="flex-1 bg-gray-200 text-gray-700 py-3 rounded-lg font-semibold hover:bg-gray-300 transition disabled:opacity-50 flex items-center justify-center gap-2"
          >
            <ArrowRightToLine className="w-5 h-5" />
            Responder depois
          </button>
          <button
            onClick={onNext}
            disabled={selectedAnswer.length === 0}
            className="flex-1 bg-gradient-to-r from-[#26262c] to-[#26262c] text-white py-3 rounded-lg font-semibold hover:shadow-lg transition disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {currentIndex + 1 === totalQuestions ? 'Finalizar' : 'Proxima'}
            <ChevronRight className="w-5 h-5" />
          </button>
        </div>
      </div>
    </div>
  );
}

interface CompletedProps {
  questions: TestQuestion[];
  answers: Answer[];
  disciplineLov: Lov;
  onSwitchMode: () => void;
  onRestart: () => void;
}

function Completed({ questions, answers, disciplineLov, onSwitchMode, onRestart }: CompletedProps): ReactElement {
  const correctCount = answers.filter((a) => a.correct).length;
  const accuracy = accuracyPct(correctCount, questions.length);

  return (
    <div className="space-y-6">
      <div className="bg-gradient-to-r from-[#16161a] to-[#16161a] rounded-xl p-6 text-white">
        <h3 className="text-2xl font-bold mb-2">Simulado Finalizado!</h3>
        <p className="text-white/80">Seus resultados foram salvos com sucesso.</p>
      </div>

      <div className="grid md:grid-cols-3 gap-4">
        <div className="bg-white rounded-xl p-6 shadow text-center">
          <div className="text-4xl font-bold text-[#16161a] mb-2">{accuracy}%</div>
          <p className="text-gray-600">Acuracia</p>
        </div>
        <div className="bg-white rounded-xl p-6 shadow text-center">
          <div className="text-4xl font-bold text-green-600 mb-2 flex items-center justify-center gap-2">
            <CheckCircle className="w-8 h-8" />{correctCount}
          </div>
          <p className="text-gray-600">Acertos de {questions.length}</p>
        </div>
        <div className="bg-white rounded-xl p-6 shadow text-center">
          <div className="text-4xl font-bold text-red-600 mb-2 flex items-center justify-center gap-2">
            <XCircle className="w-8 h-8" />{questions.length - correctCount}
          </div>
          <p className="text-gray-600">Erros</p>
        </div>
      </div>

      <div className="bg-white rounded-xl p-6 shadow">
        <h4 className="text-lg font-bold text-[#16161a] mb-4">Resumo das Questoes</h4>
        <div className="space-y-2 max-h-96 overflow-y-auto">
          {questions.map((q, idx) => {
            const answer = answers[idx];
            return (
              <div
                key={q.id}
                className={`p-3 rounded-lg border-l-4 ${
                  answer.correct ? 'bg-green-50 border-green-500' : 'bg-red-50 border-red-500'
                }`}
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <p className="font-medium text-gray-800">Questao {idx + 1}</p>
                    <p className="text-sm text-gray-600">{disciplineLov.labelOf(q.discipline)}</p>
                  </div>
                  {answer.correct ? (
                    <CheckCircle className="w-5 h-5 text-green-600 flex-shrink-0" />
                  ) : (
                    <XCircle className="w-5 h-5 text-red-600 flex-shrink-0" />
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="flex gap-3">
        <button
          onClick={onSwitchMode}
          className="flex-1 bg-gray-200 text-gray-700 py-3 rounded-lg font-semibold hover:bg-gray-300 transition"
        >
          Trocar Modo
        </button>
        <button
          onClick={onRestart}
          className="flex-1 bg-gradient-to-r from-[#26262c] to-[#26262c] text-white py-3 rounded-lg font-semibold hover:shadow-lg transition"
        >
          Refazer Simulado
        </button>
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
  const [answers, setAnswers] = useState<Answer[]>([]);
  const [loading, setLoading] = useState(false);
  const [timeSpent, setTimeSpent] = useState(0);
  const [timer, setTimer] = useState(0);

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

  if (mode === 'adaptive') return <AdaptiveSimulation />;
  if (mode === 'spaced') return <SpacedRepetition />;
  if (mode === 'real') return <RealExamSimulation />;

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
      setTimeSpent(0);
      setTimer(0);
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
      setTimeSpent(0);
    }
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
      <InProgress
        currentQuestion={currentQuestion}
        currentIndex={currentIndex}
        totalAnswered={answers.length}
        totalQuestions={questions.length}
        timer={timer}
        selectedAnswer={selectedAnswer}
        notesAndBookmarks={notesAndBookmarks}
        disciplineLov={disciplineLov}
        examBoardLov={examBoardLov}
        onBack={() => { setMode(null); setStatus('not-started'); }}
        onSelect={setSelectedAnswer}
        onNext={handleNext}
        canPostpone={currentIndex < questions.length - 1}
        onPostpone={handlePostpone}
      />
    );
  }

  return (
    <Completed
      questions={questions}
      answers={answers}
      disciplineLov={disciplineLov}
      onSwitchMode={() => { setStatus('not-started'); setMode(null); }}
      onRestart={() => { setStatus('not-started'); }}
    />
  );
}
