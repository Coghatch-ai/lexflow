// shared/domain/exam-countdown.ts
//
// Pure date-math helpers for the exam countdown badge.
// Shared by the API and the UI — no browser/node globals beyond Date.
// Must not import anything from app/ or api/.

/**
 * Days remaining until an ISO date string (YYYY-MM-DD).
 *
 * The date is interpreted at local midnight (T00:00:00) to avoid the
 * UTC-midnight off-by-one that arises when Date.parse() treats a bare
 * date string as UTC (which places it a day behind in BRT, UTC-3).
 *
 * Returns a positive integer when the event is in the future, 0 on the
 * event day, and a negative number for past events.
 */
export function daysUntil(eventDate: string, now: Date = new Date()): number {
  const target = new Date(`${eventDate}T00:00:00`);
  const msPerDay = 86_400_000;
  return Math.ceil((target.getTime() - now.getTime()) / msPerDay);
}

/**
 * Time-until decomposition for a live D:H:M:S countdown.
 *
 * Uses the SAME local-midnight anchor (`${eventDate}T00:00:00`) as `daysUntil`
 * so the badge day-count and the live seconds never drift apart.
 *
 * floor semantics (elapsed-to-go) vs. `daysUntil`'s ceil semantics
 * (calendar days). Intentional divergence — do NOT align them.
 * `daysUntil` answers "how many calendar days away?"; this answers
 * "how many whole d/h/m/s remain?". Counts down to 00:00:00 local on
 * the exam day (no time-of-day in the data model).
 *
 * Clamped to >= 0; `totalMs === 0` means the event has passed mid-view.
 */
export function timeUntilParts(
  eventDate: string,
  now: Date = new Date(),
): { days: number; hours: number; minutes: number; seconds: number; totalMs: number } {
  const target = new Date(`${eventDate}T00:00:00`).getTime();
  const diff = Math.max(0, target - now.getTime());
  return {
    days: Math.floor(diff / 86_400_000),
    hours: Math.floor(diff / 3_600_000) % 24,
    minutes: Math.floor(diff / 60_000) % 60,
    seconds: Math.floor(diff / 1_000) % 60,
    totalMs: diff,
  };
}

/**
 * Shape of a calendar event as returned by the calendars.listActive tRPC
 * procedure (only the fields this module needs).
 */
export interface CountdownEvent {
  readonly eventDate: string | null;
}

/**
 * From a flat array of calendar events, returns the one that is closest to
 * `now` while still being in the future (days > 0), or `null` if every event
 * has no structured date, is today, or has already passed.
 */
export function nextUpcomingEvent<T extends CountdownEvent>(
  events: ReadonlyArray<T>,
  now: Date = new Date(),
): T | null {
  let best: T | null = null;
  let bestDays = Infinity;

  for (const ev of events) {
    if (ev.eventDate === null) continue;
    const days = daysUntil(ev.eventDate, now);
    if (days > 0 && days < bestDays) {
      best = ev;
      bestDays = days;
    }
  }

  return best;
}
