// apps/mobile/src/components/ExamCountdown.tsx
//
// Countdown badge for the next upcoming OAB exam event.
// Consumed by HomePage — renders nothing when no future event has a structured date.

import type { ReactElement } from "react";
import { Calendar } from "lucide-react";
import { daysUntil, nextUpcomingEvent } from "@shared/domain/exam-countdown";
import { trpc } from "../lib/trpc";

export function ExamCountdown(): ReactElement | null {
  const { data, isLoading } = trpc.calendars.listActive.useQuery();

  if (isLoading || data === undefined) return null;

  const allEvents = data.flatMap((c) => c.events);
  const nextEvent = nextUpcomingEvent(allEvents);

  if (nextEvent?.eventDate == null) return null;

  const days = daysUntil(nextEvent.eventDate);

  if (days <= 0) return null;

  const label = days === 1 ? "dia" : "dias";

  return (
    <div className="panel-ink flex items-center gap-3 px-5 py-4">
      <Calendar className="h-5 w-5 shrink-0 text-seal-bright" strokeWidth={1.75} />
      <div className="flex-1">
        <p className="text-xs text-ink-mute">Próxima prova em</p>
        <p className="mt-0.5 text-2xl font-bold tnum leading-none text-seal-bright">
          {days} <span className="text-sm font-medium text-ink-mute">{label}</span>
        </p>
      </div>
    </div>
  );
}
