import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  MAX_PENDING_ECHOES,
  PROBE_TIMEOUT_MS,
  SAVE_TIMEOUT_MS,
  createPendingEchoes,
  saveRun,
  type PendingEchoes,
} from "./run-claimless";
import {
  SAVE_DEBOUNCE_MS,
  WRITE_TIMEOUT_MS,
  createSaveScheduler,
  type SaveScheduler,
} from "./save-scheduler";
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
    const saving = saveRun(
      sent,
      {
        save: (payload) => {
          server.commit(payload);
          return hung<{ lastSavedAt: string }>();
        },
        probe: probeOf(server),
      },
      createPendingEchoes(),
    );

    await vi.advanceTimersByTimeAsync(SAVE_TIMEOUT_MS);
    const saved = await saving;

    // Ownership proven by the echo of the very payload that timed out — the one
    // moment it can be proven, since the next attempt carries another payload.
    expect(saved.draftId).toBe("row-1");
    expect(saved.lastSavedAt).toBe(server.row()?.lastSavedAt);
  });

  it("makes the NEXT save an update of that row — never a second claimless insert", async () => {
    const server = fakeDraftsServer();
    const pending = createPendingEchoes();
    const saving = saveRun(
      realPayload(null),
      {
        save: (payload) => {
          server.commit(payload);
          return hung<{ lastSavedAt: string }>();
        },
        probe: probeOf(server),
      },
      pending,
    );
    await vi.advanceTimersByTimeAsync(SAVE_TIMEOUT_MS);
    const first = await saving;

    const second = await saveRun(
      realPayload(first.lastSavedAt, [answer("q1"), answer("q2")]),
      {
        save: (payload) => Promise.resolve(server.commit(payload)),
        probe: probeOf(server),
      },
      pending,
    );

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
    const pending = createPendingEchoes();
    const stalled = saveRun(
      sent,
      {
        save: (payload) => {
          late.push(() => {
            server.commit(payload);
          });
          return hung<{ lastSavedAt: string }>();
        },
        probe: probeOf(server),
      },
      pending,
    );

    // Nothing to adopt yet: the probe read an empty table, so the write is owed.
    // The expectation is attached BEFORE the clock moves, or the rejection lands
    // with nobody listening and vitest reports an unhandled one.
    const owed = expect(stalled).rejects.toBeInstanceOf(Error);
    await vi.advanceTimersByTimeAsync(SAVE_TIMEOUT_MS + PROBE_TIMEOUT_MS);
    await owed;
    for (const land of late) land();

    // The retry the scheduler's re-armed `dirty` sends, with the same payload.
    const retried = await saveRun(
      sent,
      {
        save: (payload) => Promise.resolve(server.commit(payload)),
        probe: probeOf(server),
      },
      pending,
    );
    expect(retried.draftId).toBe("row-1");
    expect(retried.lastSavedAt).toBe(server.row()?.lastSavedAt);
    // Same payload as the write that landed, so nothing is owed on top of it.
    expect(retried.owed).toBe(false);
  });
});

describe("saveRun — what a stalled write still refuses", () => {
  it("refuses when the PROBE stalls too — unread is never taken for ours", async () => {
    const server = fakeDraftsServer();
    const saving = saveRun(
      realPayload(null),
      {
        save: (payload) => {
          server.commit(payload);
          return hung<{ lastSavedAt: string }>();
        },
        probe: () => hung<{ read: boolean; row: PersistedDraft | null }>(),
      },
      createPendingEchoes(),
    );

    // The original failure stands: the write is owed again and the next beat
    // resends it — a retry beats a guess.
    const refused = expect(saving).rejects.toBeInstanceOf(Error);
    await vi.advanceTimersByTimeAsync(SAVE_TIMEOUT_MS + PROBE_TIMEOUT_MS);
    await refused;
  });

  it("still refuses a row that is NOT ours, however it failed", async () => {
    const server = fakeDraftsServer();
    server.commit(realPayload(null, [answer("z9", "D")])); // another device's live run
    const saving = saveRun(
      realPayload(null),
      {
        save: () => hung<{ lastSavedAt: string }>(),
        probe: probeOf(server),
      },
      createPendingEchoes(),
    );
    const refused = expect(saving).rejects.toBeInstanceOf(Error);
    await vi.advanceTimersByTimeAsync(SAVE_TIMEOUT_MS);
    await refused;
  });
});

/** A row as `examDrafts.get` returns it for a payload that was written. */
function rowOf(
  payload: RunDraftPayload,
  lastSavedAt = "2026-08-21 14:31:09.210932+00",
): PersistedDraft {
  return {
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
}

/** A dropped response: no answer from the server, so the outcome is unknown. */
const LOST_RESPONSE = new Error("Failed to fetch");

/** The n-th claimless attempt of one run: same run, one more answer each time. */
function attempt(answerCount: number): RunDraftPayload {
  return realPayload(
    null,
    Array.from({ length: answerCount }, (_unused, index) => answer(`q${String(index + 1)}`)),
  );
}

/** One claimless attempt whose outcome is never learned (probe reads no row). */
async function unknownOutcome(sent: RunDraftPayload, pending: PendingEchoes): Promise<void> {
  await expect(
    saveRun(
      sent,
      {
        save: () => Promise.reject(LOST_RESPONSE),
        probe: () => Promise.resolve({ read: true, row: null }),
      },
      pending,
    ),
  ).rejects.toBe(LOST_RESPONSE);
}

// ROUND FOUR (Codex). The window the bound inside `saveRun` narrowed but could
// not close, because the payload that timed out was only compared against
// ITSELF, within the one attempt that sent it:
//
//   1. the first claimless save times out; the probe reads no row — the insert
//      has not committed yet, so the write is owed and the error stands;
//   2. the abandoned request COMMITS late;
//   3. the student answers another question, so the retry carries a new payload;
//   4. the retry meets its own row, the router answers OVERWRITE_CONFLICT, and
//      the echo of the RETRY cannot match a row written by the FIRST attempt.
//      Foreign ⇒ terminal (`raiseIfConflict`), and the student is locked out of
//      an exam by their own first write.
//
// Fixed by REMEMBERING the echo of every attempt whose outcome stayed unknown,
// so a row written by any of them is still recognisable as ours later.
describe("saveRun — the write that lands LATE, after the student answered again", () => {
  it("adopts the row its FIRST attempt wrote, and reports the current payload as still owed", async () => {
    const server = fakeDraftsServer();
    const pending = createPendingEchoes();
    const late: (() => void)[] = [];
    const stalled = saveRun(
      attempt(1),
      {
        save: (payload) => {
          late.push(() => {
            server.commit(payload);
          });
          return hung<{ lastSavedAt: string }>();
        },
        probe: probeOf(server),
      },
      pending,
    );

    const owed = expect(stalled).rejects.toBeInstanceOf(Error);
    await vi.advanceTimersByTimeAsync(SAVE_TIMEOUT_MS + PROBE_TIMEOUT_MS);
    await owed;
    for (const land of late) land(); // …and it commits AFTER that probe read.

    // The student answered one more question: the retry's own payload can no
    // longer echo the row. Before this fix that was a terminal CONFLICT.
    const adopted = await saveRun(
      attempt(2),
      {
        save: (payload) => Promise.resolve(server.commit(payload)),
        probe: probeOf(server),
      },
      pending,
    );

    expect(adopted.draftId).toBe("row-1");
    expect(adopted.lastSavedAt).toBe(server.row()?.lastSavedAt);
    // The row is ours but one payload behind, so the write is NOT reported as
    // landed — the second answer is still only in the tab.
    expect(adopted.owed).toBe(true);
    expect(server.row()?.answers).toHaveLength(1);

    // And the owed write goes out as an UPDATE of our own row, not an insert.
    const landed = await saveRun(
      realPayload(adopted.lastSavedAt, [answer("q1"), answer("q2")]),
      {
        save: (payload) => Promise.resolve(server.commit(payload)),
        probe: probeOf(server),
      },
      pending,
    );
    expect(landed.owed).toBe(false);
    expect(server.row()?.answers).toHaveLength(2);
  });
});

// The bounds of that memory: what it never adopts, what it never remembers, and
// how much of it there is.
describe("the pending echoes — their limits", () => {
  it("still refuses a row it cannot prove it wrote, however much it remembers", async () => {
    const server = fakeDraftsServer();
    const pending = createPendingEchoes();
    await unknownOutcome(attempt(1), pending);

    // What turns up is another device's live run — a remembered echo must not
    // become a skeleton key for any row in this mode (BR-05.8 stands).
    server.commit(realPayload(null, [answer("z9", "D")]));
    await expect(
      saveRun(
        attempt(2),
        {
          save: (payload) => Promise.resolve(server.commit(payload)),
          probe: probeOf(server),
        },
        pending,
      ),
    ).rejects.toMatchObject({ data: { code: "CONFLICT" } });
  });

  it("never remembers a payload the server REFUSED — a CONFLICT wrote nothing", async () => {
    const server = fakeDraftsServer();
    const pending = createPendingEchoes();
    server.commit(realPayload(null, [answer("z9", "D")])); // another device got there first
    const refused = attempt(1);
    await expect(
      saveRun(
        refused,
        {
          save: (payload) => Promise.resolve(server.commit(payload)),
          probe: probeOf(server),
        },
        pending,
      ),
    ).rejects.toMatchObject({ data: { code: "CONFLICT" } });

    // Even a row that later matches that payload byte for byte is not ours: the
    // server already answered that this insert wrote 0 rows.
    await expect(
      saveRun(
        attempt(2),
        {
          save: () => Promise.reject(LOST_RESPONSE),
          probe: () => Promise.resolve({ read: true, row: rowOf(refused) }),
        },
        pending,
      ),
    ).rejects.toBe(LOST_RESPONSE);
  });

  it(`remembers ${String(MAX_PENDING_ECHOES)} unknown outcomes and keeps the OLDEST`, async () => {
    const pending = createPendingEchoes();
    // One more attempt than the cap holds, each with one more answer.
    for (let count = 1; count <= MAX_PENDING_ECHOES + 1; count += 1) {
      await unknownOutcome(attempt(count), pending);
    }

    // The attempt past the cap never became adoptable — the honest bound, and
    // the fail-closed side of it (the BR-05.8 dialog, not a silent adoption).
    // Asserted FIRST: an adoption clears the memory this test is about.
    await expect(
      saveRun(
        attempt(MAX_PENDING_ECHOES + 2),
        {
          save: () => Promise.reject(LOST_RESPONSE),
          probe: () => Promise.resolve({ read: true, row: rowOf(attempt(MAX_PENDING_ECHOES + 1)) }),
        },
        pending,
      ),
    ).rejects.toBe(LOST_RESPONSE);

    // The FIRST attempt still is, and deliberately so: the row is created by an
    // INSERT … `onConflictDoNothing`, so the earliest attempt that reached the
    // database is the only one that can have written it — which is why the cap
    // drops the NEW echo instead of evicting the oldest.
    const oldest = await saveRun(
      attempt(MAX_PENDING_ECHOES + 2),
      {
        save: () => Promise.reject(LOST_RESPONSE),
        probe: () => Promise.resolve({ read: true, row: rowOf(attempt(1)) }),
      },
      pending,
    );
    expect(oldest).toEqual({
      draftId: "row-1",
      lastSavedAt: rowOf(attempt(1)).lastSavedAt,
      owed: true,
    });
  });
});

describe("the adoption at the cadence layer", () => {
  it("lands the payload the adoption left owed before the flush answers ok", async () => {
    // The cadence layer, as `use-run-persistence.ts` wires it: an adoption that
    // reports `owed` re-arms the write, and `flush` keeps writing until nothing
    // is owed. Answering `ok: true` here with the newest answers still in the
    // tab is what lets `processReal` settle a row without them.
    const server = fakeDraftsServer();
    const pending = createPendingEchoes();
    const holder: { current: SaveScheduler<string> | null } = { current: null };
    const late: (() => void)[] = [];
    const errors: unknown[] = [];
    let token: string | null = null;
    let answers = [answer("q1")];
    let sends = 0;

    const scheduler = createSaveScheduler<string>({
      send: async (): Promise<string> => {
        sends += 1;
        const first = sends === 1;
        const saved = await saveRun(
          realPayload(token, answers),
          {
            save: (payload) => {
              if (!first) return Promise.resolve(server.commit(payload));
              late.push(() => {
                server.commit(payload);
              });
              return hung<{ lastSavedAt: string }>();
            },
            probe: probeOf(server),
          },
          pending,
        );
        token = saved.lastSavedAt;
        if (saved.owed) holder.current?.schedule();
        return saved.lastSavedAt;
      },
      onError: (error) => errors.push(error),
    });
    holder.current = scheduler;

    scheduler.schedule();
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS);
    await vi.advanceTimersByTimeAsync(SAVE_TIMEOUT_MS + PROBE_TIMEOUT_MS);
    for (const land of late) land(); // the first write commits late…
    answers = [answer("q1"), answer("q2")]; // …and the student answers again.

    const flushed = await scheduler.flush();
    expect(flushed).toEqual({ ok: true, value: server.row()?.lastSavedAt });
    expect(server.row()?.answers).toHaveLength(2);
    // ONE failure — the stalled write. The retry's CONFLICT never reached
    // `onError`, where `raiseIfConflict` would have closed the exam for good.
    expect(errors).toHaveLength(1);
    scheduler.close();
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
    const pending = createPendingEchoes();
    let token: string | null = null;
    let sends = 0;

    const scheduler = createSaveScheduler<string>({
      send: async (): Promise<string> => {
        sends += 1;
        const first = sends === 1;
        const saved = await saveRun(
          realPayload(token),
          {
            save: (payload) => {
              const committed = server.commit(payload);
              return first ? hung<{ lastSavedAt: string }>() : Promise.resolve(committed);
            },
            probe: probeOf(server),
          },
          pending,
        );
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
