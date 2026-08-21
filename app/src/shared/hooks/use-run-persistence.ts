// app/src/shared/hooks/use-run-persistence.ts
//
// The plumbing that keeps an in-flight run on the server (BR-05, epic #67 slice
// S2b): the debounce, the tRPC calls, the two refs that hold the draft's
// identity, and the `pagehide` best-effort. Slices #78 and #79 reuse THIS hook.
//
// It decides nothing. Every rule lives in the two pure modules it wraps —
// `../lib/save-scheduler` (cadence) and `../lib/run-persistence` (payload,
// claim, conflict copies) — which is what keeps the rules testable with plain
// vitest and this file free of anything worth arguing about.
//
// `draftId` and `token` are REFS, never state: they change on every save, they
// paint nothing, and a state update per save would re-render the whole test
// tree and open a stale-closure window between the save and the recording.

import { useEffect, useRef, useState, type MutableRefObject } from "react";
import { trpc } from "../lib/trpc";
import { createSaveScheduler, type SaveScheduler } from "../lib/save-scheduler";
import {
  claimFor,
  conflictFor,
  isConflictError,
  persistedDraftOf,
  standardDraftPayload,
  type DraftClaim,
  type RunConflict,
  type StandardRunState,
} from "../lib/run-persistence";

/** What an exit handler needs before it may record or navigate. */
export interface FlushOutcome {
  /** False = CONFLICT: record NOTHING and leave the run on screen. */
  ok: boolean;
  /** The `{ id, lastSavedAt }` pair — undefined if never persisted. */
  claim: DraftClaim | undefined;
}

export interface RunPersistence {
  /** An answer was confirmed — arm the trailing debounce. */
  scheduleSave: () => void;
  /** Land everything pending, then hand back the claim built on the FINAL token. */
  flush: () => Promise<FlushOutcome>;
  /** The conflict dialog the screen must render, or null. */
  conflict: RunConflict | null;
  /** Take ownership of the row a resume rehydrated from. */
  adopt: (draftId: string, token: string) => void;
  /** The run left this tab (processed, saved-and-exited, discarded). */
  close: () => void;
  /** "Descartar o salvo" — drops the server's row for this mode. */
  discardSaved: () => Promise<void>;
  /** Surface a CONFLICT raised by a call this hook did not make. */
  reportError: (error: unknown) => void;
}

/** The mutable identity of the run being persisted, shared with the helpers. */
interface PersistenceRefs {
  draftId: MutableRefObject<string | null>;
  token: MutableRefObject<string | null>;
  /** Whether the FAILING save carried a token — picks the conflict copy. */
  hadToken: MutableRefObject<boolean>;
  send: MutableRefObject<() => Promise<string>>;
  scheduler: MutableRefObject<SaveScheduler<string> | null>;
  setConflict: (conflict: RunConflict | null) => void;
}

/**
 * Only the optimistic guard stops the autosave. A network blip must be retried
 * by the next answer's debounce — treating it as a lost race would end the
 * persistence of a run that is perfectly fine.
 */
function raiseIfConflict(refs: PersistenceRefs, error: unknown): void {
  if (!isConflictError(error)) return;
  refs.scheduler.current?.close();
  refs.setConflict(conflictFor(refs.hadToken.current));
}

function schedulerOf(refs: PersistenceRefs): SaveScheduler<string> {
  const existing = refs.scheduler.current;
  if (existing !== null) return existing;
  const created = createSaveScheduler<string>({
    send: () => refs.send.current(),
    onError: (error) => {
      raiseIfConflict(refs, error);
    },
  });
  refs.scheduler.current = created;
  return created;
}

function forgetIdentity(refs: PersistenceRefs): void {
  refs.draftId.current = null;
  refs.token.current = null;
}

async function flushRun(refs: PersistenceRefs): Promise<FlushOutcome> {
  const result = await schedulerOf(refs).flush();
  if (!result.ok) return { ok: false, claim: undefined };
  // The claim is built on the token the flush LANDED with, never on the one
  // the screen was holding when the student clicked.
  return { ok: true, claim: claimFor(refs.draftId.current, refs.token.current) };
}

/** The run as the SCREEN knows it — the token is the hook's business, not its. */
export type RunSnapshot = Omit<StandardRunState, "token">;

/**
 * @param snapshot Reads the CURRENT run off the screen. Called at send time, so
 *   the write always carries the newest state and never a captured copy.
 */
export function useRunPersistence(snapshot: () => RunSnapshot | null): RunPersistence {
  const utils = trpc.useUtils();
  const saveMutation = trpc.examDrafts.save.useMutation();
  const discardMutation = trpc.examDrafts.discard.useMutation();
  const [conflict, setConflict] = useState<RunConflict | null>(null);

  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;

  // Each `useRef` on its own line, at the top level of the hook: the ref
  // OBJECTS are stable, so the container rebuilt every render still points at
  // the same cells the scheduler's closure captured on the first one.
  const draftIdRef = useRef<string | null>(null);
  const tokenRef = useRef<string | null>(null);
  const hadTokenRef = useRef(false);
  const sendRef = useRef<() => Promise<string>>(() => Promise.resolve(""));
  const schedulerRef = useRef<SaveScheduler<string> | null>(null);
  const refs: PersistenceRefs = {
    draftId: draftIdRef,
    token: tokenRef,
    hadToken: hadTokenRef,
    send: sendRef,
    scheduler: schedulerRef,
    setConflict,
  };

  refs.send.current = async (): Promise<string> => {
    const run = snapshotRef.current();
    if (run === null) return refs.token.current ?? "";
    refs.hadToken.current = refs.token.current !== null;
    const saved = await saveMutation.mutateAsync(
      standardDraftPayload({ ...run, token: refs.token.current }),
    );
    // Written the instant the mutation resolves, verbatim.
    refs.token.current = saved.lastSavedAt;
    // `save` returns the token but not the row id, and `sessions.record` needs
    // BOTH. One extra read per run, right after the insert that created it.
    if (refs.draftId.current === null) {
      const row = persistedDraftOf(await utils.examDrafts.get.fetch({ mode: "standard" }));
      if (row !== null) refs.draftId.current = row.id;
    }
    return saved.lastSavedAt;
  };

  const scheduler = schedulerOf(refs);

  // Closing the tab is honestly BEST-EFFORT: `httpBatchLink` builds the auth
  // header from Clerk's async `getToken()` and does not use `keepalive`, and
  // `sendBeacon` cannot carry Authorization. The real guarantee behind
  // criterion 1 is the 1500 ms debounce having already landed — nobody closes
  // a tab faster than that after answering.
  useEffect(() => {
    const onHide = (): void => {
      void scheduler.flush();
    };
    const onVisibility = (): void => {
      if (document.visibilityState === "hidden") onHide();
    };
    window.addEventListener("pagehide", onHide);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("pagehide", onHide);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [scheduler]);

  return {
    scheduleSave: (): void => {
      schedulerOf(refs).schedule();
    },
    flush: (): Promise<FlushOutcome> => flushRun(refs),
    conflict,
    adopt: (draftId: string, token: string): void => {
      refs.draftId.current = draftId;
      refs.token.current = token;
    },
    close: (): void => {
      refs.scheduler.current?.close();
      forgetIdentity(refs);
    },
    discardSaved: async (): Promise<void> => {
      await discardMutation.mutateAsync({ mode: "standard" });
      await utils.examDrafts.list.invalidate();
      forgetIdentity(refs);
      setConflict(null);
    },
    reportError: (error: unknown): void => {
      raiseIfConflict(refs, error);
    },
  };
}
