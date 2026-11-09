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

// BR-06.3 runs "with what exists" — and 0 is the extreme of "what exists". A
// filter set that matches nothing (a thin topic plus Banca/Dificuldade, or a
// saved topic whose rows have since left the catalog) keeps the SETUP screen
// with this notice: the board renders a question card and would dereference a
// question that is not there.
const EMPTY_DRAW_NOTICE =
  'Nenhuma questão encontrada com esses filtros. Ajuste a disciplina, o tema, a banca ou a dificuldade e tente novamente.';

const NO_FILTERS: StandardFilters = { discipline: '', examBoard: '', difficulty: '', topic: '' };

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

  // BR-06: the topics of the chosen discipline, derived from the catalog.
  // `enabled` keeps it off while Disciplina is Todas — the query takes one
  // discipline, and the Tema select is disabled in that state anyway.
  const topicsQuery = trpc.questions.topics.useQuery(
    { discipline: filters.discipline },
    { enabled: filters.discipline !== '' },
  );
  const topics = topicsQuery.data ?? [];

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
        // BR-06: a HARD filter. The draw stays at 10 and simply comes back
        // short when the topic holds fewer — no top-up from other topics.
        topic: filters.topic !== '' ? filters.topic : undefined,
        limit: 10,
      });
      // An empty draw is a legitimate outcome of a HARD filter, not an error:
      // stay on the setup screen and say so, never start a run with no queue.
      if (rows.length === 0) {
        setNotice(EMPTY_DRAW_NOTICE);
        return;
      }
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
        // BR-06: a resumed run keeps its topic. The queue itself is the frozen
        // `questionIds` (BR-05) — this only puts the filter back on the screen.
        topic: state.setup.topic ?? '',
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
      topic={filters.topic}
      topics={topics}
      loading={loading}
      disciplineLov={disciplineLov}
      examBoardLov={examBoardLov}
      difficultyLov={difficultyLov}
      notice={notice}
      // A topic belongs to ONE discipline: changing the discipline drops it,
      // or the next draw would filter on a topic the new discipline has not.
      onDisciplineChange={(discipline) => { setFilters((prev) => ({ ...prev, discipline, topic: '' })); }}
      onExamBoardChange={(examBoard) => { setFilters((prev) => ({ ...prev, examBoard })); }}
      onDifficultyChange={(difficulty) => { setFilters((prev) => ({ ...prev, difficulty })); }}
      onTopicChange={(topic) => { setFilters((prev) => ({ ...prev, topic })); }}
      onBack={onExitToModes}
      onStart={() => { void loadQuestions(); }}
    />
  );
}
