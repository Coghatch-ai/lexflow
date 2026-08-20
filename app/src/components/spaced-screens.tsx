import type { ReactElement } from 'react';
import { RotateCcw, ChevronRight, CheckCircle, XCircle, Calendar, ArrowRightToLine } from 'lucide-react';
import { accuracyPct } from '@shared/domain/scoring';
import type { AiExplanation } from '@shared/domain/ai-eval';
import { type NotesAndBookmarks } from '../shared/hooks/use-notes-bookmarks';
import QuestionCard from '@/shared/components/QuestionCard';
import AiExplanationButton from '@/shared/components/AiExplanationButton';

export type ReviewItem = {
  id: string;
  questionText: string;
  options: string[];
  correctAnswer: string;
  explanation: string;
  aiExplanation: AiExplanation | null;
  discipline: string;
  examBoard: string;
  difficulty: string;
  legislationTitle: string | null;
  interval: number;
  repetitions: number;
  nextReviewAt: string;
  lastCorrect: boolean | null;
};

type Lov = { labelOf: (code: string) => string };

// Leaving a review in progress goes through the confirmation dialog (BR-05);
// the parent owns the rules, this is only the trigger.
function ExitReviewButton({ onRequestExit }: { onRequestExit: () => void }): ReactElement {
  return (
    <button
      onClick={onRequestExit}
      className="text-sm text-[#16161a] hover:text-[#26262c] font-medium transition"
    >
      Sair da revisão
    </button>
  );
}

export function SpacedEmptyState({ dueCount }: { dueCount: number }): ReactElement {
  return (
    <div className="bg-white rounded-xl p-6 shadow">
      <div className="flex items-center gap-3 mb-6">
        <div className="bg-[#16161a] p-3 rounded-lg">
          <RotateCcw className="w-6 h-6 text-white" />
        </div>
        <div>
          <h3 className="text-xl font-bold text-[#16161a]">Revisão Espaçada</h3>
          <p className="text-sm text-gray-600">Revise no momento certo para maximizar retenção</p>
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-4 mb-6">
        <div className="bg-[#16161a]/5 rounded-lg p-4 text-center">
          <p className="text-2xl font-bold text-[#16161a]">{dueCount}</p>
          <p className="text-sm text-gray-600">Revisões Pendentes</p>
        </div>
        <div className="bg-green-50 rounded-lg p-4 text-center">
          <p className="text-2xl font-bold text-green-600">0</p>
          <p className="text-sm text-gray-600">Para Revisar Hoje</p>
        </div>
      </div>

      <div className="text-center py-8">
        <Calendar className="w-12 h-12 text-gray-300 mx-auto mb-3" />
        <p className="text-gray-600 mb-2">Nenhuma revisão pendente!</p>
        <p className="text-sm text-gray-500">
          Responda simulados primeiro para que o sistema identifique questões para revisar.
        </p>
      </div>

      <div className="bg-[#16161a]/5 rounded-lg p-4">
        <h4 className="font-semibold text-[#16161a] mb-2">Como funciona?</h4>
        <ul className="space-y-1 text-sm text-gray-700">
          <li>- Questões respondidas incorretamente entram na fila de revisão</li>
          <li>- O algoritmo SM-2 ajusta o intervalo conforme seu desempenho</li>
          <li>- Acerto: intervalo aumenta (1 dia → 6 dias → progressivo)</li>
          <li>- Erro: intervalo volta ao início</li>
          <li>- Quanto mais você acerta, mais tempo até a próxima revisão</li>
        </ul>
      </div>
    </div>
  );
}

interface SpacedPlayingProps {
  currentIndex: number;
  total: number;
  currentQuestion: ReviewItem;
  selectedAnswer: string;
  notesAndBookmarks: NotesAndBookmarks;
  disciplineLov: Lov;
  examBoardLov: Lov;
  canPostpone: boolean;
  eliminatedOptions: readonly string[];
  onSelect: (answer: string) => void;
  onToggleEliminate: (option: string) => void;
  onPostpone: () => void;
  onAnswer: () => void;
  onRequestExit: () => void;
}

export function SpacedPlaying({
  currentIndex, total, currentQuestion, selectedAnswer, notesAndBookmarks,
  disciplineLov, examBoardLov, canPostpone, eliminatedOptions,
  onSelect, onToggleEliminate, onPostpone, onAnswer, onRequestExit,
}: SpacedPlayingProps): ReactElement {
  const { localNotes, bookmarkedIds, handleNoteChange, handleToggleBookmark } = notesAndBookmarks;
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between bg-white rounded-xl p-4 shadow">
        <div className="flex items-center gap-3">
          <RotateCcw className="w-5 h-5 text-[#16161a]" />
          <span className="text-sm font-medium text-gray-700">
            Revisão {currentIndex + 1} de {total}
          </span>
        </div>
        <div className="flex items-center gap-4 text-sm text-gray-600">
          <span className="flex items-center gap-2">
            <Calendar className="w-4 h-4" />
            {currentQuestion.repetitions} acerto{currentQuestion.repetitions !== 1 ? 's' : ''} consecutivo{currentQuestion.repetitions !== 1 ? 's' : ''}
          </span>
          <ExitReviewButton onRequestExit={onRequestExit} />
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
              title="Mover esta revisão para o fim da fila"
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
            Confirmar
            <ChevronRight className="w-5 h-5" />
          </button>
        </div>
      </div>
    </div>
  );
}

interface SpacedFeedbackProps {
  currentIndex: number;
  total: number;
  currentQuestion: ReviewItem;
  lastCorrect: boolean | null;
  nextIntervalDays: number;
  onNext: () => void;
  onRequestExit: () => void;
}

export function SpacedFeedback({
  currentIndex, total, currentQuestion, lastCorrect, nextIntervalDays, onNext, onRequestExit,
}: SpacedFeedbackProps): ReactElement {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between bg-white rounded-xl p-4 shadow">
        <div className="flex items-center gap-3">
          <RotateCcw className="w-5 h-5 text-[#16161a]" />
          <span className="text-sm font-medium text-gray-700">
            Revisão {currentIndex + 1} de {total}
          </span>
        </div>
        <ExitReviewButton onRequestExit={onRequestExit} />
      </div>

      <div className={`rounded-xl p-6 shadow ${lastCorrect === true ? 'bg-green-50 border-2 border-green-200' : 'bg-red-50 border-2 border-red-200'}`}>
        <div className="flex items-center gap-3 mb-4">
          {lastCorrect === true ? (
            <CheckCircle className="w-8 h-8 text-green-600" />
          ) : (
            <XCircle className="w-8 h-8 text-red-600" />
          )}
          <h3 className="text-xl font-bold text-[#16161a]">
            {lastCorrect === true ? 'Correto!' : 'Incorreto'}
          </h3>
        </div>

        {lastCorrect !== true && (
          <div className="mb-4 bg-white rounded-lg p-4">
            <p className="text-sm text-gray-600 mb-1">Resposta correta:</p>
            <p className="font-semibold text-green-700">{currentQuestion.correctAnswer}</p>
          </div>
        )}

        <div className="bg-white rounded-lg p-4 mb-4">
          <AiExplanationButton
            questionId={currentQuestion.id}
            aiExplanation={currentQuestion.aiExplanation}
            explanation={currentQuestion.explanation}
          />
        </div>

        <div className="bg-white rounded-lg p-4 flex items-center gap-3">
          <Calendar className="w-5 h-5 text-[#16161a]" />
          <div>
            <p className="text-sm text-gray-600">Próxima revisão agendada em</p>
            <p className="font-bold text-[#16161a]">
              {nextIntervalDays} dia{nextIntervalDays > 1 ? 's' : ''}
            </p>
          </div>
        </div>
      </div>

      <button
        onClick={onNext}
        className="w-full bg-gradient-to-r from-[#26262c] to-[#26262c] text-white py-3 rounded-lg font-semibold hover:shadow-lg transition flex items-center justify-center gap-2"
      >
        {currentIndex + 1 >= total ? 'Concluir Revisão' : 'Próxima Revisão'}
        <ChevronRight className="w-5 h-5" />
      </button>
    </div>
  );
}

interface SpacedDoneProps {
  sessionCorrect: number;
  sessionTotal: number;
  onReload: () => void;
}

// Reached both by finishing the queue and by "Sair e processar respostas": the
// counters are the answered ones, so a partial review reads honestly (BR-05.7).
export function SpacedDone({ sessionCorrect, sessionTotal, onReload }: SpacedDoneProps): ReactElement {
  return (
    <div className="space-y-6">
      <div className="bg-gradient-to-r from-[#16161a] to-[#16161a] rounded-xl p-6 text-white">
        <h3 className="text-2xl font-bold mb-2">Revisão Concluída!</h3>
        <p className="text-white/80">Continue revisando regularmente para maximizar retenção</p>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <div className="bg-white rounded-xl p-6 shadow text-center">
          <div className="text-4xl font-bold text-green-600 mb-2">{sessionCorrect}</div>
          <p className="text-gray-600">Acertos de {sessionTotal}</p>
        </div>
        <div className="bg-white rounded-xl p-6 shadow text-center">
          <div className="text-4xl font-bold text-[#16161a] mb-2">
            {accuracyPct(sessionCorrect, sessionTotal)}%
          </div>
          <p className="text-gray-600">Acurácia na Sessão</p>
        </div>
      </div>

      <button
        onClick={onReload}
        className="w-full bg-gradient-to-r from-[#26262c] to-[#26262c] text-white py-3 rounded-lg font-semibold hover:shadow-lg transition"
      >
        Recarregar Revisões
      </button>
    </div>
  );
}
