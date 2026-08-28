// Entry point of the Simulado Adaptativo (BR-05, epic #67 slice S2c): the setup
// step, the first draw, and the REHYDRATION of a saved simulado. The run itself
// lives in `AdaptiveBoard`, mounted with a `key` per run so every run gets a
// clean scheduler and a clean draft identity.
//
// A resume SKIPS the setup screen — the setup is exactly what a resume replays
// — and re-draws the candidate pool from the persisted filters. The served
// list, its cursor, the ladder and the deferred FIFO come from the draft, never
// from a fresh draw: `questions.list` orders by random().

import { useEffect, useRef, useState, type ReactElement } from 'react';
import { FRESH_READ, trpc } from '../shared/lib/trpc';
import { useLov } from '../shared/hooks/use-lov';
import { persistedDraftOf, resumeAdaptiveFrom } from '../shared/lib/run-persistence';
import AdaptiveBoard from './adaptive-board';
import { mapAdaptiveRows } from './adaptive-pool';
import { AdaptiveSetup, type AdaptiveQuestion } from './adaptive-screens';
import { INITIAL_ADAPTIVE, type AdaptiveRunStart } from './adaptive-types';

const DROPPED_NOTICE = 'Algumas questões saíram do catálogo e foram removidas do simulado.';
const ALL_DROPPED_NOTICE =
  'As questões deste simulado saíram do catálogo, então o simulado salvo foi descartado.';

interface AdaptiveSimulationProps {
  /** `resume` continues the saved simulado; `new` starts from the setup. */
  intent: 'new' | 'resume';
  onExit: () => void;
}

export default function AdaptiveSimulation({
  intent,
  onExit,
}: AdaptiveSimulationProps): ReactElement {
  const disciplineLov = useLov('DISCIPLINE');
  const utils = trpc.useUtils();
  const discardMutation = trpc.examDrafts.discard.useMutation();

  const [selectedDiscipline, setSelectedDiscipline] = useState('');
  const [totalQuestions, setTotalQuestions] = useState(10);
  const [start, setStart] = useState<AdaptiveRunStart | null>(null);
  const [runKey, setRunKey] = useState(0);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  /** The candidate pool for `discipline` — always freshly drawn (D8). */
  const drawPool = async (discipline: string): Promise<AdaptiveQuestion[]> => {
    const rows = await utils.questions.list.fetch({
      discipline: discipline !== '' ? discipline : undefined,
      limit: 100,
      phase: '1st',
    });
    return mapAdaptiveRows(rows);
  };

  const startSimulation = async (): Promise<void> => {
    setLoading(true);
    setNotice(null);
    try {
      const pool = await drawPool(selectedDiscipline);
      const first = pool.find((q) => q.difficulty === 'medium') ?? pool.at(0);
      if (first === undefined) return;
      setStart({
        pool,
        questions: [first],
        cursor: 0,
        deferred: [],
        answers: [],
        adaptive: { ...INITIAL_ADAPTIVE, difficultyHistory: ['medium'] },
        setup: { discipline: selectedDiscipline, totalQuestions },
        elapsedSeconds: 0,
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
      // `persistedDraftOf` restores the `| null` this program cannot infer.
      //
      // `FRESH_READ` because this read is also the CONFLICT's "Recarregar do
      // servidor": under the client's 5-minute default it would rehydrate from
      // the same cached copy that produced the conflict, forever.
      const draft = persistedDraftOf(
        await utils.examDrafts.get.fetch({ mode: 'adaptive' }, FRESH_READ),
      );
      if (draft === null) return;
      const rows = await utils.questions.byIds.fetch({ ids: draft.questionIds });
      const state = resumeAdaptiveFrom(draft, mapAdaptiveRows(rows));
      if (state.discard) {
        // Nothing survived in the catalog: the row cannot be resumed and must
        // not be recorded either (`user_answers` has an FK to `oab_questions`).
        await discardMutation.mutateAsync({ mode: 'adaptive' });
        await utils.examDrafts.invalidate();
        setNotice(ALL_DROPPED_NOTICE);
        return;
      }
      setSelectedDiscipline(state.setup.discipline);
      setTotalQuestions(state.setup.totalQuestions);
      setNotice(state.dropped > 0 ? DROPPED_NOTICE : null);
      setStart({
        pool: await drawPool(state.setup.discipline),
        questions: state.questions,
        cursor: state.cursor,
        deferred: state.deferred,
        answers: state.answers,
        adaptive: state.adaptive,
        setup: state.setup,
        elapsedSeconds: state.elapsedSeconds,
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
      <AdaptiveBoard
        key={runKey}
        start={start}
        notice={notice}
        onExitToModes={onExit}
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
    <>
      {notice !== null && (
        <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-lg p-3 text-sm mb-4">
          {notice}
        </div>
      )}
      <AdaptiveSetup
        selectedDiscipline={selectedDiscipline}
        totalQuestions={totalQuestions}
        loading={loading}
        disciplineOptions={disciplineLov.options}
        onDisciplineChange={setSelectedDiscipline}
        onTotalQuestionsChange={setTotalQuestions}
        onStart={() => { void startSimulation(); }}
      />
    </>
  );
}
