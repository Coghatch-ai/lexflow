import { useState, useEffect } from 'react';
import { useSession } from '../auth';
import { Clock, CheckCircle, XCircle, ChevronRight, BookOpen } from 'lucide-react';
import { DISCIPLINES, EXAM_BOARDS, DIFFICULTIES } from '../types';
import AdaptiveSimulation from '../components/AdaptiveSimulation';
import SpacedRepetition from '../components/SpacedRepetition';
import RealExamSimulation from '../components/RealExamSimulation';
import { mockQuestions } from '../lib/mockData';

type Mode = 'standard' | 'adaptive' | 'spaced' | 'real';
type QuestionStatus = 'not-started' | 'in-progress' | 'completed';

interface Question {
  id: string;
  question_text: string;
  options: string[];
  correct_answer: string;
  difficulty: string;
  discipline: string;
  exam_board: string;
  explanation: string;
  legislation_title: string;
  legislation_link: string;
}

interface Answer {
  questionId: string;
  userAnswer: string;
  correct: boolean;
  timeSpent: number;
}

export default function TestingPage() {
  const { user } = useSession();
  const [mode, setMode] = useState<Mode | null>(null);
  const [status, setStatus] = useState<QuestionStatus>('not-started');
  const [questions, setQuestions] = useState<Question[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [selectedAnswer, setSelectedAnswer] = useState('');
  const [answers, setAnswers] = useState<Answer[]>([]);
  const [loading, setLoading] = useState(false);
  const [timeSpent, setTimeSpent] = useState(0);
  const [timer, setTimer] = useState(0);

  // Filters
  const [discipline, setDiscipline] = useState('');
  const [examBoard, setExamBoard] = useState('');
  const [difficulty, setDifficulty] = useState('');

  // Timer
  useEffect(() => {
    if (status === 'in-progress' && currentIndex < questions.length) {
      const interval = setInterval(() => {
        setTimer((t) => t + 1);
        setTimeSpent((t) => t + 1);
      }, 1000);
      return () => clearInterval(interval);
    }
  }, [status, currentIndex, questions.length]);

  // If a special mode is selected, render that component
  if (mode === 'adaptive') return <AdaptiveSimulation />;
  if (mode === 'spaced') return <SpacedRepetition />;
  if (mode === 'real') return <RealExamSimulation />;

  // Mode selection
  if (!mode) {
    return (
      <div className="space-y-6">
        <div className="bg-gradient-to-r from-[#0f172a] to-[#1e3a5f] rounded-xl p-6 text-white">
          <h3 className="text-xl font-bold mb-2">Escolha o Modo de Estudo</h3>
          <p className="text-white/80">
            Selecione o tipo de simulado que melhor atende suas necessidades
          </p>
        </div>

        <div className="grid md:grid-cols-2 gap-4">
          {/* Standard */}
          <button
            onClick={() => setMode('standard')}
            className="bg-white rounded-xl p-6 shadow hover:shadow-lg transition text-left border-2 border-transparent hover:border-[#0ea5e9]"
          >
            <div className="bg-[#1e3a5f] p-3 rounded-lg w-fit mb-4">
              <BookOpen className="w-6 h-6 text-white" />
            </div>
            <h4 className="text-lg font-bold text-[#0f172a] mb-2">Simulado Padrao</h4>
            <p className="text-sm text-gray-600">
              10 questoes com filtros por disciplina, banca e dificuldade. Feedback imediato.
            </p>
          </button>

          {/* Adaptive */}
          <button
            onClick={() => setMode('adaptive')}
            className="bg-white rounded-xl p-6 shadow hover:shadow-lg transition text-left border-2 border-transparent hover:border-[#0ea5e9]"
          >
            <div className="bg-[#0ea5e9] p-3 rounded-lg w-fit mb-4">
              <span className="text-white text-xl font-bold">A</span>
            </div>
            <h4 className="text-lg font-bold text-[#0f172a] mb-2">Simulado Adaptativo</h4>
            <p className="text-sm text-gray-600">
              Dificuldade ajusta automaticamente conforme seu desempenho em tempo real.
            </p>
            <span className="inline-block mt-2 text-xs font-bold text-[#0ea5e9] bg-[#0ea5e9]/10 px-2 py-1 rounded">INTELIGENTE</span>
          </button>

          {/* Spaced Repetition */}
          <button
            onClick={() => setMode('spaced')}
            className="bg-white rounded-xl p-6 shadow hover:shadow-lg transition text-left border-2 border-transparent hover:border-[#0ea5e9]"
          >
            <div className="bg-[#1e3a5f] p-3 rounded-lg w-fit mb-4">
              <span className="text-white text-xl font-bold">R</span>
            </div>
            <h4 className="text-lg font-bold text-[#0f172a] mb-2">Revisao Espacada</h4>
            <p className="text-sm text-gray-600">
              Revise questoes nos intervalos ideais para maximizar retencao a longo prazo.
            </p>
            <span className="inline-block mt-2 text-xs font-bold text-[#1e3a5f] bg-[#1e3a5f]/10 px-2 py-1 rounded">RETENCAO</span>
          </button>

          {/* Real Exam */}
          <button
            onClick={() => setMode('real')}
            className="bg-white rounded-xl p-6 shadow hover:shadow-lg transition text-left border-2 border-transparent hover:border-red-400"
          >
            <div className="bg-red-600 p-3 rounded-lg w-fit mb-4">
              <span className="text-white text-xl font-bold">P</span>
            </div>
            <h4 className="text-lg font-bold text-[#0f172a] mb-2">Simulado Prova Real</h4>
            <p className="text-sm text-gray-600">
              80 questoes, 5 horas, sem feedback. Simule as condicoes reais do exame.
            </p>
            <span className="inline-block mt-2 text-xs font-bold text-red-600 bg-red-50 px-2 py-1 rounded">INTENSO</span>
          </button>
        </div>
      </div>
    );
  }

  // Load questions from mock data
  const loadQuestions = () => {
    setLoading(true);
    try {
      let filtered = [...mockQuestions];

      if (discipline) filtered = filtered.filter(q => q.discipline === discipline);
      if (examBoard) filtered = filtered.filter(q => q.exam_board === examBoard);
      if (difficulty) filtered = filtered.filter(q => q.difficulty === difficulty);

      // Shuffle and take 10
      const shuffled = filtered.sort(() => Math.random() - 0.5).slice(0, 10);

      setQuestions(shuffled);
      setStatus('in-progress');
      setCurrentIndex(0);
      setAnswers([]);
      setSelectedAnswer('');
      setTimeSpent(0);
      setTimer(0);
    } finally {
      setLoading(false);
    }
  };

  const currentQuestion = questions[currentIndex];
  const progress = ((currentIndex + answers.length) / (questions.length || 1)) * 100;

  const handleNext = () => {
    if (!currentQuestion || !user) return;

    const correct = selectedAnswer === currentQuestion.correct_answer;
    setAnswers([
      ...answers,
      {
        questionId: currentQuestion.id,
        userAnswer: selectedAnswer,
        correct,
        timeSpent,
      },
    ]);

    if (currentIndex + 1 >= questions.length) {
      setStatus('completed');
    } else {
      setCurrentIndex(currentIndex + 1);
      setSelectedAnswer('');
      setTimeSpent(0);
    }
  };

  const correctCount = answers.filter((a) => a.correct).length;
  const accuracy = questions.length > 0 ? (correctCount / questions.length) * 100 : 0;

  // Not started state
  if (status === 'not-started') {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-3 mb-2">
          <button
            onClick={() => setMode(null)}
            className="text-sm text-[#0ea5e9] hover:text-[#1e3a5f] font-medium transition"
          >
            Voltar aos modos
          </button>
        </div>

        <div className="bg-gradient-to-r from-[#0f172a] to-[#1e3a5f] rounded-xl p-6 text-white">
          <h3 className="text-xl font-bold mb-2">Simulado Padrao</h3>
          <p className="text-white/80">
            Configure os filtros e comece a resolver questoes reais de provas anteriores.
          </p>
        </div>

        <div className="grid md:grid-cols-3 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Disciplina</label>
            <select
              value={discipline}
              onChange={(e) => setDiscipline(e.target.value)}
              className="w-full px-4 py-2 border-2 border-gray-200 rounded-lg focus:outline-none focus:border-[#0ea5e9]"
            >
              <option value="">Todas</option>
              {DISCIPLINES.map((d) => (
                <option key={d} value={d}>{d}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Banca</label>
            <select
              value={examBoard}
              onChange={(e) => setExamBoard(e.target.value)}
              className="w-full px-4 py-2 border-2 border-gray-200 rounded-lg focus:outline-none focus:border-[#0ea5e9]"
            >
              <option value="">Todas</option>
              {EXAM_BOARDS.map((b) => (
                <option key={b} value={b}>{b}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Dificuldade</label>
            <select
              value={difficulty}
              onChange={(e) => setDifficulty(e.target.value)}
              className="w-full px-4 py-2 border-2 border-gray-200 rounded-lg focus:outline-none focus:border-[#0ea5e9]"
            >
              <option value="">Todas</option>
              {DIFFICULTIES.map((d) => (
                <option key={d} value={d}>
                  {d === 'easy' ? 'Facil' : d === 'medium' ? 'Medio' : 'Dificil'}
                </option>
              ))}
            </select>
          </div>
        </div>

        <button
          onClick={loadQuestions}
          disabled={loading}
          className="w-full bg-gradient-to-r from-[#1e3a5f] to-[#0c4a6e] text-white py-3 rounded-lg font-semibold hover:shadow-lg transition disabled:opacity-50 flex items-center justify-center gap-2"
        >
          <BookOpen className="w-5 h-5" />
          {loading ? 'Carregando...' : 'Comecar Simulado'}
        </button>
      </div>
    );
  }

  // In progress state
  if (status === 'in-progress' && currentQuestion) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-3 mb-2">
          <button
            onClick={() => {
              setMode(null);
              setStatus('not-started');
            }}
            className="text-sm text-[#0ea5e9] hover:text-[#1e3a5f] font-medium transition"
          >
            Voltar aos modos
          </button>
        </div>

        <div className="space-y-2">
          <div className="flex justify-between items-center">
            <span className="text-sm font-medium text-gray-700">
              Questao {currentIndex + 1} de {questions.length}
            </span>
            <div className="flex items-center gap-2 text-sm text-gray-600">
              <Clock className="w-4 h-4" />
              {Math.floor(timer / 60)}:{String(timer % 60).padStart(2, '0')}
            </div>
          </div>
          <div className="w-full bg-gray-200 rounded-full h-2">
            <div
              className="bg-gradient-to-r from-[#0ea5e9] to-[#1e3a5f] h-2 rounded-full transition-all"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>

        <div className="bg-white rounded-xl p-6 shadow">
          <div className="mb-6">
            <p className="text-sm text-gray-600 mb-2">
              <span className="font-medium">{currentQuestion.discipline}</span> -{' '}
              <span className="font-medium">{currentQuestion.exam_board}</span>
            </p>
            <h3 className="text-lg font-semibold text-[#0f172a]">
              {currentQuestion.question_text}
            </h3>
          </div>

          <div className="space-y-3 mb-6">
            {currentQuestion.options.map((option, idx) => (
              <button
                key={idx}
                onClick={() => setSelectedAnswer(option)}
                className={`w-full text-left p-4 border-2 rounded-lg transition ${
                  selectedAnswer === option
                    ? 'border-[#0ea5e9] bg-[#0ea5e9]/5'
                    : 'border-gray-200 hover:border-[#0ea5e9]/50'
                }`}
              >
                <div className="flex items-start gap-3">
                  <div
                    className={`w-6 h-6 rounded-full border-2 flex items-center justify-center flex-shrink-0 mt-0.5 ${
                      selectedAnswer === option
                        ? 'border-[#0ea5e9] bg-[#0ea5e9]'
                        : 'border-gray-300'
                    }`}
                  >
                    {selectedAnswer === option && (
                      <div className="w-2 h-2 bg-white rounded-full" />
                    )}
                  </div>
                  <span className="text-gray-800">{option}</span>
                </div>
              </button>
            ))}
          </div>

          <button
            onClick={handleNext}
            disabled={!selectedAnswer}
            className="w-full bg-gradient-to-r from-[#1e3a5f] to-[#0c4a6e] text-white py-3 rounded-lg font-semibold hover:shadow-lg transition disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {currentIndex + 1 === questions.length ? 'Finalizar' : 'Proxima'}
            <ChevronRight className="w-5 h-5" />
          </button>
        </div>
      </div>
    );
  }

  // Completed state
  return (
    <div className="space-y-6">
      <div className="bg-gradient-to-r from-[#0ea5e9] to-[#0f172a] rounded-xl p-6 text-white">
        <h3 className="text-2xl font-bold mb-2">Simulado Finalizado!</h3>
        <p className="text-white/80">Seus resultados foram salvos com sucesso.</p>
      </div>

      <div className="grid md:grid-cols-3 gap-4">
        <div className="bg-white rounded-xl p-6 shadow text-center">
          <div className="text-4xl font-bold text-[#0f172a] mb-2">{Math.round(accuracy)}%</div>
          <p className="text-gray-600">Acuracia</p>
        </div>
        <div className="bg-white rounded-xl p-6 shadow text-center">
          <div className="text-4xl font-bold text-green-600 mb-2 flex items-center justify-center gap-2">
            <CheckCircle className="w-8 h-8" />
            {correctCount}
          </div>
          <p className="text-gray-600">Acertos de {questions.length}</p>
        </div>
        <div className="bg-white rounded-xl p-6 shadow text-center">
          <div className="text-4xl font-bold text-red-600 mb-2 flex items-center justify-center gap-2">
            <XCircle className="w-8 h-8" />
            {questions.length - correctCount}
          </div>
          <p className="text-gray-600">Erros</p>
        </div>
      </div>

      <div className="bg-white rounded-xl p-6 shadow">
        <h4 className="text-lg font-bold text-[#0f172a] mb-4">Resumo das Questoes</h4>
        <div className="space-y-2 max-h-96 overflow-y-auto">
          {questions.map((q, idx) => {
            const answer = answers[idx];
            return (
              <div
                key={q.id}
                className={`p-3 rounded-lg border-l-4 ${
                  answer?.correct ? 'bg-green-50 border-green-500' : 'bg-red-50 border-red-500'
                }`}
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <p className="font-medium text-gray-800">Questao {idx + 1}</p>
                    <p className="text-sm text-gray-600">{q.discipline}</p>
                  </div>
                  {answer?.correct ? (
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
          onClick={() => {
            setStatus('not-started');
            setMode(null);
          }}
          className="flex-1 bg-gray-200 text-gray-700 py-3 rounded-lg font-semibold hover:bg-gray-300 transition"
        >
          Trocar Modo
        </button>
        <button
          onClick={() => setStatus('not-started')}
          className="flex-1 bg-gradient-to-r from-[#1e3a5f] to-[#0c4a6e] text-white py-3 rounded-lg font-semibold hover:shadow-lg transition"
        >
          Refazer Simulado
        </button>
      </div>
    </div>
  );
}
