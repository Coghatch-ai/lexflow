import type { ReactElement } from 'react';
import { Calendar } from 'lucide-react';
import { trpc } from '../shared/lib/trpc';
import { daysUntil, nextUpcomingEvent } from '@shared/domain/exam-countdown';

export default function OabExamCalendar(): ReactElement | null {
  const { data, isLoading } = trpc.calendars.listActive.useQuery();

  if (isLoading) return null;
  if (!data || data.length === 0) return null;

  // Collect all events across all active calendars to find the next upcoming one.
  const allEvents = data.flatMap((cal) => cal.events);
  const nextEvent = nextUpcomingEvent(allEvents);
  // nextUpcomingEvent only returns an event when eventDate is non-null and in the future.
  const nextEventDate = nextEvent !== null ? nextEvent.eventDate : null;
  const countdownDays = nextEventDate !== null ? daysUntil(nextEventDate) : null;

  return (
    <div className="space-y-4">
      {countdownDays !== null && (
        <div className="flex items-center gap-3 px-5 py-3 rounded-xl bg-[#d9ab53]/10 border border-[#d9ab53]/30">
          <Calendar className="w-5 h-5 text-[#d9ab53] shrink-0" strokeWidth={1.75} />
          <p className="text-sm font-semibold text-ink">
            Próxima prova em{' '}
            <span className="text-[#d9ab53]">{countdownDays} {countdownDays === 1 ? 'dia' : 'dias'}</span>
          </p>
        </div>
      )}
      {data.map((cal) => (
        <div key={cal.id} className="panel-ink rounded-xl px-6 py-5">
          <div className="flex items-center gap-3 mb-4">
            <Calendar className="w-5 h-5 text-[#d9ab53]" strokeWidth={1.75} />
            <h3 className="font-display text-base font-bold text-surface">{cal.title}</h3>
          </div>

          {cal.events.length > 0 && (
            <ul className="space-y-2">
              {cal.events.map((ev) => {
                const days = ev.eventDate !== null ? daysUntil(ev.eventDate) : null;
                return (
                  <li key={ev.id} className="flex items-start gap-3 text-sm">
                    <span className="mt-[5px] h-1.5 w-1.5 shrink-0 rounded-full bg-[#d9ab53]" />
                    <span className="text-surface/80 leading-relaxed flex-1">
                      <span className="font-medium text-surface">{ev.label}:</span>{' '}
                      {ev.dateText}
                    </span>
                    {days !== null && days > 0 && (
                      <span className="shrink-0 text-xs font-semibold px-2 py-0.5 rounded-full bg-[#d9ab53]/20 text-[#d9ab53]">
                        {days} {days === 1 ? 'dia' : 'dias'}
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          )}

          {cal.note !== null && (
            <p className="mt-3 text-xs text-surface/50 italic">{cal.note}</p>
          )}
        </div>
      ))}
    </div>
  );
}
