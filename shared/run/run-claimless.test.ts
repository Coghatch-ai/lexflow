import { describe, expect, it } from "vitest";
import {
  claimlessSaveAdoption,
  claimlessVerdictFor,
  createRunNonce,
  needsClaimlessProbe,
  needsClaimlessSaveProbe,
  runNonceAdoption,
  saveRun,
  stampRunNonce,
} from "./run-claimless";
import {
  claimOutcomeFor,
  realDraftPayload,
  standardDraftPayload,
  type PersistedDraft,
  type RunDraftPayload,
  type StandardRunState,
} from "./run-persistence";
import type { AnswerDraft } from "../domain/exam-draft";

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

// The SAVE-path twin. With `token: null` the router's CONFLICT says only that a
// row exists on (user_id, mode) — never whose — and this tab's own timed-out
// first write produces exactly that row. So EVERY claimless failure is probed,
// and the echo test is what keeps another device's run terminal (BR-05.8).
describe("needsClaimlessSaveProbe", () => {
  it("probes after a first save whose response was lost", () => {
    expect(needsClaimlessSaveProbe(false)).toBe(true);
  });

  it("probes a claimless CONFLICT too — it may be this tab's own abandoned write", () => {
    expect(needsClaimlessSaveProbe(false)).toBe(true);
  });

  it("never probes a save that CARRIED a token — that one can be claimed", () => {
    expect(needsClaimlessSaveProbe(true)).toBe(false);
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

  // THE Codex finding: the proof read `mode` + queue + cursor + answers only,
  // so a same-mode row that agreed on those and differed on ANY other persisted
  // field was adopted as ours — a token for a row this tab never wrote, whose
  // next save overwrites someone's live run (BR-05.8). Every field the payload
  // sends is now part of the proof.
  it("refuses a row that echoes the queue and the progress but differs elsewhere", () => {
    const differs: Partial<PersistedDraft>[] = [
      // The run clock: same three questions, same cursor, same answer — but 40
      // minutes of someone else's exam.
      { elapsedSeconds: 2530 },
      // `modeState`: the BR-03 carried time of a different run.
      { modeState: { mode: "standard", carriedTime: { q2: 7 } } },
      // `setup`: the same discipline drawn under another filter.
      {
        setup: { mode: "standard", discipline: "CIVIL_LAW", examBoard: "CESPE", difficulty: null },
      },
    ];
    for (const override of differs) {
      expect(claimlessSaveAdoption({ read: true, row: draft(override) }, SENT)).toBeNull();
    }
  });

  // jsonb does not preserve key order, so the proof must compare VALUES, not
  // the bytes of a `JSON.stringify`. A row that came back with its keys shuffled
  // is still our own write.
  it("adopts our write even when jsonb hands the keys back in another order", () => {
    const shuffled = draft({
      answers: [{ timeSpent: 10, correct: true, userAnswer: "A", questionId: "q1" }],
      modeState: { carriedTime: { q2: 42 }, mode: "standard" },
    });
    expect(claimlessSaveAdoption({ read: true, row: shuffled }, SENT)).toEqual({
      id: draft().id,
      lastSavedAt: PG_TOKEN,
    });
  });
});

// `deadlineAt` is the one field the server REWRITES on the way in
// (`deadlineAtInput`'s `.transform` → ISO, µs truncated to ms) and hands back as
// raw PG text, so it is compared by INSTANT instead of verbatim — compared, not
// skipped: two provas reais started minutes apart on two devices differ on
// nothing else.
describe("claimlessSaveAdoption — the prova real deadline", () => {
  const DEADLINE = "2026-08-21T19:30:04.210Z";
  const SENT_REAL: RunDraftPayload = realDraftPayload({
    questionIds: ["q1", "q2", "q3"],
    cursor: 1,
    answers: [answer("q1")],
    deadlineAt: DEADLINE,
    token: null,
  });
  const realRow = (overrides: Partial<PersistedDraft> = {}): PersistedDraft =>
    draft({
      mode: "real",
      setup: { mode: "real" },
      modeState: { mode: "real" },
      elapsedSeconds: 0,
      // The same instant as DEADLINE, in the raw PG text drizzle returns.
      deadlineAt: "2026-08-21 19:30:04.210000+00",
      ...overrides,
    });

  it("adopts our own row across the ISO ⇄ PG text shapes of one instant", () => {
    expect(claimlessSaveAdoption({ read: true, row: realRow() }, SENT_REAL)).toEqual({
      id: realRow().id,
      lastSavedAt: PG_TOKEN,
    });
  });

  it("refuses a live exam that differs ONLY by its deadline", () => {
    const otherDevice = realRow({ deadlineAt: "2026-08-21 19:22:11.000000+00" });
    expect(claimlessSaveAdoption({ read: true, row: otherDevice }, SENT_REAL)).toBeNull();
  });

  it("fails closed on a deadline neither side can read strictly", () => {
    const unreadable = realRow({ deadlineAt: "2026" });
    expect(claimlessSaveAdoption({ read: true, row: unreadable }, SENT_REAL)).toBeNull();
  });

  it("refuses a row with no deadline at all for a save that sent one", () => {
    expect(
      claimlessSaveAdoption({ read: true, row: realRow({ deadlineAt: null }) }, SENT_REAL),
    ).toBeNull();
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
    // As the column really behaves: only the prova real sends one, and the
    // router writes `input.deadlineAt ?? null`.
    deadlineAt: "deadlineAt" in payload ? payload.deadlineAt : null,
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

// Ownership by NONCE (Codex round five): the identity this tab mints once per
// run and stamps into every save, carried in the mode_state jsonb. Stronger
// than the content echo — content can coincide, an opaque nonce cannot be
// produced by another device — and, unlike the capped echo memory it replaced,
// it does not decay with the number of attempts.
describe("stampRunNonce / runNonceAdoption", () => {
  const NONCE = "11111111-2222-4333-8444-555555555555";

  it("carries the nonce in the payload's own jsonb — no column, no migration", () => {
    const stamped = stampRunNonce(standardDraftPayload(run({ token: null })), NONCE);
    expect(stamped.modeState).toEqual({
      mode: "standard",
      carriedTime: { q2: 42 },
      runNonce: NONCE,
    });
    // Everything else travels untouched — the stamp is not a rewrite.
    expect(stamped.questionIds).toEqual(["q1", "q2", "q3"]);
    expect(stamped.token).toBeNull();
  });

  it("stamps every mode, so no mode is left with the old lockout", () => {
    const real = stampRunNonce(
      realDraftPayload({
        questionIds: ["q1"],
        cursor: 0,
        answers: [answer("q1")],
        deadlineAt: "2026-08-21T19:30:04.210Z",
        token: null,
      }),
      NONCE,
    );
    expect(real.modeState).toEqual({ mode: "real", runNonce: NONCE });
  });

  it("adopts a row carrying THIS run's nonce, whatever its payload has become", () => {
    // The row holds the FIRST attempt's answers; the run has moved on. Content
    // can no longer prove anything — the nonce still does.
    const row = draft({
      modeState: { mode: "standard", carriedTime: { q2: 42 }, runNonce: NONCE },
      cursor: 3,
      answers: [answer("q1"), answer("q2")],
    });
    expect(runNonceAdoption({ read: true, row }, NONCE)).toEqual({
      id: row.id,
      lastSavedAt: PG_TOKEN,
    });
  });

  it("refuses another run's nonce and a row with no nonce at all", () => {
    const foreign = draft({
      modeState: { mode: "standard", carriedTime: { q2: 42 }, runNonce: "other-run" },
    });
    expect(runNonceAdoption({ read: true, row: foreign }, NONCE)).toBeNull();
    // A row written before the nonce existed: absent is never a match.
    expect(runNonceAdoption({ read: true, row: draft() }, NONCE)).toBeNull();
  });

  it("refuses an unread probe, an absent row and an empty nonce", () => {
    const row = draft({
      modeState: { mode: "standard", carriedTime: { q2: 42 }, runNonce: NONCE },
    });
    expect(runNonceAdoption({ read: false, row }, NONCE)).toBeNull();
    expect(runNonceAdoption({ read: true, row: null }, NONCE)).toBeNull();
    expect(runNonceAdoption({ read: true, row: draft() }, "")).toBeNull();
  });

  it("mints a different nonce per run — a new run never adopts the old row", () => {
    expect(createRunNonce()).not.toBe(createRunNonce());
  });
});

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

    const nonce = createRunNonce();
    const first = await saveRun(standardDraftPayload(run({ token: null })), io, nonce);
    expect(first.draftId).toBe("row-1");
    expect(first.lastSavedAt).toBe(server.row()?.lastSavedAt);
    // The row IS this payload, so nothing is left owed.
    expect(first.owed).toBe(false);

    // The retry now carries the adopted token: an UPDATE of our own row, not a
    // second INSERT. Without the adoption this line throws CONFLICT forever.
    const second = await saveRun(
      standardDraftPayload(run({ token: first.lastSavedAt, cursor: 2 })),
      io,
      nonce,
    );
    expect(second.lastSavedAt).not.toBe(first.lastSavedAt);
    expect(server.row()?.cursor).toBe(2);

    const third = await saveRun(
      standardDraftPayload(run({ token: second.lastSavedAt, cursor: 3 })),
      io,
      nonce,
    );
    expect(server.row()?.lastSavedAt).toBe(third.lastSavedAt);
  });

  it("adopts on the OVERWRITE_CONFLICT too — that row is this tab's own write", async () => {
    // The retry AFTER a lost first save: the row is already there, so the
    // router answers OVERWRITE_CONFLICT. Reading that as "another device" is
    // what made the student collide with themselves, terminally
    // (`raiseIfConflict` closes the scheduler for good). The echo decides.
    const server = fakeDraftsServer();
    const nonce = createRunNonce();
    const payload = standardDraftPayload(run({ token: null }));
    // The lost write is the one `saveRun` sends, i.e. the STAMPED payload.
    expect(() => server.save(stampRunNonce(payload, nonce))).not.toThrow();
    const adopted = await saveRun(
      payload,
      {
        save: (input) => Promise.resolve(server.save(input)),
        probe: () => Promise.resolve({ read: true, row: server.row() }),
      },
      nonce,
    );
    expect(adopted.draftId).toBe("row-1");
    expect(adopted.lastSavedAt).toBe(server.row()?.lastSavedAt);
  });

  it("rethrows a CONFLICT untouched — that dialog is the student's to answer", async () => {
    const server = fakeDraftsServer();
    server.save(standardDraftPayload(run({ token: null, questionIds: ["z9"] }))); // other device
    await expect(
      saveRun(
        standardDraftPayload(run({ token: null })),
        {
          save: (input) => Promise.resolve(server.save(input)),
          probe: () => Promise.resolve({ read: true, row: server.row() }),
        },
        createRunNonce(),
      ),
    ).rejects.toMatchObject({ data: { code: "CONFLICT" } });
  });

  it("rethrows when the probe cannot read — a retry beats a guess", async () => {
    await expect(
      saveRun(
        standardDraftPayload(run({ token: null })),
        {
          save: () => Promise.reject(LOST_RESPONSE),
          probe: () => Promise.resolve({ read: false, row: null }),
        },
        createRunNonce(),
      ),
    ).rejects.toBe(LOST_RESPONSE);
  });

  it("leaves a save that carried a token exactly as it was", async () => {
    await expect(
      saveRun(
        standardDraftPayload(run({ token: PG_TOKEN })),
        {
          save: () => Promise.reject(LOST_RESPONSE),
          probe: () => Promise.reject(new Error("must not be probed")),
        },
        createRunNonce(),
      ),
    ).rejects.toBe(LOST_RESPONSE);
  });
});
