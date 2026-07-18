// app/src/components/WelcomePanel.tsx
//
// Unified dark welcome panel: greeting + status pill + live countdown + daily tip
// + exam date card. Replaces the old greeting strip + OabExamCalendar on HomePage.
// Full strict lint — no any / ! / console.log. Sub-components keep each fn < 250 lines.

import type { ReactElement } from 'react';
import { Calendar, Lightbulb } from 'lucide-react';
import { useSession } from '../auth';
import { trpc } from '../shared/lib/trpc';
import { CountdownHero } from './OabExamCalendar';
import { daysUntil, nextUpcomingEvent } from '@shared/domain/exam-countdown';
import { pickDailyTip } from '../shared/utils/pick-daily-tip';

// ── Tips ─────────────────────────────────────────────────────────────────────

const TIPS: ReadonlyArray<string> = [
  'Realize simulados regularmente para familiarizar-se com o formato da prova.',
  'Foque nas disciplinas onde tem menor acurácia.',
  'Use o dashboard de Analytics para identificar padrões de erro.',
  'Defina metas realistas em cada disciplina.',
  'Revise os erros do último simulado antes de começar um novo.',
];

// ── Sub-component types ───────────────────────────────────────────────────────

type CalEvent = {
  id: string;
  label: string;
  dateText: string;
  eventDate: string | null;
};

type Cal = {
  id: string;
  title: string;
  note: string | null;
  events: CalEvent[];
};

// ── WelcomePanelHeader ────────────────────────────────────────────────────────

interface HeaderProps {
  firstName: string;
}

function WelcomePanelHeader({ firstName }: HeaderProps): ReactElement {
  return (
    <div className="mb-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="font-display text-[var(--fs-display)] font-bold leading-tight text-surface">
          Bem-vindo de volta{firstName.length > 0 ? `, ${firstName}` : ''}.
        </h1>
        <span className="shrink-0 text-xs font-semibold px-2.5 py-1 rounded-full bg-seal-bright/20 text-seal-bright border border-seal-bright/30">
          Preparatório ativo
        </span>
      </div>
      {/* 1px gradient hairline separator */}
      <div
        aria-hidden
        className="mt-4 h-px w-full"
        style={{ background: 'var(--ink-line)' }}
      />
    </div>
  );
}

// ── TipOfDay ──────────────────────────────────────────────────────────────────

function TipOfDay(): ReactElement {
  const tip = pickDailyTip(TIPS);
  return (
    <div className="rounded-xl border border-seal-bright/20 bg-seal-wash px-5 py-4">
      <div className="flex items-center gap-2 mb-2">
        <Lightbulb className="w-4 h-4 text-seal-bright" strokeWidth={1.75} />
        <p className="text-xs font-semibold uppercase tracking-wide text-seal-bright">
          Dica do dia
        </p>
      </div>
      <p className="text-sm leading-relaxed text-ink">{tip}</p>
    </div>
  );
}

// ── ExamEventItem ─────────────────────────────────────────────────────────────

interface EventItemProps {
  ev: CalEvent;
}

function ExamEventItem({ ev }: EventItemProps): ReactElement {
  const days = ev.eventDate !== null ? daysUntil(ev.eventDate) : null;
  return (
    <li className="flex items-start gap-3 text-sm">
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
}

// ── ExamDateCard ──────────────────────────────────────────────────────────────

interface ExamDateCardProps {
  cal: Cal;
}

function ExamDateCard({ cal }: ExamDateCardProps): ReactElement {
  return (
    <div className="rounded-xl border border-[var(--ink-line)] px-5 py-4 h-full">
      <div className="flex items-center gap-2 mb-4">
        <Calendar className="w-4 h-4 text-seal-bright" strokeWidth={1.75} />
        <h3 className="font-display text-sm font-bold text-surface">{cal.title}</h3>
      </div>
      {cal.events.length > 0 && (
        <ul className="space-y-2">
          {cal.events.map((ev) => (
            <ExamEventItem key={ev.id} ev={ev} />
          ))}
        </ul>
      )}
      {cal.note !== null && (
        <p className="mt-3 text-xs text-surface/50 italic">{cal.note}</p>
      )}
    </div>
  );
}

// ── Left column ───────────────────────────────────────────────────────────────

interface LeftColProps {
  nextEventDate: string | null;
}

function WelcomePanelLeft({ nextEventDate }: LeftColProps): ReactElement {
  return (
    <div className="space-y-4">
      {nextEventDate !== null && <CountdownHero eventDate={nextEventDate} />}
      <TipOfDay />
    </div>
  );
}

// ── Right column ──────────────────────────────────────────────────────────────

interface RightColProps {
  calendars: Cal[];
}

function WelcomePanelRight({ calendars }: RightColProps): ReactElement | null {
  if (calendars.length === 0) return null;
  return (
    <div className="space-y-4">
      {calendars.map((cal) => (
        <ExamDateCard key={cal.id} cal={cal} />
      ))}
    </div>
  );
}

// ── WelcomePanel (default export) ─────────────────────────────────────────────

export default function WelcomePanel(): ReactElement {
  const { user } = useSession();
  const { data } = trpc.calendars.listActive.useQuery();

  const firstName = user?.name.split(' ')[0] ?? '';
  const calendars: Cal[] = data ?? [];
  const allEvents = calendars.flatMap((cal) => cal.events);
  const nextEvent = nextUpcomingEvent(allEvents);
  const nextEventDate = nextEvent !== null ? nextEvent.eventDate : null;

  return (
    <section className="panel-ink rounded-2xl px-7 py-7 md:px-9 md:py-8 relative overflow-hidden">
      {/* Decorative seal glow — mirrors HomePage.tsx:71-75 */}
      <div
        aria-hidden
        className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full"
        style={{ background: 'radial-gradient(closest-side, rgba(217,171,83,0.16), transparent)' }}
      />
      <WelcomePanelHeader firstName={firstName} />
      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <WelcomePanelLeft nextEventDate={nextEventDate} />
        <WelcomePanelRight calendars={calendars} />
      </div>
    </section>
  );
}
