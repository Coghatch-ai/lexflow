// Which Simulado Adaptativo screen is on show — the render half of
// `adaptive-board.tsx`, split off so the board stays inside the 250-line
// `max-lines-per-function` budget (conventions.md playbook, same mechanical
// split as `testing-standard-question.tsx`).
//
// Presentational only: it DECIDES nothing and holds no state. The three screens
// are mutually exclusive, and the exit dialog plus the persistence overlays
// ride along with each because either can be open over any of them.

import type { ReactElement } from 'react';
import QuitTestDialog from './QuitTestDialog';
import RunOverlays from '../pages/testing-run-overlays';
import { exitPrompt } from '@shared/run/exit-rules';
import type { RunPersistence } from '@shared/react/use-run-persistence';
import type { NotesAndBookmarks } from '../shared/hooks/use-notes-bookmarks';
import {
  AdaptiveFeedback,
  AdaptiveFinished,
  AdaptivePlaying,
  type AdaptiveQuestion,
  type AdaptiveState,
} from './adaptive-screens';

type Lov = { options: { code: string; value: string }[]; labelOf: (code: string) => string };

interface AdaptiveBoardViewProps {
  adaptive: AdaptiveState;
  totalQuestions: number;
  answeredCount: number;
  timer: number;
  currentQuestion: AdaptiveQuestion;
  selectedAnswer: string;
  lastCorrect: boolean | null;
  /** The answer was confirmed: the feedback screen is up. */
  checked: boolean;
  /** The run ended: the result screen is up. */
  finished: boolean;
  /** A save or a recording is in flight — no second entry into either. */
  busy: boolean;
  exitOpen: boolean;
  notice: string | null;
  canPostpone: boolean;
  eliminatedOptions: readonly string[];
  persistence: RunPersistence;
  notesAndBookmarks: NotesAndBookmarks;
  disciplineLov: Lov;
  examBoardLov: Lov;
  difficultyLov: Lov;
  onSelect: (answer: string) => void;
  onToggleEliminate: (option: string) => void;
  onPostpone: () => void;
  onAnswer: () => void;
  onNext: () => void;
  onRequestExit: () => void;
  onContinueRun: () => void;
  onQuitAndProcess: () => void;
  onSaveAndExit: () => void;
  onReloadFromServer: () => void;
  onRestart: () => void;
  onExitToModes: () => void;
}

export default function AdaptiveBoardView(props: AdaptiveBoardViewProps): ReactElement {
  const { adaptive, totalQuestions, currentQuestion, busy, finished, checked } = props;

  const overlays = (
    <RunOverlays
      persistence={props.persistence}
      busy={busy}
      onReload={props.onReloadFromServer}
      onRestart={props.onRestart}
      onExitToModes={props.onExitToModes}
    />
  );

  if (finished) {
    return (
      <>
        <AdaptiveFinished adaptive={adaptive} timer={props.timer} onReset={props.onRestart} />
        {overlays}
      </>
    );
  }

  const quitDialog = (
    <QuitTestDialog
      open={props.exitOpen}
      prompt={exitPrompt('adaptive', props.answeredCount, totalQuestions)}
      busy={busy}
      onContinue={props.onContinueRun}
      onQuit={props.onQuitAndProcess}
      onSave={props.onSaveAndExit}
    />
  );

  if (checked) {
    return (
      <>
        <AdaptiveFeedback
          adaptive={adaptive}
          totalQuestions={totalQuestions}
          lastCorrect={props.lastCorrect}
          currentQuestion={currentQuestion}
          difficultyLov={props.difficultyLov}
          onNext={props.onNext}
          onRequestExit={props.onRequestExit}
        />
        {quitDialog}
        {overlays}
      </>
    );
  }

  return (
    <>
      <AdaptivePlaying
        adaptive={adaptive}
        totalQuestions={totalQuestions}
        timer={props.timer}
        currentQuestion={currentQuestion}
        selectedAnswer={props.selectedAnswer}
        notice={props.notice}
        notesAndBookmarks={props.notesAndBookmarks}
        disciplineLov={props.disciplineLov}
        examBoardLov={props.examBoardLov}
        difficultyLov={props.difficultyLov}
        canPostpone={props.canPostpone}
        eliminatedOptions={props.eliminatedOptions}
        onSelect={props.onSelect}
        onToggleEliminate={props.onToggleEliminate}
        onPostpone={props.onPostpone}
        onAnswer={props.onAnswer}
        onRequestExit={props.onRequestExit}
      />
      {quitDialog}
      {overlays}
    </>
  );
}
