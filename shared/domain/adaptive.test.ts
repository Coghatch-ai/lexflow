import { describe, expect, it } from "vitest";
import { DEFAULT_ADAPTIVE_CONFIG, nextDifficulty, type AdaptiveState } from "./adaptive";

describe("nextDifficulty", () => {
  it("steps up after 2 correct", () => {
    expect(nextDifficulty("medium", 2, 0)).toBe("hard");
  });
  it("steps down after 2 wrong", () => {
    expect(nextDifficulty("medium", 0, 2)).toBe("easy");
  });
  it("stays put otherwise", () => {
    expect(nextDifficulty("medium", 1, 1)).toBe("medium");
  });
  it("never steps past the ends", () => {
    expect(nextDifficulty("hard", 5, 0)).toBe("hard");
    expect(nextDifficulty("easy", 0, 5)).toBe("easy");
  });
  it("honors a custom config", () => {
    const cfg = { ...DEFAULT_ADAPTIVE_CONFIG, stepUpAfter: 1 };
    expect(nextDifficulty("easy", 1, 0, cfg)).toBe("medium");
  });
});

// The ladder is PURE over the persisted streaks, which is what makes a resumed
// adaptive run identical to one that was never interrupted: `exam_drafts.
// mode_state` stores this state verbatim (epic #67 S2a) and replays it.
//
// `answerAndAdvance` mirrors AdaptiveSimulation.tsx: answering bumps the streaks
// (handleAnswer, :177-183), moving on picks the level for the next question
// (handleNext → advanceTo, :247-252). Streaks are NOT reset by a step. The
// assertions below are on LITERAL ladders, not on a second call of the function
// under test — comparing nextDifficulty(a,b,c) to nextDifficulty(a,b,c) is a
// tautology and guards nothing (the shape review #75 rejected).
const START: AdaptiveState = {
  currentDifficulty: "medium",
  consecutiveCorrect: 0,
  consecutiveWrong: 0,
  totalCorrect: 0,
  totalAnswered: 0,
  difficultyHistory: [],
};

function answerAndAdvance(state: AdaptiveState, correct: boolean): AdaptiveState {
  const consecutiveCorrect = correct ? state.consecutiveCorrect + 1 : 0;
  const consecutiveWrong = correct ? 0 : state.consecutiveWrong + 1;
  const served = nextDifficulty(state.currentDifficulty, consecutiveCorrect, consecutiveWrong);
  return {
    currentDifficulty: served,
    consecutiveCorrect,
    consecutiveWrong,
    totalCorrect: state.totalCorrect + (correct ? 1 : 0),
    totalAnswered: state.totalAnswered + 1,
    difficultyHistory: [...state.difficultyHistory, served],
  };
}

const play = (from: AdaptiveState, outcomes: readonly boolean[]): AdaptiveState =>
  outcomes.reduce(answerAndAdvance, from);

/** jsonb round-trip, exactly what exam_drafts.mode_state does to this object. */
const roundTrip = (state: AdaptiveState): AdaptiveState =>
  JSON.parse(JSON.stringify(state)) as AdaptiveState;

describe("resuming from a persisted AdaptiveState", () => {
  // 8 answers: up, then three wrong down two levels, then back up.
  const OUTCOMES = [true, true, false, false, false, true, true, true] as const;
  const LADDER = ["medium", "hard", "hard", "medium", "easy", "easy", "medium", "hard"];

  it("walks the expected ladder when nothing interrupts it", () => {
    const finished = play(START, OUTCOMES);
    expect(finished.difficultyHistory).toEqual(LADDER);
    expect(finished.currentDifficulty).toBe("hard");
    expect(finished.consecutiveCorrect).toBe(3);
    expect(finished.totalCorrect).toBe(5);
    expect(finished.totalAnswered).toBe(8);
  });

  it("a run saved mid-way and replayed through jsonb ends IDENTICAL", () => {
    const beforeSave = play(START, OUTCOMES.slice(0, 4));
    const persisted = roundTrip(beforeSave);
    expect(persisted).toEqual(beforeSave); // nothing of the ladder is lost in jsonb

    const resumed = play(persisted, OUTCOMES.slice(4));
    expect(resumed).toEqual(play(START, OUTCOMES));
    expect(resumed.difficultyHistory).toEqual(LADDER);
    expect(resumed.currentDifficulty).toBe("hard");
  });

  it("resumes ON the step-up rung itself (consecutiveCorrect === stepUpAfter)", () => {
    // The exact rung where a lost streak is invisible for one more answer: the
    // run was saved with the step-up already earned, so the level the resumed
    // run SERVES next must be the stepped-up one, not the level it saved at.
    const saved = roundTrip(play(START, [true, true]));
    expect(saved.consecutiveCorrect).toBe(DEFAULT_ADAPTIVE_CONFIG.stepUpAfter);
    expect(saved.currentDifficulty).toBe("hard");
    expect(
      nextDifficulty(saved.currentDifficulty, saved.consecutiveCorrect, saved.consecutiveWrong),
    ).toBe("hard");
    // …and one more correct answer does NOT climb past the top of the ladder.
    expect(play(saved, [true]).currentDifficulty).toBe("hard");
  });

  it("resuming keeps the STREAK, so the next answer can step up immediately", () => {
    // Saved one correct answer into a streak; a run that dropped the streak on
    // resume would need two more correct answers to reach hard, not one.
    const saved = roundTrip(play(START, [true]));
    expect(saved.consecutiveCorrect).toBe(1);
    expect(play(saved, [true]).currentDifficulty).toBe("hard");
    expect(play(START, [true]).currentDifficulty).toBe("medium");
  });
});
