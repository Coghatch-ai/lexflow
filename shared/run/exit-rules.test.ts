import { describe, expect, it } from "vitest";
import {
  type AnswerDraft,
  type RunMode,
  answeredStats,
  exitPrompt,
  processableAnswers,
  rowsForAnswers,
  shouldPromptOnExit,
} from "./exit-rules";

const ALL_MODES: RunMode[] = ["standard", "adaptive", "spaced", "real"];
const STUDY_MODES: RunMode[] = ["standard", "adaptive", "spaced"];

function draft(id: string, userAnswer: string, correct: boolean): AnswerDraft {
  return { questionId: id, userAnswer, correct, timeSpent: 10 };
}

describe("exitPrompt", () => {
  it("warns the prova real cannot be saved and uses the exam labels (BR-05.5)", () => {
    const prompt = exitPrompt("real", 5, 80);
    expect(prompt.warning).not.toBeNull();
    expect(prompt.warning).toContain("não pode ser salva");
    expect(prompt.continueLabel).toBe("Continuar prova");
    expect(prompt.quitLabel).toBe("Encerrar e processar respostas");
  });

  it("offers no warning on a study mode", () => {
    expect(exitPrompt("standard", 5, 10).warning).toBeNull();
    expect(exitPrompt("standard", 5, 10).continueLabel).toBe("Continuar");
    expect(exitPrompt("standard", 5, 10).quitLabel).toBe("Sair e processar respostas");
  });

  // Rewritten in S2b (#77): S1 locked the OPPOSITE — two options everywhere and
  // no label containing "salvar" — because no run could be saved yet. Server-side
  // persistence exists since S2a, so the three study modes now offer the third
  // action and only the prova real still refuses it (BR-05.3 / BR-05.5).
  it("offers 'Salvar e sair' as a third action on the study modes (BR-05.3)", () => {
    for (const mode of STUDY_MODES) {
      const prompt = exitPrompt(mode, 3, 10);
      expect(prompt.optionCount).toBe(3);
      expect(prompt.saveLabel).toBe("Salvar e sair");
      expect(prompt.title.length).toBeGreaterThan(0);
      expect(prompt.body).toContain("3");
    }
  });

  it("never offers to save the prova real (BR-05.5)", () => {
    const prompt = exitPrompt("real", 3, 80);
    expect(prompt.optionCount).toBe(2);
    expect(prompt.saveLabel).toBeNull();
    expect(prompt.continueLabel.toLowerCase()).not.toContain("salvar");
    expect(prompt.quitLabel.toLowerCase()).not.toContain("salvar");
  });

  it("keeps the two original actions in every mode, save or no save", () => {
    for (const mode of ALL_MODES) {
      const prompt = exitPrompt(mode, 3, 10);
      expect(prompt.continueLabel.length).toBeGreaterThan(0);
      expect(prompt.quitLabel.length).toBeGreaterThan(0);
      // The count is the CONTRACT the dialog renders against: 2 buttons + the
      // save one only where `saveLabel` exists.
      expect(prompt.optionCount).toBe(prompt.saveLabel === null ? 2 : 3);
    }
  });
});

describe("shouldPromptOnExit", () => {
  it("stays silent with zero answers and asks from the first one (criterion 5)", () => {
    expect(shouldPromptOnExit(0)).toBe(false);
    expect(shouldPromptOnExit(1)).toBe(true);
    expect(shouldPromptOnExit(12)).toBe(true);
  });
});

describe("processableAnswers", () => {
  it("drops blank answers and keeps the answered ones (BR-05.6 / BR-03)", () => {
    const drafts: AnswerDraft[] = [
      draft("q1", "A", true),
      draft("q2", "", false),
      draft("q3", "C", false),
      draft("q4", "", false),
    ];
    const processable = processableAnswers(drafts);
    expect(processable).toHaveLength(2);
    expect(processable.map((a) => a.questionId)).toEqual(["q1", "q3"]);
  });

  it("never records an unanswered question as wrong", () => {
    const blanks = [draft("q1", "", false), draft("q2", "", false)];
    expect(processableAnswers(blanks)).toEqual([]);
  });

  it("drops a checked-but-blank current question appended on quit (all 4 screens)", () => {
    // "Sair e processar" appends the question on screen when it was checked.
    // A cross-out (BR-02) can leave that selection blank, so the tail draft must
    // be filtered out exactly like any other blank — never sent to sessions.record.
    const withBlankTail = [draft("q1", "A", true), draft("q2", "", false)];
    expect(processableAnswers(withBlankTail).map((a) => a.questionId)).toEqual(["q1"]);

    // And when the blank tail is the ONLY draft, nothing is processable: the
    // screen exits silently instead of calling sessions.record (answers.min(1)).
    expect(processableAnswers([draft("q1", "", false)])).toHaveLength(0);
  });

  it("does not mutate its input", () => {
    const drafts = [draft("q1", "A", true), draft("q2", "", false)];
    processableAnswers(drafts);
    expect(drafts).toHaveLength(2);
  });
});

describe("answeredStats", () => {
  it("counts against what was answered, never against the queue", () => {
    const drafts: AnswerDraft[] = [];
    for (let i = 0; i < 12; i++) drafts.push(draft(`q${String(i)}`, "A", i < 8));
    expect(answeredStats(drafts)).toEqual({ answered: 12, correct: 8, wrong: 4 });
  });

  it("ignores blanks so they weigh neither as right nor as wrong", () => {
    const drafts = [draft("q1", "A", true), draft("q2", "", false), draft("q3", "B", false)];
    expect(answeredStats(drafts)).toEqual({ answered: 2, correct: 1, wrong: 1 });
  });

  it("is all zeros on an empty run", () => {
    expect(answeredStats([])).toEqual({ answered: 0, correct: 0, wrong: 0 });
  });
});

describe("rowsForAnswers", () => {
  it("returns one row per answer on a partial run, without throwing", () => {
    const questions = Array.from({ length: 30 }, (_, i) => ({ id: `q${String(i)}` }));
    const answers = Array.from({ length: 12 }, (_, i) => draft(`q${String(i)}`, "A", i % 2 === 0));
    const rows = rowsForAnswers(questions, answers);
    expect(rows).toHaveLength(12);
    expect(rows[0]?.question.id).toBe("q0");
    expect(rows[11]?.answer.questionId).toBe("q11");
  });

  it("keeps the answer order, not the queue order (postponed questions)", () => {
    const questions = [{ id: "q1" }, { id: "q2" }, { id: "q3" }];
    const answers = [draft("q3", "A", true), draft("q1", "B", false)];
    expect(rowsForAnswers(questions, answers).map((r) => r.question.id)).toEqual(["q3", "q1"]);
  });

  it("skips an answer whose question is not in the queue", () => {
    const questions = [{ id: "q1" }];
    const answers = [draft("q1", "A", true), draft("ghost", "B", false)];
    expect(rowsForAnswers(questions, answers)).toHaveLength(1);
  });

  it("drops blank answers so a partial run never shows them as wrong", () => {
    const questions = [{ id: "q1" }, { id: "q2" }];
    const answers = [draft("q1", "A", true), draft("q2", "", false)];
    expect(rowsForAnswers(questions, answers)).toHaveLength(1);
  });
});
