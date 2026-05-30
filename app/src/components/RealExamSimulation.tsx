import { useState, useEffect, useCallback } from 'react';
import { Clock, AlertCircle, Flag, CheckCircle, XCircle } from 'lucide-react';
import { trpc } from '../shared/lib/trpc';

type Status = 'setup' | 'playing' | 'review' | 'finished';

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
}

const EXAM_DURATION = 5 * 60 * 60;
const QUESTIONS_PER_EXAM = 80;

export default function RealExamSimulation() {
  const [status, setStatus] = useState<Status>('setup');
  const [questions, setQuestions] = useState<Question[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [answers, setAnswers] = useState<Map<number, string>>(new Map());
  const [flagged, setFlagged] = useState<Set<number>>(new Set());
  const [timeLeft, setTimeLeft] = useState(EXAM_DURATION);
  const [loading, setLoading] = useState(false);
  const [showConfirmSubmit, setShowConfirmSubmit] = useState(false);

  const utils = trpc.useUtils();
  const recordMutation = trpc.sessions.record.useMutation({
    onSuccess: () => {
      void utils.stats.invalidate();
      void utils.sessions.invalidate();
    },
  });

  const currentQuestion = questions[currentIndex];

  // Timer
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

    return () => clearInterval(interval);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  const formatTime = (seconds: number) => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  const startExam = async () => {
    setLoading(true);
    try {
      const rows = await utils.questions.list.fetch({ limit: QUESTIONS_PER_EXAM });
      const mapped: Question[] = rows.map((r) => ({
        id: r.id,
        question_text: r.questionText,
        options: r.options,
        correct_answer: r.correctAnswer,
        difficulty: r.difficulty,
        discipline: r.discipline,
        exam_board: r.examBoard,
        explanation: r.explanation,
        legislation_title: r.legislationTitle,
      }));
      setQuestions(mapped);
      setAnswers(new Map());
      setFlagged(new Set());
      setCurrentIndex(0);
      setTimeLeft(EXAM_DURATION);
      setStatus('playing');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = useCallback(() => {
    setStatus('review');
  }, []);

  // Persist the exam once when entering the review screen (covers both manual
  // submit and the timer running out).
  useEffect(() => {
    if (status !== 'review') return;
    const log = questions.map((q, idx) => ({
      questionId: q.id,
      userAnswer: answers.get(idx) ?? '',
      correct: answers.get(idx) === q.correct_answer,
      timeSpent: 0,
    }));
    if (log.length > 0) {
      recordMutation.mutate({ discipline: 'Prova Real', difficulty: 'hard', answers: log });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  const selectAnswer = (option: string) => {
    const newAnswers = new Map(answers);
    newAnswers.set(currentIndex, option);
    setAnswers(newAnswers);
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

  const answeredCount = answers.size;
  const unansweredCount = questions.length - answeredCount;
  const flaggedCount = flagged.size;

  // Setup
  if (status === 'setup') {
    return (
      <div className="bg-white rounded-xl p-6 shadow">
        <div className="flex items-center gap-3 mb-6">
          <div className="bg-[#0ea5e9] p-3 rounded-lg">
            <Flag className="w-6 h-6 text-white" />
          </div>
          <div>
            <h3 className="text-xl font-bold text-[#0f172a]">Simulado Estilo Prova Real</h3>
            <p className="text-sm text-gray-600">Simule as condicoes reais do exame</p>
          </div>
        </div>

        <div className="bg-[#0ea5e9]/5 rounded-lg p-4 mb-6 space-y-2">
          <h4 className="font-semibold text-[#0f172a]">Configuracao do Simulado:</h4>
          <ul className="space-y-1 text-sm text-gray-700">
            <li>- {QUESTIONS_PER_EXAM} questoes (como a prova real)</li>
            <li>- 5 horas de duracao</li>
            <li>- Sem feedback durante o simulado</li>
            <li>- Pode sinalizar questoes para revisar depois</li>
            <li>- Navegue livremente entre questoes</li>
            <li>- Timer regressivo como na prova real</li>
          </ul>
        </div>

        <div className="bg-red-50 border-2 border-red-200 rounded-lg p-4 mb-6">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-red-700">Atencao!</p>
              <p className="text-sm text-red-600">
                Este simulado simula condicoes reais de prova. Nao havera feedback
                durante o exame. Certifique-se de ter tempo disponivel.
              </p>
            </div>
          </div>
        </div>

        <button
          onClick={startExam}
          disabled={loading}
          className="w-full bg-gradient-to-r from-[#1e3a5f] to-[#0c4a6e] text-white py-3 rounded-lg font-semibold hover:shadow-lg transition disabled:opacity-50 flex items-center justify-center gap-2"
        >
          <Flag className="w-5 h-5" />
          {loading ? 'Carregando...' : 'Iniciar Simulado Real'}
        </button>
      </div>
    );
  }

  // Playing
  if (status === 'playing' && currentQuestion) {
    const timePercentage = (timeLeft / EXAM_DURATION) * 100;
    const isUrgent = timeLeft < 1800;

    return (
      <div className="space-y-4">
        <div className={`rounded-xl p-4 shadow ${isUrgent ? 'bg-red-50 border-2 border-red-300' : 'bg-white'}`}>
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <Clock className={`w-5 h-5 ${isUrgent ? 'text-red-600 animate-pulse' : 'text-[#0f172a]'}`} />
              <span className={`text-lg font-bold ${isUrgent ? 'text-red-600' : 'text-[#0f172a]'}`}>
                {formatTime(timeLeft)}
              </span>
            </div>
            <div className="flex items-center gap-4 text-sm text-gray-600">
              <span>{answeredCount}/{questions.length} respondidas</span>
              {flaggedCount > 0 && (
                <span className="text-[#0ea5e9] font-medium">{flaggedCount} sinalizadas</span>
              )}
            </div>
          </div>
          <div className="w-full bg-gray-200 rounded-full h-2">
            <div
              className={`h-2 rounded-full transition-all ${isUrgent ? 'bg-red-500' : 'bg-[#0ea5e9]'}`}
              style={{ width: `${timePercentage}%` }}
            />
          </div>
        </div>

        <div className="bg-white rounded-xl p-4 shadow">
          <div className="flex items-center justify-between mb-3">
            <span className="font-bold text-[#0f172a]">Questao {currentIndex + 1}</span>
            <div className="flex gap-2">
              <button
                onClick={toggleFlag}
                className={`p-2 rounded-lg transition ${
                  flagged.has(currentIndex)
                    ? 'bg-[#0ea5e9] text-white'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
                title="Sinalizar para revisao"
              >
                <Flag className="w-4 h-4" />
              </button>
              <button
                onClick={() => setShowConfirmSubmit(true)}
                className="px-4 py-2 bg-[#0f172a] text-white rounded-lg text-sm font-semibold hover:bg-[#1e3a5f] transition"
              >
                Encerrar
              </button>
            </div>
          </div>

          <p className="text-sm text-gray-600 mb-2">
            <span className="font-medium">{currentQuestion.discipline}</span> - {currentQuestion.exam_board}
          </p>

          <h3 className="text-lg font-semibold text-[#0f172a] mb-4">
            {currentQuestion.question_text}
          </h3>

          <div className="space-y-3 mb-6">
            {currentQuestion.options.map((option, idx) => (
              <button
                key={idx}
                onClick={() => selectAnswer(option)}
                className={`w-full text-left p-4 border-2 rounded-lg transition ${
                  answers.get(currentIndex) === option
                    ? 'border-[#0ea5e9] bg-[#0ea5e9]/5'
                    : 'border-gray-200 hover:border-[#0ea5e9]/50'
                }`}
              >
                <div className="flex items-start gap-3">
                  <div
                    className={`w-6 h-6 rounded-full border-2 flex items-center justify-center flex-shrink-0 mt-0.5 ${
                      answers.get(currentIndex) === option
                        ? 'border-[#0ea5e9] bg-[#0ea5e9]'
                        : 'border-gray-300'
                    }`}
                  >
                    {answers.get(currentIndex) === option && (
                      <div className="w-2 h-2 bg-white rounded-full" />
                    )}
                  </div>
                  <span className="text-gray-800">{option}</span>
                </div>
              </button>
            ))}
          </div>

          <div className="flex items-center justify-between">
            <button
              onClick={() => setCurrentIndex(Math.max(0, currentIndex - 1))}
              disabled={currentIndex === 0}
              className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg font-medium hover:bg-gray-300 transition disabled:opacity-50"
            >
              Anterior
            </button>
            <span className="text-sm text-gray-500">
              {currentIndex + 1} de {questions.length}
            </span>
            <button
              onClick={() => setCurrentIndex(Math.min(questions.length - 1, currentIndex + 1))}
              disabled={currentIndex === questions.length - 1}
              className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg font-medium hover:bg-gray-300 transition disabled:opacity-50"
            >
              Proxima
            </button>
          </div>
        </div>

        <div className="bg-white rounded-xl p-4 shadow">
          <h4 className="text-sm font-semibold text-gray-700 mb-3">Navegacao Rapida</h4>
          <div className="grid grid-cols-10 gap-1">
            {questions.map((_, idx) => (
              <button
                key={idx}
                onClick={() => setCurrentIndex(idx)}
                className={`w-full aspect-square rounded text-xs font-medium transition ${
                  idx === currentIndex
                    ? 'bg-[#0f172a] text-white'
                    : flagged.has(idx)
                      ? 'bg-[#0ea5e9] text-white'
                      : answers.has(idx)
                        ? 'bg-[#1e3a5f] text-white'
                        : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                {idx + 1}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-4 mt-3 text-xs text-gray-500">
            <div className="flex items-center gap-1">
              <div className="w-3 h-3 rounded bg-[#1e3a5f]" />
              <span>Respondida</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="w-3 h-3 rounded bg-[#0ea5e9]" />
              <span>Sinalizada</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="w-3 h-3 rounded bg-gray-100" />
              <span>Nao respondida</span>
            </div>
          </div>
        </div>

        {showConfirmSubmit && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-xl p-6 max-w-md w-full shadow-2xl">
              <h3 className="text-xl font-bold text-[#0f172a] mb-4">Encerrar Simulado?</h3>
              <p className="text-gray-600 mb-2">
                Voce respondeu <span className="font-bold">{answeredCount}</span> de {questions.length} questoes.
              </p>
              {unansweredCount > 0 && (
                <p className="text-red-600 text-sm mb-4">
                  {unansweredCount} questao(oes) sem resposta!
                </p>
              )}
              <div className="flex gap-3">
                <button
                  onClick={() => setShowConfirmSubmit(false)}
                  className="flex-1 bg-gray-200 text-gray-700 py-2 rounded-lg font-semibold hover:bg-gray-300 transition"
                >
                  Continuar
                </button>
                <button
                  onClick={() => {
                    setShowConfirmSubmit(false);
                    handleSubmit();
                  }}
                  className="flex-1 bg-[#0f172a] text-white py-2 rounded-lg font-semibold hover:bg-[#1e3a5f] transition"
                >
                  Encerrar
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // Review
  if (status === 'review') {
    let correctCount = 0;
    questions.forEach((q, idx) => {
      if (answers.get(idx) === q.correct_answer) correctCount++;
    });
    const accuracy = questions.length > 0 ? Math.round((correctCount / questions.length) * 100) : 0;
    const timeUsed = EXAM_DURATION - timeLeft;

    return (
      <div className="space-y-6">
        <div className="bg-gradient-to-r from-[#0ea5e9] to-[#0f172a] rounded-xl p-6 text-white">
          <h3 className="text-2xl font-bold mb-2">Simulado Finalizado!</h3>
          <p className="text-white/80">Veja como foi seu desempenho</p>
        </div>

        <div className="grid md:grid-cols-4 gap-4">
          <div className="bg-white rounded-xl p-6 shadow text-center">
            <div className="text-4xl font-bold text-[#0f172a] mb-2">{accuracy}%</div>
            <p className="text-gray-600">Acuracia</p>
          </div>
          <div className="bg-white rounded-xl p-6 shadow text-center">
            <div className="text-4xl font-bold text-green-600 mb-2 flex items-center justify-center gap-2">
              <CheckCircle className="w-8 h-8" />
              {correctCount}
            </div>
            <p className="text-gray-600">Acertos</p>
          </div>
          <div className="bg-white rounded-xl p-6 shadow text-center">
            <div className="text-4xl font-bold text-red-600 mb-2 flex items-center justify-center gap-2">
              <XCircle className="w-8 h-8" />
              {questions.length - correctCount}
            </div>
            <p className="text-gray-600">Erros</p>
          </div>
          <div className="bg-white rounded-xl p-6 shadow text-center">
            <div className="text-4xl font-bold text-[#0ea5e9] mb-2">{formatTime(timeUsed)}</div>
            <p className="text-gray-600">Tempo Usado</p>
          </div>
        </div>

        <div className="bg-white rounded-xl p-6 shadow">
          <h4 className="text-lg font-bold text-[#0f172a] mb-4">Revisao por Questao</h4>
          <div className="space-y-2 max-h-[500px] overflow-y-auto">
            {questions.map((q, idx) => {
              const userAnswer = answers.get(idx);
              const isCorrect = userAnswer === q.correct_answer;
              return (
                <div
                  key={q.id}
                  className={`p-3 rounded-lg border-l-4 ${
                    isCorrect ? 'bg-green-50 border-green-500' : userAnswer ? 'bg-red-50 border-red-500' : 'bg-gray-50 border-gray-400'
                  }`}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <p className="font-medium text-gray-800 text-sm">
                        Questao {idx + 1} - {q.discipline}
                      </p>
                      {!isCorrect && (
                        <div className="mt-1 text-xs">
                          <p className="text-red-600">Sua resposta: {userAnswer || 'Nao respondida'}</p>
                          <p className="text-green-600">Correta: {q.correct_answer}</p>
                        </div>
                      )}
                    </div>
                    {isCorrect ? (
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

        <button
          onClick={() => {
            setStatus('setup');
            setQuestions([]);
            setAnswers(new Map());
            setFlagged(new Set());
          }}
          className="w-full bg-gradient-to-r from-[#1e3a5f] to-[#0c4a6e] text-white py-3 rounded-lg font-semibold hover:shadow-lg transition"
        >
          Fazer Outro Simulado Real
        </button>
      </div>
    );
  }

  return null;
}
