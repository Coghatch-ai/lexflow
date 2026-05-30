import {
  AlertTriangle,
  Clock,
  BookOpen,
  TrendingDown,
  BarChart3,
} from 'lucide-react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from 'recharts';
import { trpc } from '../shared/lib/trpc';

interface ErrorByDiscipline {
  discipline: string;
  errors: number;
  total: number;
  errorRate: number;
}

interface ErrorByBoard {
  examBoard: string;
  errors: number;
  total: number;
  errorRate: number;
}

interface ErrorByTime {
  category: string;
  errors: number;
  total: number;
  errorRate: number;
}

export default function ErrorPatternAnalysis() {
  const summary = trpc.stats.summary.useQuery();
  const byDiscipline = trpc.stats.byDiscipline.useQuery();
  const byExamBoard = trpc.stats.byExamBoard.useQuery();
  const byResponseTime = trpc.stats.byResponseTime.useQuery();
  const recurring = trpc.stats.recurringErrors.useQuery();

  const totalAnswered = summary.data?.totalAnswered ?? 0;
  const totalErrors = totalAnswered - (summary.data?.totalCorrect ?? 0);

  const errorByDiscipline: ErrorByDiscipline[] = (byDiscipline.data ?? [])
    .map((d) => ({
      discipline: d.discipline,
      errors: d.totalAnswered - d.totalCorrect,
      total: d.totalAnswered,
      errorRate: 100 - d.accuracy,
    }))
    .sort((a, b) => b.errorRate - a.errorRate);

  const errorByBoard: ErrorByBoard[] = (byExamBoard.data ?? []).map((e) => ({
    examBoard: e.examBoard,
    errors: e.totalAnswered - Math.round((e.totalAnswered * e.accuracy) / 100),
    total: e.totalAnswered,
    errorRate: 100 - e.accuracy,
  }));

  const timeBuckets = byResponseTime.data ?? [];
  const pickBucket = (key: string): { total: number; errors: number } =>
    timeBuckets.find((b) => b.bucket === key) ?? { total: 0, errors: 0 };
  const rate = (b: { total: number; errors: number }): number =>
    b.total > 0 ? Math.round((b.errors / b.total) * 100) : 0;
  const fast = pickBucket('fast');
  const med = pickBucket('medium');
  const slow = pickBucket('slow');

  const errorByTime: ErrorByTime[] = [
    { category: 'Rapido (<30s)', errors: fast.errors, total: fast.total, errorRate: rate(fast) },
    { category: 'Medio (30-90s)', errors: med.errors, total: med.total, errorRate: rate(med) },
    { category: 'Lento (>90s)', errors: slow.errors, total: slow.total, errorRate: rate(slow) },
  ];

  const recurringErrors = (recurring.data ?? []).map((r) => ({
    questionId: r.questionId,
    discipline: r.discipline,
    timesAnswered: r.timesAnswered,
    timesWrong: r.timesWrong,
    lastAttempt: r.lastAttempt,
  }));

  if (totalAnswered === 0) {
    return (
      <div className="bg-white rounded-xl p-6 shadow">
        <div className="flex items-center gap-3 mb-6">
          <div className="bg-red-100 p-3 rounded-lg">
            <AlertTriangle className="w-6 h-6 text-red-600" />
          </div>
          <div>
            <h3 className="text-xl font-bold text-[#0f172a]">Analise de Padroes de Erro</h3>
            <p className="text-sm text-gray-600">Identifique onde e porque voce erra</p>
          </div>
        </div>
        <div className="text-center py-8">
          <AlertTriangle className="w-12 h-12 text-gray-300 mx-auto mb-3" />
          <p className="text-gray-600">Responda simulados para gerar dados de analise</p>
        </div>
      </div>
    );
  }

  const COLORS = ['#0f172a', '#1e3a5f', '#0ea5e9', '#0c4a6e', '#38bdf8', '#7dd3fc'];
  const overallErrorRate = Math.round((totalErrors / totalAnswered) * 100);

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-xl p-6 shadow">
        <div className="flex items-center gap-3 mb-4">
          <div className="bg-red-100 p-3 rounded-lg">
            <AlertTriangle className="w-6 h-6 text-red-600" />
          </div>
          <div>
            <h3 className="text-xl font-bold text-[#0f172a]">Analise de Padroes de Erro</h3>
            <p className="text-sm text-gray-600">Identifique onde e porque voce erra</p>
          </div>
        </div>

        <div className="grid md:grid-cols-3 gap-4">
          <div className="bg-red-50 rounded-lg p-4 text-center">
            <p className="text-3xl font-bold text-red-600">{totalErrors}</p>
            <p className="text-sm text-gray-600">Total de erros</p>
          </div>
          <div className="bg-[#0ea5e9]/5 rounded-lg p-4 text-center">
            <p className="text-3xl font-bold text-[#0f172a]">{overallErrorRate}%</p>
            <p className="text-sm text-gray-600">Taxa de erro geral</p>
          </div>
          <div className="bg-yellow-50 rounded-lg p-4 text-center">
            <p className="text-3xl font-bold text-yellow-600">{recurringErrors.length}</p>
            <p className="text-sm text-gray-600">Erros recorrentes</p>
          </div>
        </div>
      </div>

      {errorByDiscipline.length > 0 && (
        <div className="bg-white rounded-xl p-6 shadow">
          <h4 className="font-bold text-[#0f172a] mb-4 flex items-center gap-2">
            <BookOpen className="w-5 h-5 text-[#0ea5e9]" />
            Erros por Disciplina
          </h4>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={errorByDiscipline} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" stroke="#e0e0e0" />
              <XAxis type="number" stroke="#666" tick={{ fontSize: 12 }} />
              <YAxis
                dataKey="discipline"
                type="category"
                stroke="#666"
                tick={{ fontSize: 11 }}
                width={150}
              />
              <Tooltip
                formatter={(value: number) => `${value}%`}
                contentStyle={{
                  backgroundColor: '#fff',
                  border: '2px solid #0f172a',
                  borderRadius: '8px',
                }}
              />
              <Bar dataKey="errorRate" fill="#dc2626" radius={[0, 8, 8, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      <div className="grid lg:grid-cols-2 gap-6">
        {errorByBoard.length > 0 && (
          <div className="bg-white rounded-xl p-6 shadow">
            <h4 className="font-bold text-[#0f172a] mb-4 flex items-center gap-2">
              <BarChart3 className="w-5 h-5 text-[#0ea5e9]" />
              Erros por Banca
            </h4>
            <ResponsiveContainer width="100%" height={250}>
              <PieChart>
                <Pie
                  data={errorByBoard}
                  cx="50%"
                  cy="50%"
                  labelLine={true}
                  label={(entry) => `${entry.examBoard}: ${entry.errorRate}%`}
                  outerRadius={80}
                  dataKey="errorRate"
                >
                  {errorByBoard.map((_entry, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip
                  formatter={(value: number) => `${value}%`}
                  contentStyle={{
                    backgroundColor: '#fff',
                    border: '2px solid #0f172a',
                    borderRadius: '8px',
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
        )}

        {errorByTime.length > 0 && (
          <div className="bg-white rounded-xl p-6 shadow">
            <h4 className="font-bold text-[#0f172a] mb-4 flex items-center gap-2">
              <Clock className="w-5 h-5 text-[#0ea5e9]" />
              Erros por Tempo de Resposta
            </h4>
            <div className="space-y-4">
              {errorByTime.map((item) => (
                <div key={item.category} className="space-y-1">
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-700 font-medium">{item.category}</span>
                    <span className="text-gray-600">{item.errors} erros de {item.total}</span>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-3">
                    <div
                      className={`h-3 rounded-full ${
                        item.errorRate >= 60 ? 'bg-red-500' : item.errorRate >= 40 ? 'bg-yellow-500' : 'bg-green-500'
                      }`}
                      style={{ width: `${item.errorRate}%` }}
                    />
                  </div>
                  <p className="text-xs text-gray-500 text-right">{item.errorRate}% de erro</p>
                </div>
              ))}
            </div>

            {errorByTime.length > 0 && errorByTime[0].errorRate > 0 && (
              <div className="mt-4 p-3 bg-[#0ea5e9]/5 rounded-lg">
                <p className="text-sm text-gray-700">
                  {errorByTime[0].errorRate > errorByTime[errorByTime.length - 1]?.errorRate
                    ? 'Voce erra mais quando responde rapido. Tente dedicar mais tempo a cada questao.'
                    : 'Voce erra mais quando demora muito. Isso pode indicar duvida - revise esses topicos.'}
                </p>
              </div>
            )}
          </div>
        )}
      </div>

      {recurringErrors.length > 0 && (
        <div className="bg-white rounded-xl p-6 shadow">
          <h4 className="font-bold text-[#0f172a] mb-4 flex items-center gap-2">
            <TrendingDown className="w-5 h-5 text-red-600" />
            Erros Recorrentes (questoes que voce errou 2+ vezes)
          </h4>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b-2 border-gray-200">
                  <th className="text-left py-3 px-4 font-semibold text-[#0f172a]">Disciplina</th>
                  <th className="text-center py-3 px-4 font-semibold text-[#0f172a]">Vezes respondida</th>
                  <th className="text-center py-3 px-4 font-semibold text-[#0f172a]">Vezes errada</th>
                  <th className="text-center py-3 px-4 font-semibold text-[#0f172a]">Ultima tentativa</th>
                </tr>
              </thead>
              <tbody>
                {recurringErrors.map((err) => (
                  <tr key={err.questionId} className="border-b border-gray-100 hover:bg-red-50">
                    <td className="py-3 px-4 font-medium">{err.discipline}</td>
                    <td className="text-center py-3 px-4">{err.timesAnswered}</td>
                    <td className="text-center py-3 px-4">
                      <span className="bg-red-100 text-red-700 px-2 py-1 rounded-full font-bold">
                        {err.timesWrong}
                      </span>
                    </td>
                    <td className="text-center py-3 px-4 text-gray-600">
                      {new Date(err.lastAttempt).toLocaleDateString('pt-BR')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="bg-white rounded-xl p-6 shadow">
        <h4 className="font-bold text-[#0f172a] mb-4">Insights e Recomendacoes</h4>
        <div className="space-y-3">
          {errorByDiscipline.length > 0 && errorByDiscipline[0].errorRate > 50 && (
            <div className="flex items-start gap-3 p-3 bg-red-50 rounded-lg">
              <AlertTriangle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-gray-700">
                <span className="font-semibold">{errorByDiscipline[0].discipline}</span> tem a maior taxa de erro ({errorByDiscipline[0].errorRate}%). Priorize esta disciplina nos seus estudos.
              </p>
            </div>
          )}
          {recurringErrors.length > 0 && (
            <div className="flex items-start gap-3 p-3 bg-yellow-50 rounded-lg">
              <AlertTriangle className="w-5 h-5 text-yellow-600 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-gray-700">
                Voce tem {recurringErrors.length} questao(oes) com erros recorrentes. Use a Revisao Espacada para reforcar esses conteudos.
              </p>
            </div>
          )}
          {errorByTime.length > 0 && errorByTime[0].errorRate > 50 && (
            <div className="flex items-start gap-3 p-3 bg-blue-50 rounded-lg">
              <Clock className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-gray-700">
                Respostas rapidas (menos de 30s) tem {errorByTime[0].errorRate}% de erro. Considere ler as questoes com mais atencao.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
