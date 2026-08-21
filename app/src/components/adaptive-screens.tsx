import type { ReactElement } from 'react';
import { Brain, ChevronRight, CheckCircle, XCircle, Clock, Zap, ArrowRightToLine } from 'lucide-react';
import { nextDifficulty } from '@shared/domain/adaptive';
import { accuracyPct } from '@shared/domain/scoring';
import type { AiExplanation } from '@shared/domain/ai-eval';
import { type NotesAndBookmarks } from '../shared/hooks/use-notes-bookmarks';
import QuestionCard from '@/shared/components/QuestionCard';
import AiExplanationButton from '@/shared/components/AiExplanationButton';

export type Difficulty = 'easy' | 'medium' | 'hard';

export type AdaptiveQuestion = {
  id: string;
  questionText: string;
  options: string[];
  correctAnswer: string;
  difficulty: Difficulty;
  discipline: string;
  examBoard: string;
  explanation: string;
  aiExplanation: AiExplanation | null;
  legislationTitle: string | null;
};

export interface AdaptiveState {
  currentDifficulty: Difficulty;
  consecutiveCorrect: number;
  consecutiveWrong: number;
  totalCorrect: number;
  totalAnswered: number;
  difficultyHistory: Difficulty[];
}

const DIFFICULTY_COLORS: Record<Difficulty, string> = {
  easy: 'bg-green-100 text-green-700',
  medium: 'bg-yellow-100 text-yellow-700',
  hard: 'bg-red-100 text-red-700',
};

type Lov = { labelOf: (code: string) => string };

interface AdaptiveSetupProps {
  selectedDiscipline: string;
  totalQuestions: number;
  loading: boolean;
  disciplineOptions: { code: string; value: string }[];
  onDisciplineChange: (val: string) => void;
  onTotalQuestionsChange: (val: number) => void;
  onStart: () => void;
}

export function AdaptiveSetup({
  selectedDiscipline,
  totalQuestions,
  loading,
  disciplineOptions,
  onDisciplineChange,
  onTotalQuestionsChange,
  onStart,
}: AdaptiveSetupProps): ReactElement {
  return (
    <div className="bg-white rounded-xl p-6 shadow">
      <div className="flex items-center gap-3 mb-6">
        <div className="bg-[#16161a] p-3 rounded-lg">
          <Brain className="w-6 h-6 text-white" />
        </div>
        <div>
          <h3 className="text-xl font-bold text-[#16161a]">Simulado Adaptativo</h3>
          <p className="text-sm text-gray-600">
            A dificuldade ajusta automaticamente conforme seu desempenho
          </p>
        </div>
      </div>

      <div className="space-y-4 mb-6">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Disciplina (opcional)</label>
          <select
            value={selectedDiscipline}
            onChange={(e) => { onDisciplineChange(e.target.value); }}
            className="w-full px-4 py-2 border-2 border-gray-200 rounded-lg focus:outline-none focus:border-[#16161a]"
          >
            <option value="">Todas as disciplinas</option>
            {disciplineOptions.map((o) => (
              <option key={o.code} value={o.code}>{o.value}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Número de questões: {totalQuestions}
          </label>
          <input
            type="range" min="5" max="30" value={totalQuestions}
            onChange={(e) => { onTotalQuestionsChange(Number(e.target.value)); }}
            className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer"
          />
          <div className="flex justify-between text-xs text-gray-500 mt-1">
            <span>5</span><span>15</span><span>30</span>
          </div>
        </div>
      </div>

      <div className="bg-[#16161a]/5 rounded-lg p-4 mb-6">
        <h4 className="font-semibold text-[#16161a] mb-2">Como funciona?</h4>
        <ul className="space-y-1 text-sm text-gray-700">
          <li>- Começa no nível médio</li>
          <li>- 2 acertos seguidos: sobe a dificuldade</li>
          <li>- 2 erros seguidos: diminui a dificuldade</li>
          <li>- Ajuste automatico em tempo real</li>
        </ul>
      </div>

      <button
        onClick={onStart}
        disabled={loading}
        className="w-full bg-gradient-to-r from-[#26262c] to-[#26262c] text-white py-3 rounded-lg font-semibold hover:shadow-lg transition disabled:opacity-50 flex items-center justify-center gap-2"
      >
        <Zap className="w-5 h-5" />
        {loading ? 'Carregando...' : 'Iniciar Simulado Adaptativo'}
      </button>
    </div>
  );
}

interface AdaptivePlayingProps {
  adaptive: AdaptiveState;
  totalQuestions: number;
  timer: number;
  currentQuestion: AdaptiveQuestion;
  selectedAnswer: string;
  notesAndBookmarks: NotesAndBookmarks;
  disciplineLov: Lov;
  examBoardLov: Lov;
  difficultyLov: Lov;
  canPostpone: boolean;
  eliminatedOptions: readonly string[];
  onSelect: (answer: string) => void;
  onToggleEliminate: (option: string) => void;
  onPostpone: () => void;
  onAnswer: () => void;
  onRequestExit: () => void;
}

export function AdaptivePlaying({
  adaptive, totalQuestions, timer, currentQuestion, selectedAnswer,
  notesAndBookmarks, disciplineLov, examBoardLov, difficultyLov,
  canPostpone, eliminatedOptions, onSelect, onToggleEliminate, onPostpone, onAnswer,
  onRequestExit,
}: AdaptivePlayingProps): ReactElement {
  const { localNotes, bookmarkedIds, handleNoteChange, handleToggleBookmark } = notesAndBookmarks;
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between bg-white rounded-xl p-4 shadow">
        <div className="flex items-center gap-3">
          <Brain className="w-5 h-5 text-[#16161a]" />
          <span className="text-sm font-medium text-gray-700">Nivel atual:</span>
          <span className={`px-3 py-1 rounded-full text-sm font-bold ${DIFFICULTY_COLORS[adaptive.currentDifficulty]}`}>
            {difficultyLov.labelOf(adaptive.currentDifficulty)}
          </span>
        </div>
        <div className="flex items-center gap-4 text-sm text-gray-600">
          <span className="flex items-center gap-2">
            <Clock className="w-4 h-4" />
            {Math.floor(timer / 60)}:{String(timer % 60).padStart(2, '0')}
          </span>
          <button
            onClick={onRequestExit}
            className="text-sm text-[#16161a] hover:text-[#26262c] font-medium transition"
          >
            Sair do simulado
          </button>
        </div>
      </div>

      <div className="space-y-1">
        <div className="flex justify-between text-sm text-gray-600">
          <span>Questão {adaptive.totalAnswered + 1} de {totalQuestions}</span>
          <span>{adaptive.totalCorrect}/{adaptive.totalAnswered} acertos</span>
        </div>
        <div className="w-full bg-gray-200 rounded-full h-2">
          <div
            className="bg-gradient-to-r from-[#16161a] to-[#26262c] h-2 rounded-full transition-all"
            style={{ width: `${(adaptive.totalAnswered / totalQuestions) * 100}%` }}
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
          eliminatedOptions={eliminatedOptions}
          onToggleEliminate={onToggleEliminate}
        />
        <div className="flex gap-3">
          {canPostpone && (
            <button
              onClick={onPostpone}
              title="Responder esta questão no fim do simulado"
              className="flex-1 bg-gray-200 text-gray-700 py-3 rounded-lg font-semibold hover:bg-gray-300 transition flex items-center justify-center gap-2"
            >
              <ArrowRightToLine className="w-5 h-5" />
              Responder depois
            </button>
          )}
          <button
            onClick={onAnswer}
            disabled={selectedAnswer.length === 0}
            className="flex-1 bg-gradient-to-r from-[#26262c] to-[#26262c] text-white py-3 rounded-lg font-semibold hover:shadow-lg transition disabled:opacity-50 flex items-center justify-center gap-2"
          >
            Confirmar Resposta
            <ChevronRight className="w-5 h-5" />
          </button>
        </div>
      </div>
    </div>
  );
}

interface AdaptiveFeedbackProps {
  adaptive: AdaptiveState;
  totalQuestions: number;
  lastCorrect: boolean | null;
  currentQuestion: AdaptiveQuestion;
  difficultyLov: Lov;
  onNext: () => void;
  onRequestExit: () => void;
}

export function AdaptiveFeedback({
  adaptive, totalQuestions, lastCorrect, currentQuestion, difficultyLov, onNext, onRequestExit,
}: AdaptiveFeedbackProps): ReactElement {
  const nextDiff = nextDifficulty(
    adaptive.currentDifficulty, adaptive.consecutiveCorrect, adaptive.consecutiveWrong
  );
  const difficultyChanged = nextDiff !== adaptive.currentDifficulty;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between bg-white rounded-xl p-4 shadow">
        <div className="flex items-center gap-3">
          <Brain className="w-5 h-5 text-[#16161a]" />
          <span className="text-sm font-medium text-gray-700">
            Questão {adaptive.totalAnswered} de {totalQuestions}
          </span>
        </div>
        <button
          onClick={onRequestExit}
          className="text-sm text-[#16161a] hover:text-[#26262c] font-medium transition"
        >
          Sair do simulado
        </button>
      </div>

      <div className={`rounded-xl p-6 shadow ${lastCorrect === true ? 'bg-green-50 border-2 border-green-200' : 'bg-red-50 border-2 border-red-200'}`}>
        <div className="flex items-center gap-3 mb-4">
          {lastCorrect === true ? (
            <CheckCircle className="w-8 h-8 text-green-600" />
          ) : (
            <XCircle className="w-8 h-8 text-red-600" />
          )}
          <h3 className="text-xl font-bold text-[#16161a]">
            {lastCorrect === true ? 'Resposta Correta!' : 'Resposta Incorreta'}
          </h3>
        </div>

        {lastCorrect !== true && (
          <div className="mb-4 bg-white rounded-lg p-4">
            <p className="text-sm text-gray-600 mb-1">Resposta correta:</p>
            <p className="font-semibold text-green-700">{currentQuestion.correctAnswer}</p>
          </div>
        )}

        <div className="bg-white rounded-lg p-4">
          <p className="text-sm font-medium text-gray-700 mb-2">Explicação:</p>
          <AiExplanationButton
            questionId={currentQuestion.id}
            aiExplanation={currentQuestion.aiExplanation}
            explanation={currentQuestion.explanation}
          />
          <p className="text-sm text-[#16161a] mt-2 font-medium">{currentQuestion.legislationTitle}</p>
        </div>
      </div>

      {difficultyChanged && (
        <div className="bg-[#16161a]/10 border-2 border-[#16161a] rounded-xl p-4 flex items-center gap-3">
          <Zap className="w-5 h-5 text-[#16161a]" />
          <div>
            <p className="font-semibold text-[#16161a]">Dificuldade ajustada!</p>
            <p className="text-sm text-gray-700">
              De <span className={`font-bold ${DIFFICULTY_COLORS[adaptive.currentDifficulty]}`}>{difficultyLov.labelOf(adaptive.currentDifficulty)}</span> para{' '}
              <span className={`font-bold ${DIFFICULTY_COLORS[nextDiff]}`}>{difficultyLov.labelOf(nextDiff)}</span>
            </p>
          </div>
        </div>
      )}

      <button
        onClick={onNext}
        className="w-full bg-gradient-to-r from-[#26262c] to-[#26262c] text-white py-3 rounded-lg font-semibold hover:shadow-lg transition flex items-center justify-center gap-2"
      >
        {adaptive.totalAnswered >= totalQuestions ? 'Ver Resultado' : 'Próxima Questão'}
        <ChevronRight className="w-5 h-5" />
      </button>
    </div>
  );
}

interface AdaptiveFinishedProps {
  adaptive: AdaptiveState;
  timer: number;
  onReset: () => void;
}

export function AdaptiveFinished({ adaptive, timer, onReset }: AdaptiveFinishedProps): ReactElement {
  const accuracy = accuracyPct(adaptive.totalCorrect, adaptive.totalAnswered);
  const histLen = adaptive.difficultyHistory.length;
  const counts = { easy: 0, medium: 0, hard: 0 };
  adaptive.difficultyHistory.forEach((d) => { counts[d]++; });

  return (
    <div className="space-y-6">
      <div className="bg-gradient-to-r from-[#16161a] to-[#16161a] rounded-xl p-6 text-white">
        <h3 className="text-2xl font-bold mb-2">Simulado Adaptativo Finalizado!</h3>
        <p className="text-white/80">Veja como seu desempenho evoluiu</p>
      </div>

      <div className="grid md:grid-cols-3 gap-4">
        <div className="bg-white rounded-xl p-6 shadow text-center">
          <div className="text-4xl font-bold text-[#16161a] mb-2">{accuracy}%</div>
          <p className="text-gray-600">Acurácia Final</p>
        </div>
        <div className="bg-white rounded-xl p-6 shadow text-center">
          <div className="text-4xl font-bold text-green-600 mb-2">{adaptive.totalCorrect}</div>
          <p className="text-gray-600">Acertos de {adaptive.totalAnswered}</p>
        </div>
        <div className="bg-white rounded-xl p-6 shadow text-center">
          <div className="text-4xl font-bold text-[#16161a] mb-2">{Math.floor(timer / 60)}:{String(timer % 60).padStart(2, '0')}</div>
          <p className="text-gray-600">Tempo Total</p>
        </div>
      </div>

      <div className="bg-white rounded-xl p-6 shadow">
        <h4 className="text-lg font-bold text-[#16161a] mb-4">Distribuição de Dificuldade</h4>
        <div className="space-y-3">
          {([['Fácil', 'bg-green-500', counts.easy], ['Médio', 'bg-yellow-500', counts.medium], ['Difícil', 'bg-red-500', counts.hard]] as [string, string, number][]).map(([label, color, count]) => (
            <div key={label} className="flex items-center gap-3">
              <span className="w-16 text-sm font-medium text-gray-700">{label}</span>
              <div className="flex-1 bg-gray-200 rounded-full h-4">
                <div className={`${color} h-4 rounded-full`} style={{ width: `${(count / histLen) * 100}%` }} />
              </div>
              <span className="w-8 text-sm font-bold text-gray-700">{count}</span>
            </div>
          ))}
        </div>
      </div>

      <button
        onClick={onReset}
        className="w-full bg-gradient-to-r from-[#26262c] to-[#26262c] text-white py-3 rounded-lg font-semibold hover:shadow-lg transition"
      >
        Fazer Outro Simulado Adaptativo
      </button>
    </div>
  );
}
