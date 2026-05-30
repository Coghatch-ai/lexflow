import { useSession } from '../auth';
import OabExamCalendar from '../components/OabExamCalendar';
import {
  BookOpen,
  TrendingUp,
  Target,
  Clock,
  Zap,
  AlertCircle,
} from 'lucide-react';
import { trpc } from '../shared/lib/trpc';

export default function HomePage() {
  const { user } = useSession();

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
          accuracy:
            last.totalQuestions > 0
              ? Math.round((last.correctAnswers / last.totalQuestions) * 100)
              : 0,
          discipline: last.discipline,
          date: new Date(last.createdAt).toLocaleDateString('pt-BR'),
        }
      : undefined,
  };

  return (
    <div className="space-y-6">
      {/* Welcome Card */}
      <div className="bg-gradient-to-r from-[#0f172a] to-[#1e3a5f] rounded-xl p-8 text-white shadow-lg">
        <h1 className="text-3xl font-bold mb-2">
          Bem-vindo de volta, {user?.name}!
        </h1>
        <p className="text-white/80 max-w-lg">
          Voce esta no caminho certo para sua aprovacao. Mantenha o ritmo
          e aproveite todas as ferramentas disponiveis.
        </p>
      </div>

      {/* Stats Grid */}
      <div className="grid md:grid-cols-4 gap-4">
        {/* Accuracy */}
        <div className="bg-white rounded-xl p-6 shadow hover:shadow-lg transition">
          <div className="flex items-start justify-between mb-4">
            <div className="bg-sky-100 p-3 rounded-lg">
              <TrendingUp className="w-6 h-6 text-sky-600" />
            </div>
            {stats.accuracy >= 70 && (
              <span className="text-xs font-bold text-green-600 bg-green-100 px-2 py-1 rounded">
                Otimo!
              </span>
            )}
          </div>
          <p className="text-gray-600 text-sm mb-2">Acuracia Geral</p>
          <p className="text-3xl font-bold text-[#0f172a]">
            {stats.accuracy}%
          </p>
          <p className="text-xs text-gray-500 mt-2">
            {stats.totalCorrect} acertos de {stats.totalAnswered}
          </p>
        </div>

        {/* Sessions */}
        <div className="bg-white rounded-xl p-6 shadow hover:shadow-lg transition">
          <div className="bg-green-100 p-3 rounded-lg mb-4 w-fit">
            <BookOpen className="w-6 h-6 text-green-600" />
          </div>
          <p className="text-gray-600 text-sm mb-2">Simulados Realizados</p>
          <p className="text-3xl font-bold text-[#0f172a]">
            {stats.totalSessions}
          </p>
          <p className="text-xs text-gray-500 mt-2">Manter o ritmo e importante</p>
        </div>

        {/* Recent Performance */}
        <div className="bg-white rounded-xl p-6 shadow hover:shadow-lg transition">
          <div className="bg-amber-100 p-3 rounded-lg mb-4 w-fit">
            <Zap className="w-6 h-6 text-amber-600" />
          </div>
          <p className="text-gray-600 text-sm mb-2">Desempenho Recente</p>
          {stats.recentSession ? (
            <>
              <p className="text-3xl font-bold text-[#0f172a]">
                {stats.recentSession.accuracy}%
              </p>
              <p className="text-xs text-gray-500 mt-2">
                {stats.recentSession.date}
              </p>
            </>
          ) : (
            <p className="text-gray-400 text-sm">Sem simulados ainda</p>
          )}
        </div>

        {/* Questions Answered */}
        <div className="bg-white rounded-xl p-6 shadow hover:shadow-lg transition">
          <div className="bg-orange-100 p-3 rounded-lg mb-4 w-fit">
            <Clock className="w-6 h-6 text-orange-600" />
          </div>
          <p className="text-gray-600 text-sm mb-2">Questoes Respondidas</p>
          <p className="text-3xl font-bold text-[#0f172a]">
            {stats.totalAnswered}
          </p>
          <p className="text-xs text-gray-500 mt-2">Total acumulado</p>
        </div>
      </div>

      {/* Recommendations */}
      <div className="grid md:grid-cols-2 gap-6">
        {/* Study Tips */}
        <div className="bg-white rounded-xl p-6 shadow">
          <h3 className="font-bold text-lg text-[#0f172a] mb-4 flex items-center gap-2">
            <AlertCircle className="w-5 h-5 text-[#0ea5e9]" />
            Dicas de Estudo
          </h3>
          <ul className="space-y-3">
            <li className="flex items-start gap-3">
              <div className="w-2 h-2 rounded-full bg-[#0ea5e9] mt-2 flex-shrink-0" />
              <span className="text-gray-700 text-sm">
                Realize simulados regularmente para familiarizar-se com o formato
                da prova
              </span>
            </li>
            <li className="flex items-start gap-3">
              <div className="w-2 h-2 rounded-full bg-[#0ea5e9] mt-2 flex-shrink-0" />
              <span className="text-gray-700 text-sm">
                Foque nas disciplinas onde tem menor acuracia
              </span>
            </li>
            <li className="flex items-start gap-3">
              <div className="w-2 h-2 rounded-full bg-[#0ea5e9] mt-2 flex-shrink-0" />
              <span className="text-gray-700 text-sm">
                Use o dashboard de analytics para identificar padroes de erro
              </span>
            </li>
            <li className="flex items-start gap-3">
              <div className="w-2 h-2 rounded-full bg-[#0ea5e9] mt-2 flex-shrink-0" />
              <span className="text-gray-700 text-sm">
                Defina metas realistas em cada disciplina
              </span>
            </li>
          </ul>
        </div>

        {/* Next Steps */}
        <div className="bg-gradient-to-br from-[#0ea5e9] to-[#0f172a] rounded-xl p-6 text-white shadow">
          <h3 className="font-bold text-lg mb-4 flex items-center gap-2">
            <Target className="w-5 h-5" />
            Proximos Passos
          </h3>
          <div className="space-y-3">
            <div className="bg-white/10 rounded-lg p-3 backdrop-blur">
              <p className="font-semibold mb-1">1. Comecar um Simulado</p>
              <p className="text-sm text-white/80">
                Va para "Simulados" e escolha uma disciplina para treinar
              </p>
            </div>
            <div className="bg-white/10 rounded-lg p-3 backdrop-blur">
              <p className="font-semibold mb-1">2. Definir Metas</p>
              <p className="text-sm text-white/80">
                Use "Metas" para estabelecer objetivos em cada disciplina
              </p>
            </div>
            <div className="bg-white/10 rounded-lg p-3 backdrop-blur">
              <p className="font-semibold mb-1">3. Acompanhar Progresso</p>
              <p className="text-sm text-white/80">
                Veja seus graficos e estatisticas em "Analytics"
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* OAB Exam Calendar */}
      <OabExamCalendar />
    </div>
  );
}
