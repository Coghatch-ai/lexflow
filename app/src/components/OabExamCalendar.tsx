import { type ReactElement, useState, useEffect } from 'react';
import { Calendar } from 'lucide-react';
import { trpc } from '../shared/lib/trpc';
import { daysUntil, nextUpcomingEvent, timeUntilParts } from '@shared/domain/exam-countdown';

// Countdown resolves to 00:00:00 local on exam day — no time-of-day in the data model.
// If a more precise start time is ever added, update the anchor here.

type CountdownParts = ReturnType<typeof timeUntilParts>;

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

interface CountdownHeroProps {
  eventDate: string;
}

function CountdownHero({ eventDate }: CountdownHeroProps): ReactElement | null {
  const [parts, setParts] = useState<CountdownParts>(() => timeUntilParts(eventDate));

  useEffect(() => {
    // Re-seed when the target event changes.
    setParts(timeUntilParts(eventDate));

    const id = setInterval(() => {
      setParts(timeUntilParts(eventDate));
    }, 1000);

    return () => {
      clearInterval(id);
    };
  }, [eventDate]);

  // Event passed mid-view — unmount hero.
  if (parts.totalMs <= 0) return null;

  const segments: Array<{ value: string; label: string }> = [
    { value: String(parts.days), label: 'dias' },
    { value: pad(parts.hours), label: 'horas' },
    { value: pad(parts.minutes), label: 'min' },
    { value: pad(parts.seconds), label: 'seg' },
  ];

  return (
    <div className="rounded-2xl bg-seal-wash border border-seal-bright/40 ring-1 ring-seal-bright/20 px-6 py-5">
      <p className="eyebrow !text-seal-bright">Próxima prova</p>
      <div className="mt-3 flex items-end gap-4 flex-wrap">
        {segments.map((seg, i) => (
          <div key={seg.label} className="flex items-end gap-1">
            <span className="font-display text-3xl md:text-4xl font-bold tabular-nums text-ink leading-none">
              {seg.value}
            </span>
            <span className="text-[0.65rem] uppercase tracking-wide text-ink-mute mb-1">
              {seg.label}
            </span>
            {i < segments.length - 1 && (
              <span className="font-display text-2xl font-bold text-seal-bright/60 leading-none mb-0.5 ml-1">
                :
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

export default function OabExamCalendar(): ReactElement | null {
  const { data, isLoading } = trpc.calendars.listActive.useQuery();

  if (isLoading) return null;
  if (!data || data.length === 0) return null;

  // Collect all events across all active calendars to find the next upcoming one.
  const allEvents = data.flatMap((cal) => cal.events);
  const nextEvent = nextUpcomingEvent(allEvents);
  // nextUpcomingEvent only returns an event when eventDate is non-null and in the future.
  const nextEventDate = nextEvent !== null ? nextEvent.eventDate : null;

  return (
    <div className="space-y-4">
      {nextEventDate !== null && <CountdownHero eventDate={nextEventDate} />}
      {data.map((cal) => (
        <div key={cal.id} className="panel-ink rounded-xl px-6 py-5">
          <div className="flex items-center gap-3 mb-4">
            <Calendar className="w-5 h-5 text-seal-bright" strokeWidth={1.75} />
            <h3 className="font-display text-base font-bold text-surface">{cal.title}</h3>
          </div>

          {cal.events.length > 0 && (
            <ul className="space-y-2">
              {cal.events.map((ev) => {
                const days = ev.eventDate !== null ? daysUntil(ev.eventDate) : null;
                return (
                  <li key={ev.id} className="flex items-start gap-3 text-sm">
                    <span className="mt-[5px] h-1.5 w-1.5 shrink-0 rounded-full bg-seal-bright" />
                    <span className="text-surface/80 leading-relaxed flex-1">
                      <span className="font-medium text-surface">{ev.label}:</span>{' '}
                      {ev.dateText}
                    </span>
                    {days !== null && days > 0 && (
                      <span className="shrink-0 text-xs font-semibold px-2 py-0.5 rounded-full bg-seal-bright/20 text-seal-bright">
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
