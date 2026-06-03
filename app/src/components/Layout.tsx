import { useState } from 'react';
import { useSession } from '../auth';
import { trpc } from '../shared/lib/trpc';
import {
  Home,
  BookOpen,
  BarChart3,
  Target,
  User,
  LogOut,
  Menu,
  X,
  Scale,
  FileText,
  SlidersHorizontal,
  CalendarDays,
  Bookmark,
} from 'lucide-react';

interface LayoutProps {
  children: React.ReactNode;
  currentPage: string;
  onPageChange: (page: string) => void;
}

type Page = 'home' | 'testing' | 'analytics' | 'goals' | 'profile' | 'saved' | 'admin-questions' | 'admin-algorithm' | 'admin-calendar';

const navItems: Array<{ id: Page; label: string; icon: React.ReactNode }> = [
  { id: 'home', label: 'Inicio', icon: <Home className="w-[18px] h-[18px]" /> },
  { id: 'testing', label: 'Simulados', icon: <BookOpen className="w-[18px] h-[18px]" /> },
  { id: 'analytics', label: 'Analytics', icon: <BarChart3 className="w-[18px] h-[18px]" /> },
  { id: 'goals', label: 'Metas', icon: <Target className="w-[18px] h-[18px]" /> },
  { id: 'saved', label: 'Questões Salvas', icon: <Bookmark className="w-[18px] h-[18px]" /> },
  { id: 'profile', label: 'Perfil', icon: <User className="w-[18px] h-[18px]" /> },
];

export default function Layout({
  children,
  currentPage,
  onPageChange,
}: LayoutProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { user, signOut } = useSession();
  const me = trpc.users.me.useQuery();
  const isAdmin = me.data?.role === 'admin';

  const initials = (user?.name ?? 'Probius')
    .split(' ')
    .slice(0, 2)
    .map((p) => p.charAt(0))
    .join('')
    .toUpperCase();

  return (
    <div className="flex h-screen bg-paper">
      {/* Sidebar */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 w-[16.5rem] bg-ink transform transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] md:relative md:translate-x-0 ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex flex-col h-full">
          {/* Wordmark */}
          <div className="px-6 pt-7 pb-6">
            <div className="flex items-center gap-2.5">
              <Scale className="w-5 h-5 text-seal-bright" strokeWidth={1.75} />
              <span className="font-display text-lg font-bold tracking-tightish text-surface">
                Prob<span className="text-seal-bright">ius</span>
              </span>
            </div>
            <p className="mt-2 text-[0.7rem] leading-relaxed text-ink-mute">
              Preparatório · Exame de Ordem
            </p>
          </div>

          <div className="mx-6 h-px bg-[var(--ink-line)]" />

          {/* Navigation */}
          <nav className="flex-1 overflow-y-auto px-3 py-5 space-y-0.5">
            <p className="px-3 pb-2 eyebrow">Navegação</p>
            {navItems.map((item) => {
              const active = currentPage === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => {
                    onPageChange(item.id);
                    setSidebarOpen(false);
                  }}
                  aria-current={active ? 'page' : undefined}
                  className={`group relative w-full flex items-center gap-3 rounded-lg pl-4 pr-3 py-2.5 text-sm transition-colors ${
                    active
                      ? 'bg-[var(--ink-raised)] text-surface font-semibold'
                      : 'text-[var(--ink-mute)] hover:text-surface hover:bg-white/[0.05] font-medium'
                  }`}
                >
                  <span
                    className={`absolute left-0 top-1/2 -translate-y-1/2 h-5 w-[3px] rounded-full bg-seal-bright transition-opacity ${
                      active ? 'opacity-100' : 'opacity-0'
                    }`}
                  />
                  <span className={active ? 'text-seal-bright' : ''}>{item.icon}</span>
                  <span>{item.label}</span>
                </button>
              );
            })}
            {isAdmin && (
              <>
                <div className="mx-1 mt-3 mb-2 h-px bg-[var(--ink-line)]" />
                <p className="px-3 pb-1 eyebrow">Admin</p>
                {(
                  [
                    { id: 'admin-questions' as Page, label: 'Questões', icon: <FileText className="w-[18px] h-[18px]" /> },
                    { id: 'admin-algorithm' as Page, label: 'Algoritmo', icon: <SlidersHorizontal className="w-[18px] h-[18px]" /> },
                    { id: 'admin-calendar' as Page, label: 'Calendário', icon: <CalendarDays className="w-[18px] h-[18px]" /> },
                  ] as const
                ).map((item) => {
                  const active = currentPage === item.id;
                  return (
                    <button
                      key={item.id}
                      onClick={() => { onPageChange(item.id); setSidebarOpen(false); }}
                      aria-current={active ? 'page' : undefined}
                      className={`group relative w-full flex items-center gap-3 rounded-lg pl-4 pr-3 py-2.5 text-sm transition-colors ${
                        active
                          ? 'bg-[var(--ink-raised)] text-surface font-semibold'
                          : 'text-[var(--ink-mute)] hover:text-surface hover:bg-white/[0.05] font-medium'
                      }`}
                    >
                      <span
                        className={`absolute left-0 top-1/2 -translate-y-1/2 h-5 w-[3px] rounded-full bg-seal-bright transition-opacity ${
                          active ? 'opacity-100' : 'opacity-0'
                        }`}
                      />
                      <span className={active ? 'text-seal-bright' : ''}>{item.icon}</span>
                      <span>{item.label}</span>
                    </button>
                  );
                })}
              </>
            )}
          </nav>

          {/* User + logout */}
          <div className="px-3 pb-5">
            <div className="mx-1 mb-3 h-px bg-[var(--ink-line)]" />
            <div className="flex items-center gap-3 rounded-lg px-3 py-2.5">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-[var(--ink-raised)] font-display text-xs font-bold text-seal-bright ring-1 ring-[var(--ink-line)]">
                {initials}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-surface">{user?.name}</p>
                <p className="truncate text-[0.7rem] text-ink-mute">{user?.email}</p>
              </div>
            </div>
            <button
              onClick={() => signOut()}
              className="mt-1 flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium text-ink-mute transition-colors hover:bg-[#b04638]/20 hover:text-[#e9a59c]"
            >
              <LogOut className="w-[18px] h-[18px]" />
              Sair
            </button>
          </div>
        </div>

        {/* Close (mobile) */}
        <button
          onClick={() => setSidebarOpen(false)}
          aria-label="Fechar menu"
          className="absolute top-5 right-4 md:hidden text-ink-mute hover:text-surface p-1.5 rounded-md"
        >
          <X className="w-5 h-5" />
        </button>
      </aside>

      {/* Main column */}
      <div className="flex-1 overflow-auto">
        {/* Header */}
        <header className="sticky top-0 z-40 border-b border-line bg-surface/85 backdrop-blur-md">
          <div className="flex items-center gap-3 px-4 md:px-8 h-16">
            <button
              onClick={() => setSidebarOpen(true)}
              aria-label="Abrir menu"
              className="md:hidden -ml-1 p-2 rounded-md text-ink-soft hover:bg-paper-sink"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="min-w-0">
              <p className="eyebrow leading-none">Probius</p>
              <h2 className="mt-1 font-display text-lg md:text-xl font-bold leading-none">
                {currentPage === 'admin-questions' ? 'Questões' :
                 currentPage === 'admin-algorithm' ? 'Algoritmo' :
                 currentPage === 'admin-calendar' ? 'Calendário' :
                 navItems.find((item) => item.id === currentPage)?.label}
              </h2>
            </div>
          </div>
        </header>

        {/* Page content */}
        <div className="px-4 md:px-8 py-6 md:py-8 max-w-[78rem] mx-auto">{children}</div>

        <footer className="px-8 pb-8 pt-2 text-xs text-ink-mute">
          <span className="inline-block h-1 w-1 rounded-full bg-seal align-middle mr-2" />
          Powered by{' '}
          <a
            href="https://mrhewbuc.com"
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-ink-soft underline-offset-2 hover:underline hover:text-ink"
          >
            Mr. Hewbuc
          </a>
        </footer>
      </div>

      {/* Mobile overlay */}
      {sidebarOpen && (
        <button
          aria-label="Fechar menu"
          className="fixed inset-0 bg-ink/50 md:hidden z-40 cursor-default"
          onClick={() => setSidebarOpen(false)}
        />
      )}
    </div>
  );
}
