import { describe, expect, it } from "vitest";
import { META_SEP } from "./ui-format";

describe("META_SEP", () => {
  it("is U+2022 bullet", () => {
    expect(META_SEP).toBe("•");
  });

  it("is not U+00B7 middle-dot", () => {
    expect(META_SEP).not.toBe("·");
  });
});
