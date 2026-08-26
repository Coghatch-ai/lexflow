// app/src/shared/hooks/use-run-persistence.ts
//
// The plumbing that keeps an in-flight run on the server (BR-05, epic #67 slice
// S2b): the debounce, the tRPC calls, the two refs that hold the draft's
// identity, and the `pagehide` exit write (`keepalive`, and what it still
// cannot promise — see the effect at the bottom).
//
// PARAMETRIC in the mode since S2c (#78): the three study screens share this
// one hook. It was `"standard"` in three literal places (the `get` that learns
// the id back, the payload builder, the `discard`), which is exactly what made
// "just reuse the hook" impossible — the mode is now an argument and the
// payload comes from the screen's own snapshot.
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
import { FRESH_READ, exitTrpcClient, trpc } from "../lib/trpc";
import { exitTransportFor } from "../lib/exit-save";
import { createSaveScheduler, type SaveScheduler } from "../lib/save-scheduler";
import {
  adoptableDraftId,
  claimOutcomeFor,
  conflictFor,
  isConflictError,
  persistedDraftOf,
  runSaveFailure,
  saveFailureFor,
  type DraftClaim,
  type PersistedDraft,
  type RunConflict,
  type RunDraftPayload,
  type RunSaveFailure,
} from "../lib/run-persistence";
import {
  claimlessVerdictFor,
  clearPendingEchoes,
  createPendingEchoes,
  needsClaimlessProbe,
  rememberPendingEcho,
  saveRun,
  type PendingEchoes,
  type SaveRunIO,
} from "../lib/run-claimless";
import type { RunMode } from "@shared/domain/exam-draft";

/** What an exit handler needs before it may record or navigate. */
export interface FlushOutcome {
  /**
   * False = record NOTHING and leave the run on screen. Either a CONFLICT (its
   * own dialog) or a failure the student was just told about — never silence.
   */
  ok: boolean;
  /** The `{ id, lastSavedAt }` pair — undefined if never persisted. */
  claim: DraftClaim | undefined;
}

export interface RunPersistence {
  /** An answer was confirmed — arm the trailing debounce. */
  scheduleSave: () => void;
  /**
   * The prova real's 60 s heartbeat (BR-05.5, slice S2d) — `examDrafts.touch`,
   * one column, no jsonb rewrite. The INTERVAL belongs to the screen; this is
   * only the beat itself. A no-op before the run has a token (nothing to
   * refresh yet) and skipped by the scheduler whenever a save already did the
   * job. Every other mode simply never calls it.
   */
  beat: () => Promise<void>;
  /** Land everything pending, then hand back the claim built on the FINAL token. */
  flush: () => Promise<FlushOutcome>;
  /** The conflict dialog the screen must render, or null. */
  conflict: RunConflict | null;
  /** The failure message the screen must render after a failed EXIT, or null. */
  failure: RunSaveFailure | null;
  /** The student read the failure message — closing it is the retry. */
  dismissFailure: () => void;
  /** Take ownership of the row a resume rehydrated from. */
  adopt: (draftId: string, token: string) => void;
  /** The run left this tab (processed, saved-and-exited, discarded). */
  close: () => void;
  /** "Descartar o salvo" — drops the server's row for this mode. */
  discardSaved: () => Promise<void>;
  /**
   * An exit was asked for while one is already in flight. Says so out loud
   * instead of answering `false` in silence — the sidebar guard's `save()` can
   * land during the final flush of "Próxima", and the student clicked into
   * nothing until this existed.
   */
  reportBusy: () => void;
  /**
   * Surface an error raised by a call this hook did not make (the recording
   * itself): a CONFLICT as its dialog, anything else as a failure message.
   */
  reportError: (error: unknown) => void;
}

/** The mutable identity of the run being persisted, shared with the helpers. */
interface PersistenceRefs {
  draftId: MutableRefObject<string | null>;
  token: MutableRefObject<string | null>;
  /** Whether the FAILING save carried a token — picks the conflict copy. */
  hadToken: MutableRefObject<boolean>;
  /**
   * The echoes of this run's claimless writes with an unknown outcome, so a
   * commit that lands LATE is still recognisable as ours on a later attempt
   * (`run-claimless.ts`). A ref, and cleared with the identity: it must outlive
   * one save and die with the run.
   */
  pendingEchoes: MutableRefObject<PendingEchoes>;
  send: MutableRefObject<() => Promise<string>>;
  /** The same save over a transport that survives the tab (`exit-save.ts`). */
  exitSend: MutableRefObject<() => Promise<string>>;
  /** Refreshes the token without rewriting the payload (`examDrafts.touch`). */
  keepAlive: MutableRefObject<() => Promise<string>>;
  /** Reads the row id back from the server; resolves even when it cannot. */
  learnDraftId: MutableRefObject<() => Promise<void>>;
  /**
   * Does a row for this mode exist on the server RIGHT NOW? Unlike
   * `learnDraftId` this asks about EXISTENCE, not ownership, and it reports
   * whether the read happened (`read: false` = we do not know).
   */
  probeRow: MutableRefObject<() => Promise<{ read: boolean; row: PersistedDraft | null }>>;
  scheduler: MutableRefObject<SaveScheduler<string> | null>;
  setConflict: (conflict: RunConflict | null) => void;
  setFailure: (failure: RunSaveFailure | null) => void;
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

/**
 * A CONFLICT gets its dialog; anything else gets a message. The BACKGROUND
 * autosave stays silent on purpose (the next debounce retries it) — this runs
 * only where the student is waiting on an exit and nothing else would move.
 */
function raiseFailure(refs: PersistenceRefs, error: unknown): void {
  if (isConflictError(error)) {
    raiseIfConflict(refs, error);
    return;
  }
  refs.setFailure(saveFailureFor(error));
}

/**
 * The heartbeat itself (`examDrafts.touch`), and THE carried debt it pays
 * (answering-surfaces.md): `touch` moves `last_saved_at` exactly like `save`
 * does, so a caller that does not write the new token back leaves the run
 * holding a token the row no longer has — and the very next save or claim
 * matches 0 rows and hands the student a CONFLICT caused by their own
 * heartbeat. Out here rather than inside the hook so the debt is stated once,
 * where it is paid.
 */
function keepAliveVia(
  refs: PersistenceRefs,
  mode: RunMode,
  touch: (input: { mode: RunMode; token: string }) => Promise<{ lastSavedAt: string }>,
): () => Promise<string> {
  return async (): Promise<string> => {
    const token = refs.token.current;
    if (token === null) return "";
    // A touch carries a token by definition, so a CONFLICT raised by it is
    // always the "continued elsewhere" flavour.
    refs.hadToken.current = true;
    const beaten = await touch({ mode, token });
    refs.token.current = beaten.lastSavedAt;
    return beaten.lastSavedAt;
  };
}

/**
 * The normal save: the payload the screen holds right now, through the
 * lost-response recovery (`saveRun`), with the row id learned back once.
 *
 * Out here rather than inline in the hook so it sits beside its exit twin
 * below — the two differ in exactly the round trips an unload cannot afford,
 * and that difference is the point.
 */
function sendVia(
  refs: PersistenceRefs,
  snapshotRef: MutableRefObject<RunSnapshot>,
  io: SaveRunIO,
): () => Promise<string> {
  return async (): Promise<string> => {
    const payload = snapshotRef.current(refs.token.current);
    if (payload === null) return refs.token.current ?? "";
    refs.hadToken.current = refs.token.current !== null;
    // `saveRun`, not the mutation directly: a FIRST save whose response is lost
    // still created the row, and retrying it as another `token: null` is what
    // the router answers with OVERWRITE_CONFLICT forever (#79). It probes and
    // adopts the row only when that row is a verbatim echo of what we sent.
    //
    // It also BOUNDS the write (`SAVE_TIMEOUT_MS`), which is why `token` can no
    // longer stay null after a save that stalled and landed anyway: the timeout
    // is handled by the same probe, against this same `payload`, while it is
    // still the payload the server was given. A bound applied from outside
    // (`save-scheduler`'s dispatch) could only report the failure — by the next
    // attempt the payload has moved and nothing can prove the row is ours.
    const saved = await saveRun(payload, io, refs.pendingEchoes.current);
    // Written the instant the mutation resolves, verbatim.
    refs.token.current = saved.lastSavedAt;
    // An adopted row comes WITH its id, so the read below is already paid for.
    if (saved.draftId !== null) refs.draftId.current = saved.draftId;
    // Adopted through a PENDING echo: the row is ours, but it holds the payload
    // of an earlier attempt — the answers of THIS send are not on the server.
    // Re-arm the debounce so the next write (now carrying the token, so an
    // UPDATE) delivers them. Reporting this as landed would break the `ok: true`
    // contract `flush` gives the deadline door, which is the failure that put
    // the review screen over answers living only in the tab.
    if (saved.owed) refs.scheduler.current?.schedule();
    // One extra read per run, right after the insert that created it. It is
    // best-effort HERE (the save itself already landed); the exit path tries
    // again and refuses to record without it.
    if (refs.draftId.current === null) await refs.learnDraftId.current();
    return saved.lastSavedAt;
  };
}

/**
 * The save issued while the tab is being destroyed (Codex adversarial review of
 * #79). Same payload as `send`, deliberately WITHOUT its two extra round trips:
 *
 * - no `saveRun` probe — the lost-response recovery is a second request that
 *   cannot happen during an unload, and on a tab that survives the failure
 *   re-arms `dirty` so the next normal save recovers exactly as before;
 * - no `learnDraftId` — the id matters to `sessions.record`, and this write
 *   exists precisely because nobody is left to record anything here.
 *
 * The transport is picked per payload (`exitTransportFor`): `keepalive` while
 * the body fits the browser's 64 KiB cap, the normal client otherwise.
 */
function exitSendVia(
  refs: PersistenceRefs,
  snapshotRef: MutableRefObject<RunSnapshot>,
  save: (input: RunDraftPayload) => Promise<{ lastSavedAt: string }>,
): () => Promise<string> {
  return async (): Promise<string> => {
    const payload = snapshotRef.current(refs.token.current);
    if (payload === null) return refs.token.current ?? "";
    const claimless = refs.token.current === null;
    refs.hadToken.current = !claimless;
    let saved: { lastSavedAt: string };
    try {
      saved = await save(payload);
    } catch (error: unknown) {
      // A `keepalive` write is finished by the browser AFTER the document is
      // gone, so a claimless exit write whose answer we never saw is the same
      // late commit `saveRun` recovers from — and on a tab that SURVIVES
      // (`visibilitychange`), the next normal save is the one that would meet
      // that row and be told it is foreign. Remembering the echo here is what
      // lets it be recognised; a CONFLICT is excluded for the usual reason (the
      // server answered that this payload wrote nothing).
      if (claimless && !isConflictError(error)) {
        rememberPendingEcho(refs.pendingEchoes.current, payload);
      }
      throw error;
    }
    // Written the moment it lands — a tab that SURVIVES (a mere
    // `visibilitychange`) must not keep the token this write just superseded.
    refs.token.current = saved.lastSavedAt;
    clearPendingEchoes(refs.pendingEchoes.current);
    return saved.lastSavedAt;
  };
}

/** One `examDrafts.get` for this run's mode, honest about `null`. */
type ReadRow = () => Promise<PersistedDraft | null>;

/**
 * `save` returns the token but not the row id, and `sessions.record` needs
 * BOTH. Swallows its own failure: the id is retried right before it is actually
 * needed (`flushRun`), and a background save must not die for it.
 *
 * `adoptableDraftId` is the second half — it only takes an id off a row that
 * still carries the token this tab just wrote.
 */
function learnDraftIdVia(refs: PersistenceRefs, readRow: ReadRow): () => Promise<void> {
  return async (): Promise<void> => {
    try {
      const id = adoptableDraftId(await readRow(), refs.token.current);
      if (id !== null) refs.draftId.current = id;
    } catch {
      // Left null on purpose — `flushRun` decides what a missing id means.
    }
  };
}

/**
 * EXISTENCE, not ownership: "is there a row for this mode?", even when the row
 * carries a token this tab never saw — which is precisely the orphan case
 * (`needsClaimlessProbe`). It reports whether the read HAPPENED, because
 * fail-closed needs to tell "no row" apart from "did not find out".
 */
function probeRowVia(
  readRow: ReadRow,
): () => Promise<{ read: boolean; row: PersistedDraft | null }> {
  return async (): Promise<{ read: boolean; row: PersistedDraft | null }> => {
    try {
      return { read: true, row: await readRow() };
    } catch {
      return { read: false, row: null };
    }
  };
}

function schedulerOf(refs: PersistenceRefs): SaveScheduler<string> {
  const existing = refs.scheduler.current;
  if (existing !== null) return existing;
  const created = createSaveScheduler<string>({
    send: () => refs.send.current(),
    keepAlive: () => refs.keepAlive.current(),
    exitSend: () => refs.exitSend.current(),
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
  // The echoes belong to the run that just left this tab: kept, they would be
  // offered as proof of ownership over a row the NEXT run wrote.
  clearPendingEchoes(refs.pendingEchoes.current);
}

/**
 * The prova real's last check before a CLAIMLESS recording (audit of #79).
 * "No token" means no save resolved here — it does NOT mean no row exists, and
 * an orphan row plus a claimless session is exactly the double-settlement this
 * slice forbids. `claimlessVerdictFor` owns the rule; this only fetches.
 */
async function claimlessFlush(refs: PersistenceRefs): Promise<FlushOutcome> {
  const probe = await refs.probeRow.current();
  const verdict = claimlessVerdictFor(probe);
  if (verdict === "record") return { ok: true, claim: undefined };
  if (verdict === "conflict") {
    // Terminal, exactly like a CONFLICT raised by the save: the row is on the
    // server and the server settles it. The real board turns this into "já
    // havia sido encerrada em outro lugar"; nothing is written here.
    refs.scheduler.current?.close();
    refs.setConflict(conflictFor(refs.hadToken.current));
    return { ok: false, claim: undefined };
  }
  // Could not read: we do not know, so we do not write. Closing the message
  // is the retry, and the run is still on screen.
  refs.setFailure(runSaveFailure("claim"));
  return { ok: false, claim: undefined };
}

async function flushRun(refs: PersistenceRefs, mode: RunMode): Promise<FlushOutcome> {
  // A new attempt starts clean: the message on screen is about THIS click.
  refs.setFailure(null);
  const result = await schedulerOf(refs).flush();
  if (!result.ok) {
    raiseFailure(refs, result.error);
    return { ok: false, claim: undefined };
  }
  // The row is on the server but its id was never learned (the read after the
  // first save failed): one last try before deciding, because recording
  // without the claim would leave the draft alive on top of the session.
  if (refs.token.current !== null && refs.draftId.current === null) {
    await refs.learnDraftId.current();
  }
  // The claim is built on the token the flush LANDED with, never on the one
  // the screen was holding when the student clicked.
  const outcome = claimOutcomeFor(refs.draftId.current, refs.token.current);
  if (needsClaimlessProbe(mode, outcome)) return claimlessFlush(refs);
  if (!outcome.ok) refs.setFailure(outcome.failure);
  return { ok: outcome.ok, claim: outcome.claim };
}

/**
 * Reads the CURRENT run off the screen and builds the payload for it. Called
 * at SEND time, so the write always carries the newest state and never a
 * captured copy; `null` means "nothing to persist" (the run already ended).
 *
 * The screen owns the builder — `standardDraftPayload`, `spacedDraftPayload`,
 * `adaptiveDraftPayload` — because only it knows its mode's `setup` and
 * `modeState`. The hook hands it the LIVE token so the payload can carry it
 * verbatim: the token moves on every save and a captured one is always stale.
 */
export type RunSnapshot = (token: string | null) => RunDraftPayload | null;

/**
 * The run's mutable identity, as ONE container of stable ref cells.
 *
 * Each `useRef` on its own line and at the top level of a hook: the ref OBJECTS
 * are stable, so the container rebuilt every render still points at the same
 * cells the scheduler's closure captured on the first one. Extracted out of
 * `useRunPersistence` only so that function stays inside its size budget —
 * it is the same code, in the same order, called unconditionally.
 */
function usePersistenceRefs(
  setConflict: (conflict: RunConflict | null) => void,
  setFailure: (failure: RunSaveFailure | null) => void,
): PersistenceRefs {
  const draftIdRef = useRef<string | null>(null);
  const tokenRef = useRef<string | null>(null);
  const hadTokenRef = useRef(false);
  const pendingEchoesRef = useRef(createPendingEchoes());
  const sendRef = useRef<() => Promise<string>>(() => Promise.resolve(""));
  const exitSendRef = useRef<() => Promise<string>>(() => Promise.resolve(""));
  const keepAliveRef = useRef<() => Promise<string>>(() => Promise.resolve(""));
  const learnDraftIdRef = useRef<() => Promise<void>>(() => Promise.resolve());
  const probeRowRef = useRef<() => Promise<{ read: boolean; row: PersistedDraft | null }>>(() =>
    Promise.resolve({ read: false, row: null }),
  );
  const schedulerRef = useRef<SaveScheduler<string> | null>(null);
  return {
    draftId: draftIdRef,
    token: tokenRef,
    hadToken: hadTokenRef,
    pendingEchoes: pendingEchoesRef,
    send: sendRef,
    exitSend: exitSendRef,
    keepAlive: keepAliveRef,
    learnDraftId: learnDraftIdRef,
    probeRow: probeRowRef,
    scheduler: schedulerRef,
    setConflict,
    setFailure,
  };
}

/**
 * @param mode Which `exam_drafts` row this run owns. Every call the hook makes
 *   is keyed by it — `get` (learning the id back), `discard` — so a screen can
 *   never read or drop another mode's run.
 */
export function useRunPersistence(mode: RunMode, snapshot: RunSnapshot): RunPersistence {
  const utils = trpc.useUtils();
  const saveMutation = trpc.examDrafts.save.useMutation();
  const touchMutation = trpc.examDrafts.touch.useMutation();
  const discardMutation = trpc.examDrafts.discard.useMutation();
  const [conflict, setConflict] = useState<RunConflict | null>(null);
  const [failure, setFailure] = useState<RunSaveFailure | null>(null);

  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;
  const refs = usePersistenceRefs(setConflict, setFailure);

  // `FRESH_READ` is load-bearing in BOTH readers below, not hygiene: under the
  // client's 5-minute default this `fetch` resolves from the CACHE, so it would
  // keep answering from BEFORE the row existed.
  const readRow = async (): Promise<PersistedDraft | null> =>
    persistedDraftOf(await utils.examDrafts.get.fetch({ mode }, FRESH_READ));
  refs.learnDraftId.current = learnDraftIdVia(refs, readRow);
  refs.probeRow.current = probeRowVia(readRow);

  refs.send.current = sendVia(refs, snapshotRef, {
    save: (input) => saveMutation.mutateAsync(input),
    probe: () => refs.probeRow.current(),
  });

  refs.exitSend.current = exitSendVia(refs, snapshotRef, (input) =>
    exitTransportFor(input) === "keepalive"
      ? exitTrpcClient.examDrafts.save.mutate(input)
      : saveMutation.mutateAsync(input),
  );

  refs.keepAlive.current = keepAliveVia(refs, mode, (input) => touchMutation.mutateAsync(input));

  const scheduler = schedulerOf(refs);

  // Closing the tab now issues the owed write over `keepalive` (Codex
  // adversarial review of #79). `scheduler.flush()` was the bug, twice over: a
  // normal request is CANCELLED with the document, and when a save was already
  // in flight the flush awaited it first — an await that never resumes once the
  // handler has returned, so the owed write was never issued at all. The study
  // modes could live with that (they are resumable); the Simulado Real is
  // timed, unrepeatable and cannot be re-entered.
  //
  // GUARANTEED now: an owed write with an idle queue leaves this tab inside the
  // unload handler's own task, and the browser finishes it after the document
  // is gone.
  //
  // NOT guaranteed, and not closable from a browser:
  //   - a write ALREADY in flight owns the token, so the exit write queues
  //     behind it (`flushOnExit`) and dies with the tab. Overtaking it would
  //     make one of the two match 0 rows, and a CONFLICT is TERMINAL for the
  //     prova real. Loss window: the answers confirmed since that write
  //     started (≤ ~1.5 s + one round trip).
  //   - `getToken()` needing a network refresh exactly at `pagehide`: Clerk
  //     answers from its own cache while the token is valid, but a refresh
  //     started here never resolves and the request is never issued.
  //   - a process kill (force-quit, OOM, battery): no handler runs at all.
  //   - a payload over the keepalive body cap, which falls back to the old
  //     best-effort (`exit-save.ts`).
  // In every one of those the run is still on the server as of its last landed
  // save, and `settleRealRun` settles it at the deadline: what is at risk is
  // the TAIL of answers, never the whole exam — provided the first save landed.
  useEffect(() => {
    const onHide = (): void => {
      scheduler.flushOnExit();
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
    beat: async (): Promise<void> => {
      // Nothing to refresh before the first save landed — the row does not
      // exist yet, and `touch` has no token to match on.
      if (refs.token.current === null) return;
      await schedulerOf(refs).beat();
    },
    flush: (): Promise<FlushOutcome> => flushRun(refs, mode),
    conflict,
    failure,
    dismissFailure: (): void => {
      setFailure(null);
    },
    adopt: (draftId: string, token: string): void => {
      refs.draftId.current = draftId;
      refs.token.current = token;
      // Ownership is now proven the strong way (a token); anything remembered
      // from before belongs to a write that is no longer this run's identity.
      clearPendingEchoes(refs.pendingEchoes.current);
    },
    close: (): void => {
      refs.scheduler.current?.close();
      forgetIdentity(refs);
    },
    discardSaved: async (): Promise<void> => {
      await discardMutation.mutateAsync({ mode });
      // The WHOLE router, never just `list`: `get` is what a resume reads, and
      // leaving it cached serves a row this call just deleted.
      await utils.examDrafts.invalidate();
      forgetIdentity(refs);
      setConflict(null);
    },
    reportError: (error: unknown): void => {
      raiseFailure(refs, error);
    },
    reportBusy: (): void => {
      setFailure(runSaveFailure("busy"));
    },
  };
}
