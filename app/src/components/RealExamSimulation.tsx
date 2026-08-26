// Entry point of the Simulado Real (BR-05.5, epic #67 slice S2d): what the
// screen does ON MOUNT, the draw of a fresh exam, and the settlement of one
// that ended while the student was away. The exam itself lives in
// `RealExamBoard`, mounted with a `key` per run so every run gets a clean
// scheduler and a clean draft identity.
//
// The mount decision is `realMountDecision` — pure, shared with the server's
// own `isRealRunAbandoned`, and NEVER an offer to continue (BR-05.5). The three
// answers are: setup card, rehydrate the tab that owns the exam, or settle.
//
// Rehydration replays the FROZEN `questionIds` through `questions.byIds`.
// `questions.list` must never be re-queried here: it orders by `random()`, so
// it would swap the 80 questions out from under a student mid-exam.
//
// "Iniciar Simulado Real" calls `examDrafts.startReal` BEFORE drawing. That
// settles any pending real exam with `force` — the prova real has no `discard`
// door (BR-05.5) — and without it the first save of the new run, which carries
// `token: null`, would hit the OVERWRITE_CONFLICT guard and the student would
// be stuck with no way forward.

import { useEffect, useRef, useState, useCallback, type ReactElement } from 'react';
import { FRESH_READ, trpc } from '../shared/lib/trpc';
import { persistedDraftOf, resumeRealFrom } from '../shared/lib/run-persistence';
import {
  REAL_EXAM_DURATION_SECONDS,
  realMountDecision,
} from '@shared/domain/exam-draft';
import ExamSetup from './real-exam-setup';
import RealExamBoard from './real-exam-board';
import { QUESTIONS_PER_EXAM, toExamQuestion, type RealRunStart } from './real-exam-types';

/**
 * BR-05.5 in one line: the exam simply ENDED. There is no result screen to
 * come back to (reading a finished session's answers back is a slice of its
 * own), so the student is told where the result went and offered a new exam.
 *
 * Best-effort by design: it is only shown when THIS mount's `processReal` was
 * the one that settled the run. When `users.me` already settled it during the
 * app's boot, the setup card is silent — which is still honest.
 */
const SETTLED_NOTICE =
  'Sua prova real anterior foi encerrada e as respostas foram processadas. O resultado está no seu histórico.';

/** A CONFLICT mid-exam: the run was already ended somewhere else. */
const ELSEWHERE_NOTICE =
  'Esta prova real já havia sido encerrada e processada em outro lugar. O resultado está no seu histórico.';

/** Nothing of the saved exam survived in the catalog. */
const ALL_DROPPED_NOTICE =
  'As questões da sua prova real anterior saíram do catálogo, então ela foi encerrada.';

export default function RealExamSimulation({ onExit }: { onExit: () => void }): ReactElement {
  const utils = trpc.useUtils();
  const startRealMutation = trpc.examDrafts.startReal.useMutation();
  const processRealMutation = trpc.examDrafts.processReal.useMutation();

  const [start, setStart] = useState<RealRunStart | null>(null);
  const [runKey, setRunKey] = useState(0);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);

  const backToSetup = useCallback((why: string | null): void => {
    setStart(null);
    setNotice(why);
  }, []);

  const onSettledElsewhere = useCallback((): void => {
    backToSetup(ELSEWHERE_NOTICE);
  }, [backToSetup]);

  /** Rehydrates the tab that OWNS the exam (a reload), or falls back to setup. */
  const rehydrate = async (draft: NonNullable<ReturnType<typeof persistedDraftOf>>): Promise<void> => {
    const rows = await utils.questions.byIds.fetch({ ids: draft.questionIds });
    const state = resumeRealFrom(draft, rows.map(toExamQuestion));
    if (state.discard || state.deadlineAt === null) {
      // Nothing left to run: `user_answers` has an FK to `oab_questions`, so a
      // queue with no survivors can neither be resumed nor recorded. The next
      // `startReal` clears the row with `force`.
      backToSetup(state.discard ? ALL_DROPPED_NOTICE : null);
      return;
    }
    setNotice(null);
    setStart({
      questions: state.questions,
      cursor: state.cursor,
      answers: state.answers,
      deadlineAt: state.deadlineAt,
      draft: { id: draft.id, token: draft.lastSavedAt },
    });
    setRunKey((key) => key + 1);
  };

  const decideOnMount = async (): Promise<void> => {
    setLoading(true);
    try {
      // FRESH_READ: this read decides whether an exam is still running, and the
      // client's 5-minute default would answer it from a cached copy.
      const draft = persistedDraftOf(
        await utils.examDrafts.get.fetch({ mode: 'real' }, FRESH_READ),
      );
      const decision = realMountDecision({ draft, now: new Date().toISOString() });
      if (decision === 'start') return;
      if (decision === 'resume' && draft !== null) {
        await rehydrate(draft);
        return;
      }
      const settled = await processRealMutation.mutateAsync();
      await utils.examDrafts.invalidate();
      void utils.stats.invalidate();
      void utils.sessions.invalidate();
      // `settled: false` means someone else got there first (`users.me` at
      // boot, another tab): the exam still ended, so no second announcement.
      setNotice(settled.settled ? SETTLED_NOTICE : null);
    } finally {
      setLoading(false);
    }
  };

  // No dependency array by design (same pattern as `useRegisterRun`): the ref
  // is what makes it run exactly once, without a hand-maintained dep list.
  const decidedRef = useRef(false);
  useEffect(() => {
    if (decidedRef.current) return;
    decidedRef.current = true;
    void decideOnMount();
  });

  const startExam = async (): Promise<void> => {
    setLoading(true);
    try {
      // BEFORE the draw, always — including through "Fazer Outro Simulado Real".
      await startRealMutation.mutateAsync();
      await utils.examDrafts.invalidate();
      void utils.stats.invalidate();
      void utils.sessions.invalidate();
      const rows = await utils.questions.list.fetch({ limit: QUESTIONS_PER_EXAM, phase: '1st' });
      setNotice(null);
      setStart({
        questions: rows.map(toExamQuestion),
        cursor: 0,
        answers: [],
        // Minted here and persisted by the board's first save. From then on the
        // clock is the SERVER's copy of this instant (D8).
        deadlineAt: new Date(Date.now() + REAL_EXAM_DURATION_SECONDS * 1000).toISOString(),
        draft: null,
      });
      setRunKey((key) => key + 1);
    } finally {
      setLoading(false);
    }
  };

  if (start !== null) {
    return (
      <RealExamBoard
        key={runKey}
        start={start}
        onExitToModes={onExit}
        onRestart={() => {
          backToSetup(null);
        }}
        onSettledElsewhere={onSettledElsewhere}
      />
    );
  }

  return (
    <ExamSetup
      loading={loading}
      notice={notice}
      onStart={() => {
        void startExam();
      }}
    />
  );
}
