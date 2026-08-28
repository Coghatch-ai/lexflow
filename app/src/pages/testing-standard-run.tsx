// Entry point of the Simulado Padrão (epic #67 slice S2b): the filter step, the
// draw of a fresh queue, and the REHYDRATION of a saved run. The run itself
// lives in `StandardBoard`, mounted with a `key` per run so every run gets a
// clean scheduler and a clean draft identity.
//
// Resume NEVER re-queries `questions.list` (it orders by `random()`, which
// would swap the question set out from under the cursor): it replays the frozen
// `questionIds` through `questions.byIds` and re-imposes their order in
// `resumeStateFrom`, because `inArray` answers in database order.

import { useEffect, useRef, useState, type ReactElement } from 'react';
import { useLov } from '../shared/hooks/use-lov';
import { FRESH_READ, trpc } from '../shared/lib/trpc';
import { persistedDraftOf, resumeStateFrom } from '@shared/run/run-persistence';
import StandardSetup from './testing-standard-setup';
import StandardBoard from './testing-standard-board';
import {
  toTestQuestion,
  type StandardFilters,
  type StandardRunStart,
} from './testing-standard-types';

const DROPPED_NOTICE = 'Algumas questões saíram do catálogo e foram removidas do teste.';
const ALL_DROPPED_NOTICE =
  'As questões deste teste saíram do catálogo, então o teste salvo foi descartado.';

const NO_FILTERS: StandardFilters = { discipline: '', examBoard: '', difficulty: '' };

interface StandardRunProps {
  /** `resume` continues the saved run; `new` starts from the filters. */
  intent: 'new' | 'resume';
  onExitToModes: () => void;
}

export default function StandardRun({ intent, onExitToModes }: StandardRunProps): ReactElement {
  const disciplineLov = useLov('DISCIPLINE');
  const examBoardLov = useLov('EXAM_BOARD');
  const difficultyLov = useLov('DIFFICULTY');
  const utils = trpc.useUtils();
  const discardMutation = trpc.examDrafts.discard.useMutation();

  const [filters, setFilters] = useState<StandardFilters>(NO_FILTERS);
  const [start, setStart] = useState<StandardRunStart | null>(null);
  const [runKey, setRunKey] = useState(0);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const loadQuestions = async (): Promise<void> => {
    setLoading(true);
    setNotice(null);
    try {
      const rows = await utils.questions.list.fetch({
        discipline: filters.discipline !== '' ? filters.discipline : undefined,
        examBoard: filters.examBoard !== '' ? (filters.examBoard as 'FGV' | 'CESPE') : undefined,
        difficulty:
          filters.difficulty !== ''
            ? (filters.difficulty as 'easy' | 'medium' | 'hard')
            : undefined,
        limit: 10,
      });
      setStart({
        questions: rows.map(toTestQuestion),
        cursor: 0,
        answers: [],
        carriedTime: new Map(),
        elapsedSeconds: 0,
        filters,
        draft: null,
      });
      setRunKey((key) => key + 1);
    } finally {
      setLoading(false);
    }
  };

  const resumeRun = async (): Promise<void> => {
    setLoading(true);
    setNotice(null);
    try {
      // `persistedDraftOf` restores the `| null` this program cannot infer —
      // see its comment; without it the "no saved run" branch is dead code.
      //
      // `FRESH_READ` because this read is also the CONFLICT's "Recarregar do
      // servidor": under the client's 5-minute default it would rehydrate from
      // the same cached copy that produced the conflict, forever.
      const draft = persistedDraftOf(
        await utils.examDrafts.get.fetch({ mode: 'standard' }, FRESH_READ),
      );
      if (draft === null) return;
      const rows = await utils.questions.byIds.fetch({ ids: draft.questionIds });
      const state = resumeStateFrom(draft, rows.map(toTestQuestion));
      if (state.discard) {
        // Nothing survived in the catalog: the row cannot be resumed and must
        // not be recorded either (`user_answers` has an FK to `oab_questions`).
        await discardMutation.mutateAsync({ mode: 'standard' });
        await utils.examDrafts.invalidate();
        setNotice(ALL_DROPPED_NOTICE);
        return;
      }
      const resumedFilters: StandardFilters = {
        discipline: state.setup.discipline,
        examBoard: state.setup.examBoard ?? '',
        difficulty: state.setup.difficulty ?? '',
      };
      setFilters(resumedFilters);
      setNotice(state.dropped > 0 ? DROPPED_NOTICE : null);
      setStart({
        questions: state.questions,
        cursor: state.cursor,
        answers: state.answers,
        carriedTime: state.carriedTime,
        elapsedSeconds: state.elapsedSeconds,
        filters: resumedFilters,
        draft: { id: draft.id, token: draft.lastSavedAt },
      });
      setRunKey((key) => key + 1);
    } finally {
      setLoading(false);
    }
  };

  // No dependency array by design (same pattern as `useRegisterRun`): the ref
  // is what makes it run exactly once, without a hand-maintained dep list.
  const resumeRequested = useRef(false);
  useEffect(() => {
    if (intent !== 'resume' || resumeRequested.current) return;
    resumeRequested.current = true;
    void resumeRun();
  });

  if (start !== null) {
    return (
      <StandardBoard
        key={runKey}
        start={start}
        notice={notice}
        onExitToModes={onExitToModes}
        onRestart={() => {
          setStart(null);
          setNotice(null);
        }}
        onReloadFromServer={() => {
          void resumeRun();
        }}
      />
    );
  }

  return (
    <StandardSetup
      discipline={filters.discipline}
      examBoard={filters.examBoard}
      difficulty={filters.difficulty}
      loading={loading}
      disciplineLov={disciplineLov}
      examBoardLov={examBoardLov}
      difficultyLov={difficultyLov}
      notice={notice}
      onDisciplineChange={(discipline) => { setFilters((prev) => ({ ...prev, discipline })); }}
      onExamBoardChange={(examBoard) => { setFilters((prev) => ({ ...prev, examBoard })); }}
      onDifficultyChange={(difficulty) => { setFilters((prev) => ({ ...prev, difficulty })); }}
      onBack={onExitToModes}
      onStart={() => { void loadQuestions(); }}
    />
  );
}
