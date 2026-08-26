import { describe, expect, it } from "vitest";
import { moveToEnd } from "./exam-queue";
import {
  adoptableDraftId,
  appendAnswer,
  claimFor,
  claimOutcomeFor,
  claimlessVerdictFor,
  conflictFor,
  dedupeAnswers,
  isConflictError,
  needsClaimlessProbe,
  persistedDraftOf,
  resumableFor,
  resumeStateFrom,
  saveFailureFor,
  standardDraftPayload,
  type PersistedDraft,
  type StandardRunState,
} from "./run-persistence";
import type { AnswerDraft } from "@shared/domain/exam-draft";

// The RAW PostgreSQL text of `exam_drafts.last_saved_at`: microseconds, a
// space instead of `T`, `+00` instead of `Z`. Every normalisation this project
// could reach for (`new Date(t).toISOString()`, `Date.parse`) destroys it, and
// the column is matched with `=` in SQL — so it is the fixture.
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

describe("standardDraftPayload", () => {
  it("returns the token VERBATIM — no Date, no toISOString, no normalisation", () => {
    const payload = standardDraftPayload(run());
    // The killer assertion: `last_saved_at` is compared with `=` in SQL, so a
    // round-trip through Date (which drops the microseconds) makes every claim
    // match zero rows and hands the student a CONFLICT on their own save.
    expect(payload.token).toBe(PG_TOKEN);
    expect(payload.token).toContain(".210932");
    expect(payload.token).not.toBe(new Date(PG_TOKEN).toISOString());
  });

  it("carries a null token on the first save", () => {
    expect(standardDraftPayload(run({ token: null })).token).toBeNull();
  });

  it("preserves the queue order after a 'Responder depois' (BR-03)", () => {
    const reordered = moveToEnd(["q1", "q2", "q3"], 0);
    const payload = standardDraftPayload(run({ questionIds: reordered }));
    expect(payload.questionIds).toEqual(["q2", "q3", "q1"]);
  });

  it("serialises carriedTime from the Map into a plain record", () => {
    const payload = standardDraftPayload(
      run({
        carriedTime: new Map([
          ["q2", 42],
          ["q3", 7],
        ]),
      }),
    );
    expect(payload.modeState).toEqual({ mode: "standard", carriedTime: { q2: 42, q3: 7 } });
  });

  it("never sends deadlineAt — only the prova real has an absolute deadline", () => {
    expect("deadlineAt" in standardDraftPayload(run())).toBe(false);
  });

  it("agrees with itself on the three discriminators (the router refuses otherwise)", () => {
    const payload = standardDraftPayload(run());
    expect(payload.mode).toBe("standard");
    expect(payload.setup.mode).toBe("standard");
    expect(payload.modeState.mode).toBe("standard");
  });

  it("copies the queue and the answers instead of aliasing the live arrays", () => {
    const questionIds = ["q1", "q2"];
    const payload = standardDraftPayload(run({ questionIds }));
    questionIds.push("q3");
    expect(payload.questionIds).toEqual(["q1", "q2"]);
  });
});

describe("resumeStateFrom", () => {
  it("re-imposes the frozen queue order on the shuffled rows byIds returned", () => {
    const fetched = [{ id: "q3" }, { id: "q1" }, { id: "q2" }];
    const state = resumeStateFrom(draft(), fetched);
    expect(state.discard).toBe(false);
    if (state.discard) return;
    expect(state.questions.map((q) => q.id)).toEqual(["q1", "q2", "q3"]);
  });

  it("resumes at the START of the cursor question: no checked, no timeSpent (D8)", () => {
    const state = resumeStateFrom(draft(), [{ id: "q1" }, { id: "q2" }, { id: "q3" }]);
    if (state.discard) throw new Error("unexpected discard");
    expect(state.cursor).toBe(1);
    expect(state.checked).toBe(false);
    expect(state.timeSpent).toBe(0);
  });

  it("echoes elapsedSeconds so the clock resumes where it stopped (BR-05.10)", () => {
    const state = resumeStateFrom(draft({ elapsedSeconds: 907 }), [
      { id: "q1" },
      { id: "q2" },
      { id: "q3" },
    ]);
    if (state.discard) throw new Error("unexpected discard");
    expect(state.elapsedSeconds).toBe(907);
  });

  it("rebuilds carriedTime so a postponed question keeps the time already spent", () => {
    const state = resumeStateFrom(draft(), [{ id: "q1" }, { id: "q2" }, { id: "q3" }]);
    if (state.discard) throw new Error("unexpected discard");
    expect(state.carriedTime.get("q2")).toBe(42);
  });

  it("drops a question that left the catalog from the queue AND from the answers", () => {
    const persisted = draft({
      questionIds: ["q1", "gone", "q3"],
      cursor: 2,
      answers: [answer("q1"), answer("gone")],
      modeState: { mode: "standard", carriedTime: { gone: 90, q3: 11 } },
    });
    const state = resumeStateFrom(persisted, [{ id: "q1" }, { id: "q3" }]);
    if (state.discard) throw new Error("unexpected discard");

    expect(state.questions.map((q) => q.id)).toEqual(["q1", "q3"]);
    expect(state.answers.map((a) => a.questionId)).toEqual(["q1"]);
    // The cursor still points at the question the student was on…
    expect(state.cursor).toBe(1);
    // …the carried time of the vanished id is pruned, the survivor's is kept…
    expect(state.carriedTime.has("gone")).toBe(false);
    expect(state.carriedTime.get("q3")).toBe(11);
    // …and the screen is told, so it can show "N" as the survivors.
    expect(state.dropped).toBe(1);
  });

  it("clamps a cursor left past the end of the surviving queue", () => {
    const persisted = draft({ questionIds: ["q1", "q2", "q3"], cursor: 2 });
    const state = resumeStateFrom(persisted, [{ id: "q1" }]);
    if (state.discard) throw new Error("unexpected discard");
    expect(state.cursor).toBe(0);
    expect(state.questions).toHaveLength(1);
  });

  it("asks for a discard when NOTHING survived", () => {
    const state = resumeStateFrom(draft(), []);
    expect(state).toEqual({ discard: true, dropped: 3 });
  });

  it("keeps the setup filters so the recorded session is filed the same way", () => {
    const state = resumeStateFrom(draft(), [{ id: "q1" }, { id: "q2" }, { id: "q3" }]);
    if (state.discard) throw new Error("unexpected discard");
    expect(state.setup).toEqual({ discipline: "CIVIL_LAW", examBoard: "FGV", difficulty: null });
  });

  it("carries the whole fetched row through, not just the id", () => {
    const fetched = [{ id: "q1", questionText: "Qual?" }];
    const state = resumeStateFrom(draft({ questionIds: ["q1"], cursor: 0, answers: [] }), fetched);
    if (state.discard) throw new Error("unexpected discard");
    expect(state.questions[0]?.questionText).toBe("Qual?");
  });
});

describe("claimFor", () => {
  it("pairs the id with the token", () => {
    expect(claimFor("draft-1", PG_TOKEN)).toEqual({ id: "draft-1", lastSavedAt: PG_TOKEN });
  });

  it("returns undefined — never { id } alone — when the token is missing", () => {
    const claim = claimFor("draft-1", null);
    expect(claim).toBeUndefined();
  });

  it("returns undefined for a run that was never persisted", () => {
    expect(claimFor(null, PG_TOKEN)).toBeUndefined();
    expect(claimFor(null, null)).toBeUndefined();
    expect(claimFor("", PG_TOKEN)).toBeUndefined();
    expect(claimFor("draft-1", "")).toBeUndefined();
  });

  it("does not normalise the token it pairs", () => {
    expect(claimFor("draft-1", PG_TOKEN)?.lastSavedAt).toBe(PG_TOKEN);
  });
});

describe("conflictFor", () => {
  it("tells the student the run was continued elsewhere when THIS tab had a token", () => {
    const conflict = conflictFor(true);
    expect(conflict.kind).toBe("remote");
    expect(conflict.title).toContain("continuado em outro aparelho");
    expect(conflict.reloadLabel).toBe("Recarregar do servidor");
    expect(conflict.discardLabel).toBe("Descartar esta cópia");
    expect(conflict.discardTarget).toBe("local");
  });

  it("tells the student a run already exists when the FIRST save lost (BR-05.8)", () => {
    const conflict = conflictFor(false);
    expect(conflict.kind).toBe("live");
    expect(conflict.title).toContain("Já existe um teste em andamento");
    expect(conflict.reloadLabel).toBe("Continuar o salvo");
    expect(conflict.discardLabel).toBe("Descartar o salvo");
    expect(conflict.discardTarget).toBe("server");
  });

  it("offers two DIFFERENT action pairs — the copies are not interchangeable", () => {
    const remote = conflictFor(true);
    const live = conflictFor(false);
    expect(remote.title).not.toBe(live.title);
    expect(remote.reloadLabel).not.toBe(live.reloadLabel);
    expect(remote.discardLabel).not.toBe(live.discardLabel);
    expect(remote.discardTarget).not.toBe(live.discardTarget);
  });
});

describe("persistedDraftOf", () => {
  it("restores the null the frontend program cannot infer from examDrafts.get", () => {
    expect(persistedDraftOf(null)).toBeNull();
    expect(persistedDraftOf(undefined)).toBeNull();
  });

  it("passes a real row through untouched", () => {
    const row = draft();
    expect(persistedDraftOf(row)).toBe(row);
  });
});

describe("isConflictError", () => {
  it("recognises the tRPC CONFLICT the optimistic guard raises", () => {
    expect(isConflictError({ data: { code: "CONFLICT" } })).toBe(true);
  });

  it("does NOT stop the autosave for a network blip or any other code", () => {
    expect(isConflictError({ data: { code: "INTERNAL_SERVER_ERROR" } })).toBe(false);
    expect(isConflictError(new Error("Failed to fetch"))).toBe(false);
    expect(isConflictError({ data: null })).toBe(false);
    expect(isConflictError(null)).toBe(false);
    expect(isConflictError(undefined)).toBe(false);
    expect(isConflictError("CONFLICT")).toBe(false);
  });
});

describe("resumableFor", () => {
  const drafts = [
    { mode: "standard", answered: 3, total: 10, lastSavedAt: PG_TOKEN },
    { mode: "spaced", answered: 1, total: 5, lastSavedAt: PG_TOKEN },
  ];

  it("finds the card's own mode and reports the (n/N)", () => {
    const found = resumableFor(drafts, "standard");
    expect(found?.answered).toBe(3);
    expect(found?.total).toBe(10);
  });

  it("ignores a draft of another mode", () => {
    expect(resumableFor(drafts, "adaptive")).toBeNull();
  });

  it("never offers the prova real back (BR-05.5 — list excludes it server-side)", () => {
    expect(resumableFor(drafts, "real")).toBeNull();
  });

  it("is null while the list is still loading", () => {
    expect(resumableFor(undefined, "standard")).toBeNull();
    expect(resumableFor([], "standard")).toBeNull();
  });
});

// The retry that produced two `user_answers` rows for the same question: a
// non-CONFLICT failure puts the run back on screen with the answer ALREADY in
// `answers`, the student clicks "Finalizar" again, and the payload grows.
describe("appendAnswer / dedupeAnswers", () => {
  it("a second Finalizar overwrites the question's answer instead of adding a twin", () => {
    const nine = ["q1", "q2", "q3", "q4", "q5", "q6", "q7", "q8", "q9"].map((id) => answer(id));
    // First click: the last question joins the payload…
    const firstClick = appendAnswer(nine, answer("q10", "B", 30));
    // …the recording fails (offline/500/401), the run comes back, second click.
    const retry = appendAnswer(firstClick, answer("q10", "B", 47));

    expect(retry).toHaveLength(10);
    expect(retry.filter((a) => a.questionId === "q10")).toHaveLength(1);
    // A run of 10 must never record 11 — that was `totalQuestions: 11`.
    expect(new Set(retry.map((a) => a.questionId)).size).toBe(retry.length);
  });

  it("keeps the LAST word on a question (the retry's own timing)", () => {
    const retried = appendAnswer([answer("q1", "A", 12)], answer("q1", "C", 40));
    expect(retried).toEqual([{ questionId: "q1", userAnswer: "C", correct: true, timeSpent: 40 }]);
  });

  it("replaces in place — the answered order (BR-03 postpones) survives", () => {
    const answers = [answer("q1"), answer("q3"), answer("q2")];
    const again = appendAnswer(answers, answer("q3", "D", 99));
    expect(again.map((a) => a.questionId)).toEqual(["q1", "q3", "q2"]);
  });

  it("appends a question that is not in the run yet", () => {
    const grown = appendAnswer([answer("q1")], answer("q2"));
    expect(grown.map((a) => a.questionId)).toEqual(["q1", "q2"]);
  });

  it("dedupes a payload built anywhere else, and is idempotent", () => {
    const duplicated = [answer("q1", "A", 10), answer("q2"), answer("q1", "B", 20)];
    const once = dedupeAnswers(duplicated);
    expect(once.map((a) => a.questionId)).toEqual(["q1", "q2"]);
    expect(once[0]?.userAnswer).toBe("B");
    expect(dedupeAnswers(once)).toEqual(once);
  });
});

// Criterion 5: a persisted run is NEVER recorded without its claim, or the
// draft survives its own session and comes back as "Continuar".
describe("claimOutcomeFor", () => {
  it("records with the claim once both halves are known", () => {
    const outcome = claimOutcomeFor("draft-1", PG_TOKEN);
    expect(outcome.ok).toBe(true);
    expect(outcome.claim).toEqual({ id: "draft-1", lastSavedAt: PG_TOKEN });
    expect(outcome.failure).toBeNull();
  });

  it("refuses to record a PERSISTED run whose id was never learned", () => {
    const outcome = claimOutcomeFor(null, PG_TOKEN);
    expect(outcome.ok).toBe(false);
    expect(outcome.claim).toBeUndefined();
    expect(outcome.failure?.kind).toBe("claim");
  });

  it("records a run that was never persisted, with no claim at all", () => {
    const outcome = claimOutcomeFor(null, null);
    expect(outcome.ok).toBe(true);
    expect(outcome.claim).toBeUndefined();
    expect(outcome.failure).toBeNull();
  });
});

// The #79 audit finding: `claimOutcomeFor(null, null)` above says "record with
// no claim", which is right for a run that was never persisted and WRONG for a
// run whose creating save committed and lost its response. In the prova real
// that second case writes the session, leaves the orphan row alive on top of
// it, and the next lazy settlement records a SECOND session (BR-05.7).
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

// The id read back after a save is only MINE while the row still carries the
// token that save returned. Adopting any other row pairs a foreign id with our
// token, the claiming DELETE matches zero rows, and the student is told the run
// "foi continuado em outro aparelho" — a CONFLICT nobody caused.
describe("adoptableDraftId", () => {
  const OTHER_TOKEN = "2026-08-21 14:31:58.884001+00";

  it("adopts the row this tab just wrote", () => {
    expect(adoptableDraftId(draft({ id: "draft-1" }), PG_TOKEN)).toBe("draft-1");
  });

  it("refuses a row written by someone else — no id, so no FALSE conflict", () => {
    // The regression: `sessions.record` deleted row A, a new run wrote row B,
    // and the read handed A back. Adopting A's id claimed zero rows.
    expect(adoptableDraftId(draft({ id: "row-A", lastSavedAt: OTHER_TOKEN }), PG_TOKEN)).toBeNull();
  });

  it("refuses when the read found no row at all", () => {
    expect(adoptableDraftId(null, PG_TOKEN)).toBeNull();
  });

  it("refuses before this tab has written anything (no token to match against)", () => {
    expect(adoptableDraftId(draft(), null)).toBeNull();
    expect(adoptableDraftId(draft(), "")).toBeNull();
  });

  it("matches the token VERBATIM — a normalised copy is not the same row", () => {
    const normalised = new Date(PG_TOKEN).toISOString();
    expect(adoptableDraftId(draft(), normalised)).toBeNull();
    expect(adoptableDraftId(draft({ lastSavedAt: normalised }), PG_TOKEN)).toBeNull();
  });

  it("hands a refusal to claimOutcomeFor as 'try again', never as a wrong claim", () => {
    // The two halves together: refusing costs a retry, adopting the wrong row
    // costs the student their answers behind a conflict dialog that loops.
    const foreign = adoptableDraftId(draft({ id: "row-A", lastSavedAt: OTHER_TOKEN }), PG_TOKEN);
    const outcome = claimOutcomeFor(foreign, PG_TOKEN);
    expect(outcome.ok).toBe(false);
    expect(outcome.claim).toBeUndefined();
    expect(outcome.failure?.kind).toBe("claim");
  });
});

// A failed exit used to be 100% silent: the student clicked and nothing moved.
describe("saveFailureFor", () => {
  it("tells a dead tunnel apart from an expired session", () => {
    const offline = saveFailureFor({ data: null, message: "Failed to fetch" });
    const auth = saveFailureFor({ data: { code: "UNAUTHORIZED" } });
    expect(offline.kind).toBe("offline");
    expect(offline.title).toContain("conexão");
    expect(auth.kind).toBe("auth");
    expect(auth.title).toContain("sessão");
    expect(auth.title).not.toBe(offline.title);
  });

  it("treats a 403 as the same expired-credentials problem", () => {
    expect(saveFailureFor({ data: { code: "FORBIDDEN" } }).kind).toBe("auth");
  });

  it("has its own copy for a server that answered and refused", () => {
    expect(saveFailureFor({ data: { code: "INTERNAL_SERVER_ERROR" } }).kind).toBe("server");
  });

  it("never returns an empty message, whatever it was handed", () => {
    for (const thrown of [null, undefined, "boom", new Error("boom"), { data: {} }]) {
      const failure = saveFailureFor(thrown);
      expect(failure.title.length).toBeGreaterThan(0);
      expect(failure.body.length).toBeGreaterThan(0);
      expect(failure.dismissLabel.length).toBeGreaterThan(0);
    }
  });
});
