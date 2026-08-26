import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PROBE_TIMEOUT_MS, SAVE_TIMEOUT_MS, saveRun } from "./run-claimless";
import { SAVE_DEBOUNCE_MS, WRITE_TIMEOUT_MS, createSaveScheduler } from "./save-scheduler";
import { realDraftPayload, type PersistedDraft, type RunDraftPayload } from "./run-persistence";
import type { AnswerDraft } from "@shared/domain/exam-draft";

// THE causal chain of the third Codex round, as one file — because it is one
// bug wearing three file names:
//
//   1. the write was bounded from OUTSIDE (`save-scheduler`'s dispatch), so a
//      request that timed out was abandoned without cancelling it;
//   2. that abandoned request could still COMMIT, while `token` stayed null;
//   3. the retry therefore went out as another `token: null`, and the router's
//      `onConflictDoNothing` answered OVERWRITE_CONFLICT — which the client
//      treated as terminal, against the student's own first write.
//
// Fixed by moving the bound INSIDE `saveRun`, where the payload still is: the
// timeout becomes the lost-response case the claimless probe already recovers
// from, and a claimless CONFLICT is decided by the echo instead of assumed.

/** A write that answers NEITHER way — a stalled connection, not a failed one. */
function hung<T>(): Promise<T> {
  return new Promise<T>(() => {
    // never resolves, never rejects
  });
}

const DEADLINE = "2026-08-21T19:30:04.210Z";

function answer(id: string, userAnswer = "A"): AnswerDraft {
  return { questionId: id, userAnswer, correct: true, timeSpent: 10 };
}

/** A tRPC `CONFLICT` as it reaches the client — shape-checked, never instanceof. */
function conflictError(message: string): unknown {
  return { data: { code: "CONFLICT" }, message };
}

/** The prova real payload: the mode where a terminal conflict ends the exam. */
function realPayload(
  token: string | null,
  answers: AnswerDraft[] = [answer("q1")],
): RunDraftPayload {
  return realDraftPayload({
    questionIds: ["q1", "q2", "q3"],
    cursor: 1,
    answers,
    deadlineAt: DEADLINE,
    token,
  });
}

/**
 * `examDrafts.save` as the router really behaves: UNIQUE on (user, mode),
 * `token: null` = INSERT … onConflictDoNothing (a row already there ⇒ CONFLICT),
 * `token` = UPDATE … WHERE last_saved_at = token (no match ⇒ CONFLICT).
 */
function fakeDraftsServer(): {
  row: () => PersistedDraft | null;
  commit: (payload: RunDraftPayload) => { lastSavedAt: string };
} {
  let row: PersistedDraft | null = null;
  let tick = 0;
  return {
    row: () => row,
    commit: (payload) => {
      tick += 1;
      const lastSavedAt = `2026-08-21 14:30:0${String(tick)}.210932+00`;
      if (payload.token === null) {
        if (row !== null) throw conflictError("Já existe um teste em andamento neste modo.");
        row = {
          id: "row-1",
          mode: payload.mode,
          setup: payload.setup,
          questionIds: [...payload.questionIds],
          cursor: payload.cursor,
          answers: [...payload.answers],
          modeState: payload.modeState,
          elapsedSeconds: payload.elapsedSeconds,
          deadlineAt: "deadlineAt" in payload ? payload.deadlineAt : null,
          lastSavedAt,
        };
        return { lastSavedAt };
      }
      if (row?.lastSavedAt !== payload.token) {
        throw conflictError("Este teste foi continuado em outro aparelho.");
      }
      row = { ...row, cursor: payload.cursor, answers: [...payload.answers], lastSavedAt };
      return { lastSavedAt };
    },
  };
}

const probeOf =
  (server: ReturnType<typeof fakeDraftsServer>) =>
  (): Promise<{
    read: boolean;
    row: PersistedDraft | null;
  }> =>
    Promise.resolve({ read: true, row: server.row() });

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("saveRun — the write that stalls and commits anyway", () => {
  it("adopts the row its own timed-out request wrote, instead of never learning the token", async () => {
    const server = fakeDraftsServer();
    const sent = realPayload(null);
    // The request leaves, COMMITS server-side, and never answers.
    const saving = saveRun(sent, {
      save: (payload) => {
        server.commit(payload);
        return hung<{ lastSavedAt: string }>();
      },
      probe: probeOf(server),
    });

    await vi.advanceTimersByTimeAsync(SAVE_TIMEOUT_MS);
    const saved = await saving;

    // Ownership proven by the echo of the very payload that timed out — the one
    // moment it can be proven, since the next attempt carries another payload.
    expect(saved.draftId).toBe("row-1");
    expect(saved.lastSavedAt).toBe(server.row()?.lastSavedAt);
  });

  it("makes the NEXT save an update of that row — never a second claimless insert", async () => {
    const server = fakeDraftsServer();
    const saving = saveRun(realPayload(null), {
      save: (payload) => {
        server.commit(payload);
        return hung<{ lastSavedAt: string }>();
      },
      probe: probeOf(server),
    });
    await vi.advanceTimersByTimeAsync(SAVE_TIMEOUT_MS);
    const first = await saving;

    const second = await saveRun(realPayload(first.lastSavedAt, [answer("q1"), answer("q2")]), {
      save: (payload) => Promise.resolve(server.commit(payload)),
      probe: probeOf(server),
    });

    expect(second.lastSavedAt).not.toBe(first.lastSavedAt);
    expect(server.row()?.answers).toHaveLength(2);
  });

  it("does not turn a stalled write into a terminal conflict when it lands LATE", async () => {
    // The narrow window the bound cannot close: the request commits AFTER the
    // probe read. The retry then meets its own row and gets OVERWRITE_CONFLICT
    // — which is exactly the collision that used to be terminal.
    const server = fakeDraftsServer();
    const sent = realPayload(null);
    const late: (() => void)[] = [];
    const stalled = saveRun(sent, {
      save: (payload) => {
        late.push(() => {
          server.commit(payload);
        });
        return hung<{ lastSavedAt: string }>();
      },
      probe: probeOf(server),
    });

    // Nothing to adopt yet: the probe read an empty table, so the write is owed.
    // The expectation is attached BEFORE the clock moves, or the rejection lands
    // with nobody listening and vitest reports an unhandled one.
    const owed = expect(stalled).rejects.toBeInstanceOf(Error);
    await vi.advanceTimersByTimeAsync(SAVE_TIMEOUT_MS + PROBE_TIMEOUT_MS);
    await owed;
    for (const land of late) land();

    // The retry the scheduler's re-armed `dirty` sends, with the same payload.
    const retried = await saveRun(sent, {
      save: (payload) => Promise.resolve(server.commit(payload)),
      probe: probeOf(server),
    });
    expect(retried.draftId).toBe("row-1");
    expect(retried.lastSavedAt).toBe(server.row()?.lastSavedAt);
  });

  it("refuses when the PROBE stalls too — unread is never taken for ours", async () => {
    const server = fakeDraftsServer();
    const saving = saveRun(realPayload(null), {
      save: (payload) => {
        server.commit(payload);
        return hung<{ lastSavedAt: string }>();
      },
      probe: () => hung<{ read: boolean; row: PersistedDraft | null }>(),
    });

    // The original failure stands: the write is owed again and the next beat
    // resends it — a retry beats a guess.
    const refused = expect(saving).rejects.toBeInstanceOf(Error);
    await vi.advanceTimersByTimeAsync(SAVE_TIMEOUT_MS + PROBE_TIMEOUT_MS);
    await refused;
  });

  it("still refuses a row that is NOT ours, however it failed", async () => {
    const server = fakeDraftsServer();
    server.commit(realPayload(null, [answer("z9", "D")])); // another device's live run
    const saving = saveRun(realPayload(null), {
      save: () => hung<{ lastSavedAt: string }>(),
      probe: probeOf(server),
    });
    const refused = expect(saving).rejects.toBeInstanceOf(Error);
    await vi.advanceTimersByTimeAsync(SAVE_TIMEOUT_MS);
    await refused;
  });
});

describe("the bound's placement", () => {
  it("leaves the save path room to recover before the scheduler's backstop fires", () => {
    // Invert this and the recovery is torn out from under itself: `dispatch`
    // would abandon `saveRun` mid-probe, `dirty` would re-arm, and the terminal
    // conflict of #79 is back with no code change to point at.
    expect(SAVE_TIMEOUT_MS + PROBE_TIMEOUT_MS).toBeLessThan(WRITE_TIMEOUT_MS);
  });

  it("reports a stalled first save as a LANDED write, not as a failure the exam pays for", async () => {
    // The whole chain at the cadence layer: schedule → the write stalls →
    // `saveRun` adopts inside the backstop → the flush the deadline door awaits
    // answers `ok: true` with the adopted token, and no CONFLICT ever reaches
    // `onError` (where `raiseIfConflict` would close the scheduler for good).
    const server = fakeDraftsServer();
    const errors: unknown[] = [];
    let token: string | null = null;
    let sends = 0;

    const scheduler = createSaveScheduler<string>({
      send: async (): Promise<string> => {
        sends += 1;
        const first = sends === 1;
        const saved = await saveRun(realPayload(token), {
          save: (payload) => {
            const committed = server.commit(payload);
            return first ? hung<{ lastSavedAt: string }>() : Promise.resolve(committed);
          },
          probe: probeOf(server),
        });
        token = saved.lastSavedAt;
        return saved.lastSavedAt;
      },
      onError: (error) => errors.push(error),
    });

    scheduler.schedule();
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS);
    await vi.advanceTimersByTimeAsync(SAVE_TIMEOUT_MS);

    const flushed = await scheduler.flush();
    expect(flushed).toEqual({ ok: true, value: server.row()?.lastSavedAt });
    expect(errors).toEqual([]);
    expect(token).toBe(server.row()?.lastSavedAt);
  });
});
