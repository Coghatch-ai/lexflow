import { useState } from 'react';
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
import { mockDisciplinePerformance, mockExamBoardPerformance, mockSessions } from '../lib/mockData';

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

export default function AnalyticsPage() {
  const [disciplineData] = useState<DisciplineData[]>(
    mockDisciplinePerformance.map((d) => ({
      discipline: d.discipline,
      accuracy: d.accuracy,
      total: d.total_answered,
      correct: d.total_correct,
    })).sort((a, b) => b.accuracy - a.accuracy)
  );

  const [sessionData] = useState<SessionData[]>(
    mockSessions.map((s) => ({
      date: new Date(s.created_at).toLocaleDateString('pt-BR'),
      accuracy: Math.round((s.correct_answers / s.total_questions) * 100),
    }))
  );

  const [examBoardData] = useState<ExamBoardData[]>(
    mockExamBoardPerformance.map((e) => ({
      name: e.exam_board,
      value: e.accuracy,
      total: e.total_answered,
    }))
  );

  const COLORS = ['#0f172a', '#1e3a5f', '#0ea5e9', '#0c4a6e', '#38bdf8'];

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-xl p-6 shadow">
        <h2 className="text-2xl font-bold text-[#0f172a] mb-2">
          Analise Detalhada de Desempenho
        </h2>
        <p className="text-gray-600">
          Visualize seus padroes de estudo e identifique areas para melhoria
        </p>
      </div>

      {sessionData.length > 0 && (
        <div className="bg-white rounded-xl p-6 shadow">
          <h3 className="text-lg font-bold text-[#0f172a] mb-4">
            Tendencia de Acuracia (Ultimos Simulados)
          </h3>
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={sessionData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e0e0e0" />
              <XAxis
                dataKey="date"
                stroke="#666"
                tick={{ fontSize: 12 }}
                angle={-45}
                textAnchor="end"
                height={80}
              />
              <YAxis stroke="#666" tick={{ fontSize: 12 }} />
              <Tooltip
                formatter={(value: number) => `${value}%`}
                contentStyle={{
                  backgroundColor: '#fff',
                  border: '2px solid #0f172a',
                  borderRadius: '8px',
                }}
              />
              <Line
                type="monotone"
                dataKey="accuracy"
                stroke="#0ea5e9"
                strokeWidth={2}
                dot={{ fill: '#0ea5e9', r: 4 }}
                activeDot={{ r: 6 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      <div className="grid lg:grid-cols-2 gap-6">
        {disciplineData.length > 0 && (
          <div className="bg-white rounded-xl p-6 shadow">
            <h3 className="text-lg font-bold text-[#0f172a] mb-4">
              Acuracia por Disciplina
            </h3>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={disciplineData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e0e0e0" />
                <XAxis
                  dataKey="discipline"
                  stroke="#666"
                  tick={{ fontSize: 11 }}
                  angle={-45}
                  textAnchor="end"
                  height={100}
                />
                <YAxis stroke="#666" tick={{ fontSize: 12 }} />
                <Tooltip
                  formatter={(value: number) => `${value}%`}
                  contentStyle={{
                    backgroundColor: '#fff',
                    border: '2px solid #0f172a',
                    borderRadius: '8px',
                  }}
                />
                <Bar dataKey="accuracy" fill="#0ea5e9" radius={[8, 8, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}

        {examBoardData.length > 0 && (
          <div className="bg-white rounded-xl p-6 shadow">
            <h3 className="text-lg font-bold text-[#0f172a] mb-4">
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
                  fill="#8884d8"
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
                    border: '2px solid #0f172a',
                    borderRadius: '8px',
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      <div className="bg-white rounded-xl p-6 shadow">
        <h3 className="text-lg font-bold text-[#0f172a] mb-4">
          Detalhes por Disciplina
        </h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b-2 border-gray-200">
                <th className="text-left py-3 px-4 font-semibold text-[#0f172a]">
                  Disciplina
                </th>
                <th className="text-center py-3 px-4 font-semibold text-[#0f172a]">
                  Acuracia
                </th>
                <th className="text-center py-3 px-4 font-semibold text-[#0f172a]">
                  Acertos
                </th>
                <th className="text-center py-3 px-4 font-semibold text-[#0f172a]">
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
