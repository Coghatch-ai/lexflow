import { describe, expect, it } from "vitest";
import { DEFAULT_ADAPTIVE_CONFIG, nextDifficulty } from "./adaptive";

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
