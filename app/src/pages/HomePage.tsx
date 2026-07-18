import type { ReactElement } from 'react';
import WelcomePanel from '../components/WelcomePanel';
import { Target, ArrowUpRight } from 'lucide-react';
import { trpc } from '../shared/lib/trpc';
import { accuracyPct } from '@shared/domain/scoring';

const STEPS = [
  { n: '01', title: 'Começar um simulado', body: 'Vá para "Simulados" e escolha uma disciplina para treinar.' },
  { n: '02', title: 'Definir metas', body: 'Use "Metas" para estabelecer objetivos em cada disciplina.' },
  { n: '03', title: 'Acompanhar progresso', body: 'Veja seus gráficos e estatísticas em "Analytics".' },
];

export default function HomePage(): ReactElement {
  const summary = trpc.stats.summary.useQuery();
  const recent = trpc.sessions.listRecent.useQuery();
  const last = recent.data?.[0];

  const stats = {
    totalAnswered: summary.data?.totalAnswered ?? 0,
    totalCorrect: summary.data?.totalCorrect ?? 0,
    accuracy: summary.data?.accuracy ?? 0,
    totalSessions: summary.data?.totalSessions ?? 0,
    recentSession: last
      ? {
          accuracy: accuracyPct(last.correctAnswers, last.totalQuestions),
          date: new Date(last.createdAt).toLocaleDateString('pt-BR'),
        }
      : undefined,
  };

  const ledger: Array<{ label: string; value: string; sub: string; flag?: boolean }> = [
    {
      label: 'Acurácia geral',
      value: `${stats.accuracy}%`,
      sub: `${stats.totalCorrect} acertos de ${stats.totalAnswered}`,
      flag: stats.accuracy >= 70,
    },
    {
      label: 'Simulados',
      value: `${stats.totalSessions}`,
      sub: 'Manter o ritmo é importante',
    },
    {
      label: 'Desempenho recente',
      value: stats.recentSession ? `${stats.recentSession.accuracy}%` : '—',
      sub: stats.recentSession ? stats.recentSession.date : 'Sem simulados ainda',
    },
    {
      label: 'Questões respondidas',
      value: `${stats.totalAnswered}`,
      sub: 'Total acumulado',
    },
  ];

  return (
    <div className="space-y-6 stagger">
      <WelcomePanel />

      {/* Ledger — one bordered block, hairlines drawn by a 1px grid gap. */}
      <section className="overflow-hidden rounded-xl border border-line">
        <div className="grid grid-cols-2 gap-px bg-line lg:grid-cols-4">
          {ledger.map((s) => (
            <div key={s.label} className="bg-surface px-6 py-5">
              <div className="flex items-center justify-between gap-2">
                <p className="eyebrow">{s.label}</p>
                {s.flag === true && <span className="badge-success">Ótimo</span>}
              </div>
              <p className="mt-3 font-display text-4xl font-bold tabular-nums leading-none text-ink">
                {s.value}
              </p>
              <p className="mt-2 text-xs text-ink-mute">{s.sub}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Guidance */}
      <section className="grid gap-6">
        <div className="panel-ink p-6">
          <div className="flex items-center gap-2">
            <Target className="w-[18px] h-[18px] text-seal-bright" />
            <h3 className="font-display text-base font-bold text-surface">Próximos passos</h3>
          </div>
          <ol className="mt-5 space-y-3">
            {STEPS.map((step) => (
              <li
                key={step.n}
                className="group flex items-start gap-4 rounded-lg border border-[var(--ink-line)] px-4 py-3"
              >
                <span className="font-display text-sm font-bold text-seal-bright tabular-nums">
                  {step.n}
                </span>
                <div className="min-w-0">
                  <p className="flex items-center gap-1.5 text-sm font-semibold text-surface">
                    {step.title}
                    <ArrowUpRight className="w-3.5 h-3.5 text-ink-mute" />
                  </p>
                  <p className="mt-0.5 text-xs leading-relaxed text-ink-mute">{step.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>

    </div>
  );
}
