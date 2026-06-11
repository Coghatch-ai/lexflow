import type { ReactElement } from 'react';
import { Link } from 'wouter';
import { useSession } from '../auth';
import { User, TrendingUp, BookOpen, Award, Clock, Bookmark, StickyNote, ChevronRight } from 'lucide-react';
import { trpc } from '../shared/lib/trpc';
import { useLov } from '../shared/hooks/use-lov';

function ProfileQuickLinks(): ReactElement {
  const bookmarksQuery = trpc.bookmarks.list.useQuery();
  const notesQuery = trpc.notes.list.useQuery();
  const savedCount = (bookmarksQuery.data ?? []).length;
  const notesCount = (notesQuery.data ?? []).filter((n) => n.noteText.trim().length > 0).length;

  const links = [
    {
      href: '/saved',
      icon: <Bookmark className="w-5 h-5 text-[#16161a]" />,
      title: 'Questões Salvas',
      countLine: savedCount === 1 ? '1 questão salva' : `${savedCount} questões salvas`,
    },
    {
      href: '/saved?tab=notes',
      icon: <StickyNote className="w-5 h-5 text-[#16161a]" />,
      title: 'Minhas Anotações',
      countLine: notesCount === 1 ? '1 anotação' : `${notesCount} anotações`,
    },
  ];

  return (
    <div className="grid md:grid-cols-2 gap-4">
      {links.map((link) => (
        <Link
          key={link.href}
          href={link.href}
          className="bg-white rounded-xl p-6 shadow hover:shadow-lg transition flex items-center justify-between"
        >
          <div>
            <div className="flex items-center gap-2 mb-1">
              {link.icon}
              <p className="font-bold text-[#16161a]">{link.title}</p>
            </div>
            <p className="text-sm text-gray-500">{link.countLine}</p>
          </div>
          <ChevronRight className="w-5 h-5 text-gray-400" />
        </Link>
      ))}
    </div>
  );
}

export default function ProfilePage(): ReactElement {
  const { user } = useSession();

  const summary = trpc.stats.summary.useQuery();
  const byDiscipline = trpc.stats.byDiscipline.useQuery();
  const disciplineLov = useLov('DISCIPLINE');

  const stats = {
    totalAnswered: summary.data?.totalAnswered ?? 0,
    totalCorrect: summary.data?.totalCorrect ?? 0,
    accuracy: summary.data?.accuracy ?? 0,
    totalSessions: summary.data?.totalSessions ?? 0,
    averageTimePerQuestion: summary.data?.averageTimePerQuestion ?? 0,
  };

  const sorted = [...(byDiscipline.data ?? [])].sort((a, b) => b.accuracy - a.accuracy);
  const topDisciplines = sorted
    .slice(0, 5)
    .map((d) => ({ discipline: disciplineLov.labelOf(d.discipline), accuracy: d.accuracy }));
  const weakDisciplines = [...sorted]
    .reverse()
    .slice(0, 5)
    .map((d) => ({ discipline: disciplineLov.labelOf(d.discipline), accuracy: d.accuracy }));

  return (
    <div className="space-y-6">
      {/* User Info Card */}
      <div className="bg-gradient-to-r from-[#16161a] to-[#26262c] rounded-xl p-8 text-white shadow-lg">
        <div className="flex items-center gap-4 mb-4">
          <div className="bg-[#1f1f25] p-4 rounded-full ring-1 ring-white/15">
            <User className="w-8 h-8 text-[#d9ab53]" strokeWidth={1.75} />
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
            <TrendingUp className="w-5 h-5 text-[#16161a]" />
          </div>
          <p className="text-3xl font-bold text-[#16161a]">{stats.accuracy}%</p>
        </div>

        <div className="bg-white rounded-xl p-6 shadow hover:shadow-lg transition">
          <div className="flex items-center justify-between mb-4">
            <p className="text-gray-600 text-sm font-medium">Questoes</p>
            <BookOpen className="w-5 h-5 text-[#16161a]" />
          </div>
          <p className="text-3xl font-bold text-[#16161a]">
            {stats.totalAnswered}
          </p>
          <p className="text-xs text-gray-500 mt-1">
            {stats.totalCorrect} acertos
          </p>
        </div>

        <div className="bg-white rounded-xl p-6 shadow hover:shadow-lg transition">
          <div className="flex items-center justify-between mb-4">
            <p className="text-gray-600 text-sm font-medium">Simulados</p>
            <Award className="w-5 h-5 text-[#16161a]" />
          </div>
          <p className="text-3xl font-bold text-[#16161a]">
            {stats.totalSessions}
          </p>
        </div>

        <div className="bg-white rounded-xl p-6 shadow hover:shadow-lg transition">
          <div className="flex items-center justify-between mb-4">
            <p className="text-gray-600 text-sm font-medium">
              Tempo Medio
            </p>
            <Clock className="w-5 h-5 text-[#16161a]" />
          </div>
          <p className="text-3xl font-bold text-[#16161a]">
            {stats.averageTimePerQuestion}s
          </p>
        </div>
      </div>

      {/* Saved questions + notes quick links */}
      <ProfileQuickLinks />

      {/* Top and Weak Disciplines */}
      <div className="grid md:grid-cols-2 gap-6">
        {/* Top Disciplines */}
        <div className="bg-white rounded-xl p-6 shadow">
          <h3 className="text-lg font-bold text-[#16161a] mb-4 flex items-center gap-2">
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
          <h3 className="text-lg font-bold text-[#16161a] mb-4 flex items-center gap-2">
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
        <h3 className="text-lg font-bold text-[#16161a] mb-4">Informacoes da Conta</h3>
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
            <span className="font-medium text-[#16161a] bg-[#16161a]/10 px-3 py-1 rounded-full text-sm">
              Usuario
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
