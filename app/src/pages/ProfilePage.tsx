import { useSession } from '../auth';
import { User, TrendingUp, BookOpen, Award, Clock } from 'lucide-react';
import { mockStats, mockDisciplinePerformance } from '../lib/mockData';

export default function ProfilePage() {
  const { user } = useSession();

  const stats = {
    totalAnswered: mockStats.totalAnswered,
    totalCorrect: mockStats.totalCorrect,
    accuracy: mockStats.accuracy,
    totalSessions: mockStats.totalSessions,
    averageTimePerQuestion: mockStats.averageTimePerQuestion,
  };

  const topDisciplines = mockDisciplinePerformance
    .slice(0, 5)
    .map((d) => ({
      discipline: d.discipline,
      accuracy: d.accuracy,
    }));

  const weakDisciplines = [...mockDisciplinePerformance]
    .reverse()
    .slice(0, 5)
    .map((d) => ({
      discipline: d.discipline,
      accuracy: d.accuracy,
    }));

  return (
    <div className="space-y-6">
      {/* User Info Card */}
      <div className="bg-gradient-to-r from-[#0f172a] to-[#1e3a5f] rounded-xl p-8 text-white shadow-lg">
        <div className="flex items-center gap-4 mb-4">
          <div className="bg-[#0ea5e9] p-4 rounded-full">
            <User className="w-8 h-8 text-white" />
          </div>
          <div>
            <h2 className="text-2xl font-bold">{user?.name}</h2>
            <p className="text-white/80">{user?.email}</p>
          </div>
        </div>
        <div className="border-t border-white/20 pt-4 mt-4">
          <p className="text-sm text-white/80">
            Membro desde{' '}
            <span className="font-semibold">
              {new Date().toLocaleDateString('pt-BR')}
            </span>
          </p>
        </div>
      </div>

      {/* Stats Overview */}
      <div className="grid md:grid-cols-4 gap-4">
        <div className="bg-white rounded-xl p-6 shadow hover:shadow-lg transition">
          <div className="flex items-center justify-between mb-4">
            <p className="text-gray-600 text-sm font-medium">Acuracia Geral</p>
            <TrendingUp className="w-5 h-5 text-[#0ea5e9]" />
          </div>
          <p className="text-3xl font-bold text-[#0f172a]">{stats.accuracy}%</p>
        </div>

        <div className="bg-white rounded-xl p-6 shadow hover:shadow-lg transition">
          <div className="flex items-center justify-between mb-4">
            <p className="text-gray-600 text-sm font-medium">Questoes</p>
            <BookOpen className="w-5 h-5 text-[#0ea5e9]" />
          </div>
          <p className="text-3xl font-bold text-[#0f172a]">
            {stats.totalAnswered}
          </p>
          <p className="text-xs text-gray-500 mt-1">
            {stats.totalCorrect} acertos
          </p>
        </div>

        <div className="bg-white rounded-xl p-6 shadow hover:shadow-lg transition">
          <div className="flex items-center justify-between mb-4">
            <p className="text-gray-600 text-sm font-medium">Simulados</p>
            <Award className="w-5 h-5 text-[#0ea5e9]" />
          </div>
          <p className="text-3xl font-bold text-[#0f172a]">
            {stats.totalSessions}
          </p>
        </div>

        <div className="bg-white rounded-xl p-6 shadow hover:shadow-lg transition">
          <div className="flex items-center justify-between mb-4">
            <p className="text-gray-600 text-sm font-medium">
              Tempo Medio
            </p>
            <Clock className="w-5 h-5 text-[#0ea5e9]" />
          </div>
          <p className="text-3xl font-bold text-[#0f172a]">
            {stats.averageTimePerQuestion}s
          </p>
        </div>
      </div>

      {/* Top and Weak Disciplines */}
      <div className="grid md:grid-cols-2 gap-6">
        {/* Top Disciplines */}
        <div className="bg-white rounded-xl p-6 shadow">
          <h3 className="text-lg font-bold text-[#0f172a] mb-4 flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-green-600" />
            Seus Pontos Fortes
          </h3>
          <div className="space-y-3">
            {topDisciplines.map((d, idx) => (
              <div key={d.discipline} className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-green-100 text-green-700 font-bold flex items-center justify-center text-sm">
                  {idx + 1}
                </div>
                <div className="flex-1">
                  <p className="font-medium text-gray-800">{d.discipline}</p>
                  <div className="w-full bg-gray-200 rounded-full h-2 mt-1">
                    <div
                      className="bg-green-500 h-2 rounded-full"
                      style={{ width: `${d.accuracy}%` }}
                    />
                  </div>
                </div>
                <p className="font-bold text-green-600 text-sm w-12 text-right">
                  {d.accuracy}%
                </p>
              </div>
            ))}
          </div>
          {topDisciplines.length === 0 && (
            <p className="text-gray-500 text-center py-6">
              Sem dados ainda. Comece um simulado!
            </p>
          )}
        </div>

        {/* Weak Disciplines */}
        <div className="bg-white rounded-xl p-6 shadow">
          <h3 className="text-lg font-bold text-[#0f172a] mb-4 flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-orange-600 transform -scale-y-100" />
            Areas de Melhoria
          </h3>
          <div className="space-y-3">
            {weakDisciplines.map((d, idx) => (
              <div key={d.discipline} className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-orange-100 text-orange-700 font-bold flex items-center justify-center text-sm">
                  {idx + 1}
                </div>
                <div className="flex-1">
                  <p className="font-medium text-gray-800">{d.discipline}</p>
                  <div className="w-full bg-gray-200 rounded-full h-2 mt-1">
                    <div
                      className="bg-orange-500 h-2 rounded-full"
                      style={{ width: `${d.accuracy}%` }}
                    />
                  </div>
                </div>
                <p className="font-bold text-orange-600 text-sm w-12 text-right">
                  {d.accuracy}%
                </p>
              </div>
            ))}
          </div>
          {weakDisciplines.length === 0 && (
            <p className="text-gray-500 text-center py-6">
              Sem dados ainda. Comece um simulado!
            </p>
          )}
        </div>
      </div>

      {/* Account Info */}
      <div className="bg-white rounded-xl p-6 shadow">
        <h3 className="text-lg font-bold text-[#0f172a] mb-4">Informacoes da Conta</h3>
        <div className="space-y-3">
          <div className="flex justify-between items-center py-2 border-b border-gray-200">
            <span className="text-gray-600">Email</span>
            <span className="font-medium text-gray-800">{user?.email}</span>
          </div>
          <div className="flex justify-between items-center py-2 border-b border-gray-200">
            <span className="text-gray-600">Nome</span>
            <span className="font-medium text-gray-800">{user?.name}</span>
          </div>
          <div className="flex justify-between items-center py-2">
            <span className="text-gray-600">Tipo de Conta</span>
            <span className="font-medium text-[#0ea5e9] bg-[#0ea5e9]/10 px-3 py-1 rounded-full text-sm">
              Usuario
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
