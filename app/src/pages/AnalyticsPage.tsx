import type { ReactElement } from 'react';
import ErrorPatternAnalysis from '../components/ErrorPatternAnalysis';
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { trpc } from '../shared/lib/trpc';
import { useLov } from '../shared/hooks/use-lov';
import { accuracyPct } from '@shared/domain/scoring';

interface DisciplineData {
  discipline: string;
  accuracy: number;
  total: number;
  correct: number;
}

interface SessionData {
  date: string;
  accuracy: number;
}

interface ExamBoardData {
  name: string;
  value: number;
  total: number;
}

export default function AnalyticsPage(): ReactElement {
  const byDiscipline = trpc.stats.byDiscipline.useQuery();
  const byExamBoard = trpc.stats.byExamBoard.useQuery();
  const recent = trpc.sessions.listRecent.useQuery();
  const disciplineLov = useLov('DISCIPLINE');
  const examBoardLov = useLov('EXAM_BOARD');

  const disciplineData: DisciplineData[] = (byDiscipline.data ?? [])
    .map((d) => ({
      discipline: disciplineLov.labelOf(d.discipline),
      accuracy: d.accuracy,
      total: d.totalAnswered,
      correct: d.totalCorrect,
    }))
    .sort((a, b) => b.accuracy - a.accuracy);

  // listRecent is newest-first; reverse for a left-to-right chronological trend.
  const sessionData: SessionData[] = [...(recent.data ?? [])].reverse().map((s) => ({
    date: new Date(s.createdAt).toLocaleDateString('pt-BR'),
    accuracy: accuracyPct(s.correctAnswers, s.totalQuestions),
  }));

  const examBoardData: ExamBoardData[] = (byExamBoard.data ?? []).map((e) => ({
    name: examBoardLov.labelOf(e.examBoard),
    value: e.accuracy,
    total: e.totalAnswered,
  }));

  const COLORS = ['#16161a', '#b8893b', '#3f7a52', '#6b6b75', '#d9ab53'];

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-xl p-6 shadow">
        <h2 className="text-2xl font-bold text-[#16161a] mb-2">
          Análise Detalhada de Desempenho
        </h2>
        <p className="text-gray-600">
          Visualize seus padrões de estudo e identifique áreas para melhoria
        </p>
      </div>

      {sessionData.length > 0 && (
        <div className="bg-white rounded-xl p-6 shadow">
          <h3 className="text-lg font-bold text-[#16161a] mb-4">
            Tendência de Acurácia (Últimos Simulados)
          </h3>
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={sessionData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e5ea" />
              <XAxis
                dataKey="date"
                stroke="#6b6b75"
                tick={{ fontSize: 12 }}
                angle={-45}
                textAnchor="end"
                height={80}
              />
              <YAxis stroke="#6b6b75" tick={{ fontSize: 12 }} />
              <Tooltip
                formatter={(value: number) => `${value}%`}
                contentStyle={{
                  backgroundColor: '#fff',
                  border: '1px solid #d3d3da',
                  borderRadius: '8px',
                }}
              />
              <Line
                type="monotone"
                dataKey="accuracy"
                stroke="#b8893b"
                strokeWidth={2.5}
                dot={{ fill: '#b8893b', r: 3 }}
                activeDot={{ r: 6 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      <div className="grid lg:grid-cols-2 gap-6">
        {disciplineData.length > 0 && (
          <div className="bg-white rounded-xl p-6 shadow">
            <h3 className="text-lg font-bold text-[#16161a] mb-4">
              Acurácia por Disciplina
            </h3>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={disciplineData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e5ea" />
                <XAxis
                  dataKey="discipline"
                  stroke="#6b6b75"
                  tick={{ fontSize: 11 }}
                  angle={-45}
                  textAnchor="end"
                  height={100}
                />
                <YAxis stroke="#6b6b75" tick={{ fontSize: 12 }} />
                <Tooltip
                  formatter={(value: number) => `${value}%`}
                  contentStyle={{
                    backgroundColor: '#fff',
                    border: '1px solid #d3d3da',
                    borderRadius: '8px',
                  }}
                />
                <Bar dataKey="accuracy" fill="#16161a" radius={[8, 8, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}

        {examBoardData.length > 0 && (
          <div className="bg-white rounded-xl p-6 shadow">
            <h3 className="text-lg font-bold text-[#16161a] mb-4">
              Desempenho por Banca
            </h3>
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                <Pie
                  data={examBoardData}
                  cx="50%"
                  cy="50%"
                  labelLine={true}
                  label={(entry: ExamBoardData) => `${entry.name}: ${entry.value}%`}
                  outerRadius={80}
                  fill="#16161a"
                  dataKey="value"
                >
                  {examBoardData.map((_entry, index: number) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip
                  formatter={(value: number) => `${value}%`}
                  contentStyle={{
                    backgroundColor: '#fff',
                    border: '1px solid #d3d3da',
                    borderRadius: '8px',
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      <div className="bg-white rounded-xl p-6 shadow">
        <h3 className="text-lg font-bold text-[#16161a] mb-4">
          Detalhes por Disciplina
        </h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b-2 border-gray-200">
                <th className="text-left py-3 px-4 font-semibold text-[#16161a]">
                  Disciplina
                </th>
                <th className="text-center py-3 px-4 font-semibold text-[#16161a]">
                  Acurácia
                </th>
                <th className="text-center py-3 px-4 font-semibold text-[#16161a]">
                  Acertos
                </th>
                <th className="text-center py-3 px-4 font-semibold text-[#16161a]">
                  Total
                </th>
              </tr>
            </thead>
            <tbody>
              {disciplineData.map((d) => (
                <tr
                  key={d.discipline}
                  className="border-b border-gray-100 hover:bg-gray-50"
                >
                  <td className="py-3 px-4 font-medium">{d.discipline}</td>
                  <td className="text-center py-3 px-4">
                    <span
                      className={`inline-block px-3 py-1 rounded-full text-sm font-semibold ${
                        d.accuracy >= 70
                          ? 'bg-green-100 text-green-700'
                          : d.accuracy >= 50
                            ? 'bg-yellow-100 text-yellow-700'
                            : 'bg-red-100 text-red-700'
                      }`}
                    >
                      {d.accuracy}%
                    </span>
                  </td>
                  <td className="text-center py-3 px-4">
                    <span className="font-semibold text-green-600">
                      {d.correct}
                    </span>
                  </td>
                  <td className="text-center py-3 px-4 text-gray-600">
                    {d.total}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {disciplineData.length === 0 && (
          <p className="text-center text-gray-500 py-8">
            Nenhum dado de desempenho ainda. Comece um simulado!
          </p>
        )}
      </div>

      {/* Error Pattern Analysis */}
      <ErrorPatternAnalysis />
    </div>
  );
}
