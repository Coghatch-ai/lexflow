// The "prova real" answering screen, extracted out of RealExamSimulation.tsx
// (#70) so the container stays under the 500-line ESLint budget — same split
// already used for the review screen in real-exam-review.tsx.
//
// Cross-out (BR-02) is available during the WHOLE `playing` status, including
// on a question already answered: the real exam lets the student change an
// answer until the exam ends, so there is no "checked/locked" state here and
// `locked` is never passed. The cross-outs die only when the exam leaves
// `playing` (review) or on reset — the container owns that.

import type { ReactElement } from 'react';
import { Clock, Flag, ArrowRightToLine } from 'lucide-react';
import ExamQuestionNav from './ExamQuestionNav';
import ExamFinishDialog from './ExamFinishDialog';
import QuestionCard from '@/shared/components/QuestionCard';
import type { NotesAndBookmarks } from '../shared/hooks/use-notes-bookmarks';

// Only the fields this screen renders — same local-structural-type pattern as
// real-exam-review.tsx, so the container keeps owning the full ExamQuestion.
type PlayingQuestion = {
  id: string;
  questionText: string;
  options: string[];
  discipline: string;
  examBoard: string;
};

type Lov = { labelOf: (code: string) => string };

export interface ExamPlayingProps {
  questions: PlayingQuestion[];
  currentIndex: number;
  answers: Map<number, string>;
  flagged: Set<number>;
  postponed: Set<number>;
  timeLeft: number;
  examDuration: number;
  showConfirmSubmit: boolean;
  notesAndBookmarks: NotesAndBookmarks;
  disciplineLov: Lov;
  examBoardLov: Lov;
  canPostpone: boolean;
  eliminatedOptions: readonly string[];
  formatTime: (seconds: number) => string;
  onSelectAnswer: (option: string) => void;
  onToggleEliminate: (option: string) => void;
  onSetIndex: (idx: number) => void;
  onToggleFlag: () => void;
  onPostpone: () => void;
  onGoToUnanswered: () => void;
  onShowConfirmSubmit: () => void;
  onHideConfirmSubmit: () => void;
  onSubmit: () => void;
  onRequestExit: () => void;
}

export default function ExamPlaying({
  questions, currentIndex, answers, flagged, postponed, timeLeft, examDuration,
  showConfirmSubmit, notesAndBookmarks, disciplineLov, examBoardLov, canPostpone,
  eliminatedOptions, formatTime,
  onSelectAnswer, onToggleEliminate, onSetIndex, onToggleFlag, onPostpone, onGoToUnanswered,
  onShowConfirmSubmit, onHideConfirmSubmit, onSubmit, onRequestExit,
}: ExamPlayingProps): ReactElement {
  const { localNotes, bookmarkedIds, handleNoteChange, handleToggleBookmark } = notesAndBookmarks;
  const currentQuestion = questions[currentIndex];
  const answeredCount = answers.size;
  const flaggedCount = flagged.size;
  const timePercentage = (timeLeft / examDuration) * 100;
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
          eliminatedOptions={eliminatedOptions}
          onToggleEliminate={onToggleEliminate}
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
