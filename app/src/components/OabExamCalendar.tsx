import type { ReactElement } from 'react';
import { Calendar } from 'lucide-react';
import { trpc } from '../shared/lib/trpc';

export default function OabExamCalendar(): ReactElement | null {
  const { data, isLoading } = trpc.calendars.listActive.useQuery();

  if (isLoading) return null;
  if (!data || data.length === 0) return null;

  return (
    <div className="space-y-4">
      {data.map((cal) => (
        <div key={cal.id} className="panel-ink rounded-xl px-6 py-5">
          <div className="flex items-center gap-3 mb-4">
            <Calendar className="w-5 h-5 text-[#d9ab53]" strokeWidth={1.75} />
            <h3 className="font-display text-base font-bold text-surface">{cal.title}</h3>
          </div>

          {cal.events.length > 0 && (
            <ul className="space-y-2">
              {cal.events.map((ev) => (
                <li key={ev.id} className="flex items-start gap-3 text-sm">
                  <span className="mt-[5px] h-1.5 w-1.5 shrink-0 rounded-full bg-[#d9ab53]" />
                  <span className="text-surface/80 leading-relaxed">
                    <span className="font-medium text-surface">{ev.label}:</span>{' '}
                    {ev.dateText}
                  </span>
                </li>
              ))}
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
