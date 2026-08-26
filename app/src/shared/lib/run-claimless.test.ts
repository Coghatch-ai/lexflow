import { describe, expect, it } from "vitest";
import {
  claimlessSaveAdoption,
  claimlessVerdictFor,
  needsClaimlessProbe,
  needsClaimlessSaveProbe,
  saveRun,
} from "./run-claimless";
import {
  claimOutcomeFor,
  standardDraftPayload,
  type PersistedDraft,
  type RunDraftPayload,
  type StandardRunState,
} from "./run-persistence";
import type { AnswerDraft } from "@shared/domain/exam-draft";

// The RAW PostgreSQL text of `exam_drafts.last_saved_at`: microseconds, a space
// instead of `T`, `+00` instead of `Z`. It is matched with `=` in SQL, so it is
// the fixture everywhere a token appears.
const PG_TOKEN = "2026-08-21 14:30:04.210932+00";

function answer(id: string, userAnswer = "A", timeSpent = 10): AnswerDraft {
  return { questionId: id, userAnswer, correct: true, timeSpent };
}

function run(overrides: Partial<StandardRunState> = {}): StandardRunState {
  return {
    setup: { discipline: "CIVIL_LAW", examBoard: "FGV", difficulty: null },
    questionIds: ["q1", "q2", "q3"],
    cursor: 1,
    answers: [answer("q1")],
    carriedTime: new Map([["q2", 42]]),
    elapsedSeconds: 130,
    token: PG_TOKEN,
    ...overrides,
  };
}

function draft(overrides: Partial<PersistedDraft> = {}): PersistedDraft {
  return {
    id: "3f1c2d5e-0000-4000-8000-000000000001",
    mode: "standard",
    setup: { mode: "standard", discipline: "CIVIL_LAW", examBoard: "FGV", difficulty: null },
    questionIds: ["q1", "q2", "q3"],
    cursor: 1,
    answers: [answer("q1")],
    modeState: { mode: "standard", carriedTime: { q2: 42 } },
    elapsedSeconds: 130,
    deadlineAt: null,
    lastSavedAt: PG_TOKEN,
    ...overrides,
  };
}

/** A tRPC `CONFLICT` as it reaches the client — shape-checked, never instanceof. */
function conflictError(message: string): unknown {
  return { data: { code: "CONFLICT" }, message };
}

/** The dropped connection: the request left, the response never came back. */
const LOST_RESPONSE: unknown = { data: null, message: "Failed to fetch" };

// The #79 audit finding: `claimOutcomeFor(null, null)` says "record with no
// claim", which is right for a run that was never persisted and WRONG for a run
// whose creating save committed and lost its response. In the prova real that
// second case writes the session, leaves the orphan row alive on top of it, and
// the next lazy settlement records a SECOND session (BR-05.7).
describe("needsClaimlessProbe", () => {
  const CLAIMLESS = claimOutcomeFor(null, null);

  it("checks the server before ANY claimless recording of a prova real", () => {
    expect(needsClaimlessProbe("real", CLAIMLESS)).toBe(true);
  });

  it("does not check when the claim is known — nothing to be unsure about", () => {
    expect(needsClaimlessProbe("real", claimOutcomeFor("draft-1", PG_TOKEN))).toBe(false);
  });

  it("does not check a refusal — that run is not being recorded at all", () => {
    expect(needsClaimlessProbe("real", claimOutcomeFor(null, PG_TOKEN))).toBe(false);
  });

  it("leaves the study modes alone — only the real exam is settled by the server", () => {
    for (const mode of ["standard", "spaced", "adaptive"] as const) {
      expect(needsClaimlessProbe(mode, CLAIMLESS)).toBe(false);
    }
  });
});

// Fail-closed in BOTH directions: a row that came back is terminal, and a probe
// that could not be read is never taken for "no row".
describe("claimlessVerdictFor", () => {
  it("records only when the server confirms there is no row to orphan", () => {
    expect(claimlessVerdictFor({ read: true, row: null })).toBe("record");
  });

  it("is terminal when a row IS there — the server will settle that row", () => {
    // The orphan: the save committed, its response was lost, so this tab holds
    // no token. Recording here is the twin session.
    const verdict = claimlessVerdictFor({ read: true, row: draft({ mode: "real" }) });
    expect(verdict).toBe("conflict");
    expect(verdict).not.toBe("record");
  });

  it("refuses when the probe itself failed — unread is not 'no row'", () => {
    const verdict = claimlessVerdictFor({ read: false, row: null });
    expect(verdict).toBe("retry");
    expect(verdict).not.toBe("record");
  });
});

// The SAVE-path twin. A CONFLICT is an ANSWER, not an unknown: the row
// pre-existed this save (BR-05.8) and must get its dialog, never an adoption.
describe("needsClaimlessSaveProbe", () => {
  it("probes after a first save whose response was lost", () => {
    expect(needsClaimlessSaveProbe(false, LOST_RESPONSE)).toBe(true);
  });

  it("never probes after a CONFLICT — the server already said whose row it is", () => {
    expect(needsClaimlessSaveProbe(false, conflictError("Já existe um teste"))).toBe(false);
  });

  it("never probes a save that CARRIED a token — that one can be claimed", () => {
    expect(needsClaimlessSaveProbe(true, LOST_RESPONSE)).toBe(false);
  });
});

// Ownership by CONTENT, because the token — `adoptableDraftId`'s proof — is
// exactly what was never learned. `exam_drafts` is UNIQUE on (user_id, mode)
// and the read is user-scoped, so the probe returns at most this student's row
// in this mode; a verbatim echo of the payload we just sent IS our own write.
describe("claimlessSaveAdoption", () => {
  const SENT: RunDraftPayload = standardDraftPayload(run({ token: null }));

  it("adopts the row that is a verbatim echo of the save we just sent", () => {
    const adopted = claimlessSaveAdoption({ read: true, row: draft() }, SENT);
    expect(adopted).toEqual({ id: draft().id, lastSavedAt: PG_TOKEN });
  });

  it("refuses a row that is NOT our write — another device's live run", () => {
    // The rejected alternative "adopt any row found": a lost response can just
    // as well have been a lost OVERWRITE_CONFLICT, and adopting there hands us
    // a token for a run we never wrote, whose next save bulldozes it (BR-05.8).
    const foreign = draft({ questionIds: ["z9", "z8", "z7"], id: "row-B" });
    expect(claimlessSaveAdoption({ read: true, row: foreign }, SENT)).toBeNull();
  });

  it("refuses a row that matches the queue but not the progress", () => {
    expect(claimlessSaveAdoption({ read: true, row: draft({ cursor: 2 }) }, SENT)).toBeNull();
    const other = draft({ answers: [answer("q1", "B")] });
    expect(claimlessSaveAdoption({ read: true, row: other }, SENT)).toBeNull();
  });

  it("refuses when the probe itself failed — unread is not 'ours'", () => {
    expect(claimlessSaveAdoption({ read: false, row: null }, SENT)).toBeNull();
    expect(claimlessSaveAdoption({ read: true, row: null }, SENT)).toBeNull();
  });

  it("refuses a row of another mode, whatever it contains", () => {
    expect(claimlessSaveAdoption({ read: true, row: draft({ mode: "real" }) }, SENT)).toBeNull();
  });
});

/**
 * `examDrafts.save` as the router really behaves: UNIQUE on (user, mode),
 * `token: null` = INSERT … onConflictDoNothing (a row already there ⇒ CONFLICT),
 * `token` = UPDATE … WHERE last_saved_at = token (no match ⇒ CONFLICT).
 */
function fakeDraftsServer(): {
  row: () => PersistedDraft | null;
  save: (payload: RunDraftPayload) => { lastSavedAt: string };
} {
  let row: PersistedDraft | null = null;
  let tick = 0;
  const now = (): string => {
    tick += 1;
    return `2026-08-21 14:30:0${String(tick)}.210932+00`;
  };
  const written = (payload: RunDraftPayload, lastSavedAt: string): PersistedDraft => ({
    id: "row-1",
    mode: payload.mode,
    setup: payload.setup,
    questionIds: [...payload.questionIds],
    cursor: payload.cursor,
    answers: [...payload.answers],
    modeState: payload.modeState,
    elapsedSeconds: payload.elapsedSeconds,
    deadlineAt: null,
    lastSavedAt,
  });
  return {
    row: () => row,
    save: (payload) => {
      const lastSavedAt = now();
      if (payload.token === null) {
        if (row !== null) throw conflictError("Já existe um teste em andamento neste modo.");
        row = written(payload, lastSavedAt);
        return { lastSavedAt };
      }
      if (row?.lastSavedAt !== payload.token) {
        throw conflictError("Este teste foi continuado em outro aparelho.");
      }
      row = written(payload, lastSavedAt);
      return { lastSavedAt };
    },
  };
}

// THE regression (#79): the first save COMMITS and its response is lost, so the
// token stays null — and every retry goes out as another `token: null`, which
// the router reads as "first save" and refuses with OVERWRITE_CONFLICT. The
// student retries forever against a row this very tab wrote.
describe("saveRun — a first save whose response is lost", () => {
  it("adopts the row it wrote instead of looping on the overwrite conflict", async () => {
    const server = fakeDraftsServer();
    let drop = true;
    const io = {
      save: (payload: RunDraftPayload): Promise<{ lastSavedAt: string }> => {
        const saved = server.save(payload); // commits …
        if (drop) {
          drop = false;
          throw LOST_RESPONSE; // … and the answer never gets back.
        }
        return Promise.resolve(saved);
      },
      probe: (): Promise<{ read: boolean; row: PersistedDraft | null }> =>
        Promise.resolve({ read: true, row: server.row() }),
    };

    const first = await saveRun(standardDraftPayload(run({ token: null })), io);
    expect(first.draftId).toBe("row-1");
    expect(first.lastSavedAt).toBe(server.row()?.lastSavedAt);

    // The retry now carries the adopted token: an UPDATE of our own row, not a
    // second INSERT. Without the adoption this line throws CONFLICT forever.
    const second = await saveRun(
      standardDraftPayload(run({ token: first.lastSavedAt, cursor: 2 })),
      io,
    );
    expect(second.lastSavedAt).not.toBe(first.lastSavedAt);
    expect(server.row()?.cursor).toBe(2);

    const third = await saveRun(
      standardDraftPayload(run({ token: second.lastSavedAt, cursor: 3 })),
      io,
    );
    expect(server.row()?.lastSavedAt).toBe(third.lastSavedAt);
  });

  it("is the loop it prevents: the same run without the recovery never lands", async () => {
    // The pre-fix behaviour, spelled out against the same fake server — this is
    // what `saveRun` turns into the three landed saves above.
    const server = fakeDraftsServer();
    const payload = standardDraftPayload(run({ token: null }));
    expect(() => server.save(payload)).not.toThrow(); // committed, response lost
    await expect(
      saveRun(payload, {
        save: (input) => Promise.resolve(server.save(input)),
        probe: () => Promise.resolve({ read: true, row: server.row() }),
      }),
    ).rejects.toMatchObject({ data: { code: "CONFLICT" } });
  });

  it("rethrows a CONFLICT untouched — that dialog is the student's to answer", async () => {
    const server = fakeDraftsServer();
    server.save(standardDraftPayload(run({ token: null, questionIds: ["z9"] }))); // other device
    await expect(
      saveRun(standardDraftPayload(run({ token: null })), {
        save: (input) => Promise.resolve(server.save(input)),
        probe: () => Promise.resolve({ read: true, row: server.row() }),
      }),
    ).rejects.toMatchObject({ data: { code: "CONFLICT" } });
  });

  it("rethrows when the probe cannot read — a retry beats a guess", async () => {
    await expect(
      saveRun(standardDraftPayload(run({ token: null })), {
        save: () => Promise.reject(LOST_RESPONSE),
        probe: () => Promise.resolve({ read: false, row: null }),
      }),
    ).rejects.toBe(LOST_RESPONSE);
  });

  it("leaves a save that carried a token exactly as it was", async () => {
    await expect(
      saveRun(standardDraftPayload(run({ token: PG_TOKEN })), {
        save: () => Promise.reject(LOST_RESPONSE),
        probe: () => Promise.reject(new Error("must not be probed")),
      }),
    ).rejects.toBe(LOST_RESPONSE);
  });
});
