-- drizzle/0014_backfill_event_date.sql
--
-- One-time backfill: populate event_date from date_text for rows where
-- date_text is a clean DD/MM/YYYY single date and event_date is NULL.
-- Guard regex ensures period strings (e.g. "01–15/02/2026") are skipped.

UPDATE "exam_calendar_events"
SET "event_date" = to_date("date_text", 'DD/MM/YYYY')
WHERE "event_date" IS NULL
  AND "date_text" ~ '^\d{2}/\d{2}/\d{4}$';
