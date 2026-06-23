// shared/domain/exam-countdown.test.ts

import { describe, expect, it } from "vitest";
import { daysUntil, nextUpcomingEvent, type CountdownEvent } from "./exam-countdown";

describe("daysUntil", () => {
  it("returns 3 for a date 3 days in the future (noon anchor)", () => {
    // Handoff assert: daysUntil('2026-06-25', new Date('2026-06-22T12:00:00')) === 3
    expect(daysUntil("2026-06-25", new Date("2026-06-22T12:00:00"))).toBe(3);
  });

  it("returns 0 when now is exactly at local midnight of the event day", () => {
    expect(daysUntil("2026-06-25", new Date("2026-06-25T00:00:00"))).toBe(0);
  });

  it("returns a negative number for past dates", () => {
    expect(daysUntil("2026-06-20", new Date("2026-06-22T12:00:00"))).toBeLessThan(0);
  });

  it("guards against the UTC bare-date off-by-one in BRT (UTC-3)", () => {
    // Date.parse('2026-06-25') treats it as UTC midnight = 2026-06-24T21:00:00 local BRT.
    // Our impl uses T00:00:00 (local) so the event day is local, not UTC.
    // At 2026-06-24T23:00:00 local the event should still be 1 day away.
    expect(daysUntil("2026-06-25", new Date("2026-06-24T23:00:00"))).toBe(1);
  });

  it("returns 1 when now is just before midnight of the previous day", () => {
    expect(daysUntil("2026-06-25", new Date("2026-06-24T23:59:59"))).toBe(1);
  });
});

describe("nextUpcomingEvent", () => {
  it("returns null for an empty array", () => {
    expect(nextUpcomingEvent([], new Date("2026-06-22T12:00:00"))).toBeNull();
  });

  it("returns null when all events have null eventDate", () => {
    const events: CountdownEvent[] = [{ eventDate: null }, { eventDate: null }];
    expect(nextUpcomingEvent(events, new Date("2026-06-22T12:00:00"))).toBeNull();
  });

  it("returns null when all dated events are in the past or today", () => {
    const events: CountdownEvent[] = [{ eventDate: "2026-06-20" }, { eventDate: "2026-06-22" }];
    // now = noon on 2026-06-22; "2026-06-22" => days = 0, excluded (not > 0)
    expect(nextUpcomingEvent(events, new Date("2026-06-22T12:00:00"))).toBeNull();
  });

  it("picks the nearest future event among multiple", () => {
    const near: CountdownEvent = { eventDate: "2026-06-25" };
    const far: CountdownEvent = { eventDate: "2026-07-10" };
    const past: CountdownEvent = { eventDate: "2026-06-10" };
    const nullDate: CountdownEvent = { eventDate: null };
    const events = [far, nullDate, past, near];
    expect(nextUpcomingEvent(events, new Date("2026-06-22T12:00:00"))).toBe(near);
  });

  it("skips null-date events and picks the only future dated event", () => {
    const future: CountdownEvent = { eventDate: "2026-08-01" };
    const events: CountdownEvent[] = [{ eventDate: null }, future, { eventDate: null }];
    expect(nextUpcomingEvent(events, new Date("2026-06-22T12:00:00"))).toBe(future);
  });
});
