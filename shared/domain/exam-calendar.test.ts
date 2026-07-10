// shared/domain/exam-calendar.test.ts

import { describe, expect, it } from "vitest";
import { deriveEventDate } from "./exam-calendar";

describe("deriveEventDate", () => {
  // Valid dates from prod data
  it("parses 20/12/2026 → 2026-12-20", () => {
    expect(deriveEventDate("20/12/2026")).toBe("2026-12-20");
  });
  it("parses 31/07/2026 → 2026-07-31", () => {
    expect(deriveEventDate("31/07/2026")).toBe("2026-07-31");
  });
  it("parses 21/02/2027 → 2027-02-21", () => {
    expect(deriveEventDate("21/02/2027")).toBe("2027-02-21");
  });
  it("parses leading-zero 01/06/2026 → 2026-06-01", () => {
    expect(deriveEventDate("01/06/2026")).toBe("2026-06-01");
  });

  // Period / range strings → null
  it("returns null for period with en-dash '01–15/02/2026'", () => {
    expect(deriveEventDate("01–15/02/2026")).toBeNull();
  });
  it("returns null for range '03 e 04/05/2026'", () => {
    expect(deriveEventDate("03 e 04/05/2026")).toBeNull();
  });

  // Empty / junk → null
  it("returns null for empty string", () => {
    expect(deriveEventDate("")).toBeNull();
  });

  // Calendar-invalid dates → null
  it("returns null for day 32: 32/01/2026", () => {
    expect(deriveEventDate("32/01/2026")).toBeNull();
  });
  it("returns null for month 13: 15/13/2026", () => {
    expect(deriveEventDate("15/13/2026")).toBeNull();
  });
  it("returns null for Feb 29 on non-leap year 2027", () => {
    expect(deriveEventDate("29/02/2027")).toBeNull();
  });
  it("accepts Feb 29 on leap year 2028", () => {
    expect(deriveEventDate("29/02/2028")).toBe("2028-02-29");
  });
});
