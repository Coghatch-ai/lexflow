// Entry point of the Revisão Espaçada (BR-05, epic #67 slice S2c): the fresh
// ≤5 queue, the REHYDRATION of a saved review, and the empty state. The review
// itself lives in `SpacedBoard`, mounted with a `key` per run so every run gets
// a clean scheduler and a clean draft identity.
//
// Resume NEVER re-queries `questions.reviewQueue` (criterion 5): the due set
// changes as SM-2 advances and as the day passes, so a second query would swap
// the questions out from under the cursor. It replays the frozen `questionIds`
// through `questions.byIds` — which since S2c also returns the SM-2 columns the
// header shows — and re-imposes their order in `resumeSpacedFrom`.

import { useEffect, useRef, useState, type ReactElement } from 'react';
import { useSession } from '../auth';
import { FRESH_READ, trpc } from '../shared/lib/trpc';
import { persistedDraftOf, resumeSpacedFrom } from '@shared/run/run-persistence';
import SpacedBoard from './spaced-board';
import { SpacedEmptyState } from './spaced-screens';
import { toReviewItem, type SpacedRunStart } from './spaced-types';

const DROPPED_NOTICE = 'Algumas questões saíram do catálogo e foram removidas da revisão.';
const ALL_DROPPED_NOTICE =
  'As questões desta revisão saíram do catálogo, então a revisão salva foi descartada.';

interface SpacedRepetitionProps {
  /** `resume` continues the saved review; `new` draws today's queue. */
  intent: 'new' | 'resume';
  onExit: () => void;
}

export default function SpacedRepetition({
  intent,
  onExit,
}: SpacedRepetitionProps): ReactElement {
  const { user } = useSession();
  const reviewQuery = trpc.questions.reviewQueue.useQuery();
  const dueCountQuery = trpc.questions.dueCount.useQuery();
  const utils = trpc.useUtils();
  const discardMutation = trpc.examDrafts.discard.useMutation();

  const [start, setStart] = useState<SpacedRunStart | null>(null);
  const [runKey, setRunKey] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [resuming, setResuming] = useState(intent === 'resume');
  // The intent of the NEXT run, which is not always the one the card asked for:
  // after a resumed review is processed (or when the saved row turned out to be
  // gone) the screen must draw today's queue, not look for a draft again.
  const [runIntent, setRunIntent] = useState<'new' | 'resume'>(intent);

  // A fresh queue: the ≤5 most overdue reviews, mapped once. Never re-mapped
  // against a background refetch — that would reshuffle mid-review.
  useEffect(() => {
    if (!user || runIntent !== 'new' || start !== null || reviewQuery.isFetching) return;
    const data = reviewQuery.data ?? [];
    if (data.length === 0) return;
    setStart({
      questions: data.slice(0, 5).map(toReviewItem),
      cursor: 0,
      answers: [],
      draft: null,
    });
    setRunKey((key) => key + 1);
  }, [user, runIntent, start, reviewQuery.isFetching, reviewQuery.data]);

  const resumeRun = async (): Promise<void> => {
    setResuming(true);
    setNotice(null);
    try {
      // `persistedDraftOf` restores the `| null` this program cannot infer.
      //
      // `FRESH_READ` because this read is also the CONFLICT's "Recarregar do
      // servidor": under the client's 5-minute default it would rehydrate from
      // the same cached copy that produced the conflict, forever.
      const draft = persistedDraftOf(
        await utils.examDrafts.get.fetch({ mode: 'spaced' }, FRESH_READ),
      );
      if (draft === null) {
        // Discarded on another device between the click and this read: fall
        // back to today's queue instead of an empty screen.
        setRunIntent('new');
        return;
      }
      const rows = await utils.questions.byIds.fetch({ ids: draft.questionIds });
      const state = resumeSpacedFrom(draft, rows.map(toReviewItem));
      if (state.discard) {
        // Nothing survived in the catalog: the row cannot be resumed and must
        // not be recorded either (`user_answers` has an FK to `oab_questions`).
        await discardMutation.mutateAsync({ mode: 'spaced' });
        await utils.examDrafts.invalidate();
        setNotice(ALL_DROPPED_NOTICE);
        setRunIntent('new');
        return;
      }
      setNotice(state.dropped > 0 ? DROPPED_NOTICE : null);
      setStart({
        questions: state.questions,
        cursor: state.cursor,
        answers: state.answers,
        draft: { id: draft.id, token: draft.lastSavedAt },
      });
      setRunKey((key) => key + 1);
    } finally {
      setResuming(false);
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
      <SpacedBoard
        key={runKey}
        start={start}
        notice={notice}
        onExitToModes={onExit}
        onRestart={() => {
          // "Recarregar Revisões" / "Descartar o salvo": the next run is always
          // a FRESH queue, even when this one arrived through a resume.
          setStart(null);
          setNotice(null);
          setRunIntent('new');
          void reviewQuery.refetch();
        }}
        onReloadFromServer={() => {
          void resumeRun();
        }}
      />
    );
  }

  if (resuming || reviewQuery.isFetching) {
    return (
      <div className="bg-white rounded-xl p-6 shadow flex items-center justify-center h-48">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#16161a]" />
      </div>
    );
  }

  return (
    <>
      {notice !== null && (
        <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-lg p-3 text-sm mb-4">
          {notice}
        </div>
      )}
      <SpacedEmptyState dueCount={dueCountQuery.data?.count ?? 0} />
    </>
  );
}
