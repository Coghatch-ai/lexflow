// The answering step of the Simulado Padrão. Pure move out of TestingPage.tsx
// (slice S2b) — no behaviour change; it left so the run function fits the
// `max-lines-per-function` budget with the persistence wiring in place.

import { type ReactElement } from 'react';
import { Clock, ChevronRight, ArrowRightToLine } from 'lucide-react';
import QuestionCard from '@/shared/components/QuestionCard';
import AiExplanationButton from '@/shared/components/AiExplanationButton';
import type { NotesAndBookmarks } from '../shared/hooks/use-notes-bookmarks';
import { primaryLabel, primaryDisabled } from './testing-flow-guards';
import type { Lov, TestQuestion } from './testing-standard-types';

interface StandardQuestionProps {
  currentQuestion: TestQuestion;
  currentIndex: number;
  totalAnswered: number;
  totalQuestions: number;
  timer: number;
  selectedAnswer: string;
  checked: boolean;
  /** A save or a recording is in flight — the primary action waits for it. */
  busy: boolean;
  /** pt-BR warning about the resumed run (dropped questions), or null. */
  notice: string | null;
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

export default function StandardQuestion({
  currentQuestion, currentIndex, totalAnswered, totalQuestions, timer, selectedAnswer,
  checked, busy, notice, onCheck,
  notesAndBookmarks, disciplineLov, examBoardLov, onBack, onSelect, onNext, canPostpone, onPostpone,
  eliminatedOptions, onToggleEliminate,
}: StandardQuestionProps): ReactElement {
  const { localNotes, bookmarkedIds, handleNoteChange, handleToggleBookmark } = notesAndBookmarks;
  const progress = (totalAnswered / (totalQuestions > 0 ? totalQuestions : 1)) * 100;
  const isLast = currentIndex + 1 === totalQuestions;
  const btnLabel = primaryLabel({ checked, isLast });
  const btnDisabled = busy || primaryDisabled({ checked, selected: selectedAnswer });

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3 mb-2">
        <button onClick={onBack} className="text-sm text-[#16161a] hover:text-[#26262c] font-medium transition">
          Voltar aos modos
        </button>
      </div>

      {notice !== null && (
        <div className="bg-amber-50 border-2 border-amber-200 rounded-lg p-4 text-sm text-amber-800">
          {notice}
        </div>
      )}

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
              disabled={busy}
              title="Mover esta questão para o fim do simulado"
              className="flex-1 bg-gray-200 text-gray-700 py-3 rounded-lg font-semibold hover:bg-gray-300 transition disabled:opacity-50 flex items-center justify-center gap-2"
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
