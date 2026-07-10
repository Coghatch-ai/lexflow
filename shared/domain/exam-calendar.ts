// shared/domain/exam-calendar.ts
//
// Pure helpers for the exam calendar domain.
// Shared by api/ and app/ — no browser/node globals beyond Date.
// Must not import anything from app/ or api/.

/**
 * Parse a Brazilian-formatted date string (`DD/MM/YYYY`) into an ISO date
 * string (`YYYY-MM-DD`).
 *
 * Returns `null` for anything that is not a strict single-date match:
 * period strings ("01–15/02/2026"), ranges, empty strings, or calendar-invalid
 * dates (day 32, month 13, Feb 29 on a non-leap year, etc.).
 *
 * Convention: `date_text` is the canonical human-entered value; `event_date`
 * is DERIVED from it via this function and must never be hand-entered.
 */
export function deriveEventDate(dateText: string): string | null {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(dateText);
  if (match === null) return null;

  // match[1..3] are guaranteed to exist by the regex above.
  const dd = Number(match[1]);
  const mm = Number(match[2]);
  const yyyy = Number(match[3]);

  // Validate by round-trip: construct UTC date and check component equality.
  const d = new Date(Date.UTC(yyyy, mm - 1, dd));
  if (d.getUTCFullYear() !== yyyy || d.getUTCMonth() !== mm - 1 || d.getUTCDate() !== dd) {
    return null;
  }

  // Zero-pad and reformat as YYYY-MM-DD.
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${String(yyyy)}-${pad(mm)}-${pad(dd)}`;
}
