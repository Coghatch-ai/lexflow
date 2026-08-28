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
//
// Because `startReal` is destructive, NEITHER entry may fail in silence. Both
// are imperative (`utils.*.fetch` / `mutateAsync`), so nothing renders an error
// for them; a rejected `examDrafts.get` used to land on the setup card, which
// is the same pixels as "no pending exam" and puts that force-settle one click
// away. Every failure here becomes a `RealFailure` and its own screen
// (`real-exam-failures.ts` owns the rule and the copy).

import { useEffect, useRef, useState, useCallback, type ReactElement } from 'react';
import { FRESH_READ, trpc } from '../shared/lib/trpc';
import {
  persistedDraftOf,
  resumeRealFrom,
  type RunConflictKind,
} from '@shared/run/run-persistence';
import { REAL_EXAM_DURATION_SECONDS, realMountDecision } from '@shared/domain/exam-draft';
import ExamSetup from './real-exam-setup';
import RealExamBoard from './real-exam-board';
import RealExamFailureCard from './real-exam-failure-card';
import {
  realConflictNotice,
  realFailure,
  realScreen,
  realStartFailureKind,
  retryActionFor,
  type RealFailure,
} from './real-exam-failures';
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
  const [failure, setFailure] = useState<RealFailure | null>(null);

  const backToSetup = useCallback((why: string | null): void => {
    setStart(null);
    setNotice(why);
  }, []);

  // A CONFLICT ended this tab's exam. The copy comes from the conflict's KIND:
  // a `live` one is a prova real still RUNNING somewhere else, and the old
  // single line announced it as "encerrada e processada" — sending the student
  // to a histórico with nothing in it, for an exam still on the clock.
  const onSettledElsewhere = useCallback(
    (kind: RunConflictKind): void => {
      backToSetup(realConflictNotice(kind));
    },
    [backToSetup],
  );

  /** Rehydrates the tab that OWNS the exam (a reload), or falls back to setup. */
  const rehydrate = async (
    draft: NonNullable<ReturnType<typeof persistedDraftOf>>,
  ): Promise<void> => {
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
    setFailure(null);
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
    } catch {
      // The decision could NOT be taken. Never the setup card: that card reads
      // as "no pending exam" and its button force-settles the exam we just
      // failed to look for.
      setNotice(null);
      setFailure(realFailure('mount'));
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
    setFailure(null);
    // Load-bearing for HONESTY, not for control flow: once `startReal` has
    // resolved, any pending prova real is already settled, so a failure after
    // this point may not tell the student "nothing was changed".
    let startRealDone = false;
    try {
      // BEFORE the draw, always — including through "Fazer Outro Simulado Real".
      await startRealMutation.mutateAsync();
      startRealDone = true;
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
    } catch {
      setNotice(null);
      setFailure(realFailure(realStartFailureKind(startRealDone)));
    } finally {
      setLoading(false);
    }
  };

  const screen = realScreen({ started: start !== null, failure });

  if (screen === 'exam' && start !== null) {
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

  if (screen === 'failure' && failure !== null) {
    return (
      <RealExamFailureCard
        failure={failure}
        busy={loading}
        onRetry={() => {
          if (retryActionFor(failure.kind) === 'decide') void decideOnMount();
          else void startExam();
        }}
        onExit={onExit}
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
