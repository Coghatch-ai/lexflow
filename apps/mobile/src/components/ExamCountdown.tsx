// apps/mobile/src/components/ExamCountdown.tsx
//
// Countdown badge for the next upcoming OAB exam event.
// Consumed by HomePage — renders nothing when no future event has a structured date
// or when the event has already passed (totalMs === 0).
//
// Counts down to 00:00:00 local on the exam day (no time-of-day in the data model).

import { type ReactElement, useEffect, useState } from "react";
import { Calendar } from "lucide-react";
import { nextUpcomingEvent, timeUntilParts } from "@shared/domain/exam-countdown";
import { trpc } from "../lib/trpc";

export function ExamCountdown(): ReactElement | null {
  const { data, isLoading } = trpc.calendars.listActive.useQuery();

  const allEvents = data?.flatMap((c) => c.events) ?? [];
  const nextEvent = nextUpcomingEvent(allEvents);
  const eventDate = nextEvent?.eventDate ?? null;

  const [parts, setParts] = useState(() => (eventDate !== null ? timeUntilParts(eventDate) : null));

  useEffect(() => {
    if (eventDate === null) {
      setParts(null);
      return;
    }

    // Compute immediately so the display is current on mount.
    setParts(timeUntilParts(eventDate));

    const id = setInterval(() => {
      const next = timeUntilParts(eventDate);
      setParts(next);
    }, 1_000);

    return () => {
      clearInterval(id);
    };
  }, [eventDate]);

  if (isLoading || data === undefined) return null;
  if (parts === null || parts.totalMs === 0) return null;

  const { days, hours, minutes, seconds } = parts;

  return (
    <div
      className="rounded-2xl px-5 py-4"
      style={{
        backgroundColor: "var(--gold-wash)",
        border: "1px solid var(--gold-ink)",
      }}
    >
      <p className="eyebrow" style={{ color: "var(--gold)" }}>
        <Calendar className="h-3.5 w-3.5 shrink-0" strokeWidth={2} />
        Próxima prova em
      </p>
      <div className="mt-3 flex items-end gap-3">
        <Segment value={days} label="dias" />
        <Divider />
        <Segment value={hours} label="horas" />
        <Divider />
        <Segment value={minutes} label="min" />
        <Divider />
        <Segment value={seconds} label="seg" />
      </div>
    </div>
  );
}

function Segment({ value, label }: { value: number; label: string }): ReactElement {
  return (
    <div className="flex flex-col items-center">
      <span className="tnum text-2xl font-bold leading-none" style={{ color: "var(--ink)" }}>
        {String(value).padStart(2, "0")}
      </span>
      <span
        className="mt-0.5 text-[0.65rem] font-medium uppercase tracking-wide"
        style={{ color: "var(--gold)" }}
      >
        {label}
      </span>
    </div>
  );
}

function Divider(): ReactElement {
  return (
    <span
      className="mb-3 text-xl font-bold leading-none"
      style={{ color: "var(--gold-ink)" }}
      aria-hidden="true"
    >
      :
    </span>
  );
}
