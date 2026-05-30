import { useState } from 'react';
import { useSession } from '../auth';
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
} from 'lucide-react';

interface LayoutProps {
  children: React.ReactNode;
  currentPage: string;
  onPageChange: (page: string) => void;
}

type Page = 'home' | 'testing' | 'analytics' | 'goals' | 'profile';

const navItems: Array<{ id: Page; label: string; icon: React.ReactNode }> = [
  { id: 'home', label: 'Inicio', icon: <Home className="w-5 h-5" /> },
  { id: 'testing', label: 'Simulados', icon: <BookOpen className="w-5 h-5" /> },
  {
    id: 'analytics',
    label: 'Analytics',
    icon: <BarChart3 className="w-5 h-5" />,
  },
  { id: 'goals', label: 'Metas', icon: <Target className="w-5 h-5" /> },
  { id: 'profile', label: 'Perfil', icon: <User className="w-5 h-5" /> },
];

export default function Layout({
  children,
  currentPage,
  onPageChange,
}: LayoutProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { user, signOut } = useSession();

  const handleLogout = () => {
    signOut();
  };

  return (
    <div className="flex h-screen bg-[#F8FAFC]">
      {/* Sidebar */}
      <div
        className={`fixed inset-y-0 left-0 z-50 w-64 bg-gradient-to-b from-[#0f172a] to-[#1e3a5f] transform transition-transform duration-300 ease-in-out md:relative md:translate-x-0 ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex flex-col h-full">
          {/* Logo */}
          <div className="p-6 border-b border-[#0ea5e9]/20">
            <div className="flex items-center gap-3">
              <div className="bg-[#0ea5e9] p-2 rounded-lg">
                <Scale className="w-6 h-6 text-white" />
              </div>
              <div>
                <h1 className="text-xl font-bold text-white">LexFlow</h1>
                <p className="text-xs text-[#0ea5e9]">Seu caminho para aprovacao</p>
              </div>
            </div>
          </div>

          {/* Navigation */}
          <nav className="flex-1 overflow-y-auto px-4 py-6 space-y-2">
            {navItems.map((item) => (
              <button
                key={item.id}
                onClick={() => {
                  onPageChange(item.id);
                  setSidebarOpen(false);
                }}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-all ${
                  currentPage === item.id
                    ? 'bg-[#0ea5e9] text-white font-semibold'
                    : 'text-white hover:bg-[#1e3a5f] text-opacity-80'
                }`}
              >
                {item.icon}
                <span>{item.label}</span>
              </button>
            ))}
          </nav>

          {/* User Info & Logout */}
          <div className="p-4 border-t border-[#0ea5e9]/20 space-y-3">
            <div className="px-4 py-3 bg-[#1e3a5f] rounded-lg">
              <p className="text-xs text-[#0ea5e9] font-medium">Conectado como</p>
              <p className="text-sm text-white font-semibold truncate">
                {user?.name}
              </p>
              <p className="text-xs text-white/70 truncate">{user?.email}</p>
            </div>
            <button
              onClick={handleLogout}
              className="w-full flex items-center justify-center gap-2 bg-red-600 hover:bg-red-700 text-white py-2 rounded-lg font-medium transition"
            >
              <LogOut className="w-4 h-4" />
              Sair
            </button>
          </div>
        </div>

        {/* Close button for mobile */}
        <button
          onClick={() => setSidebarOpen(false)}
          className="absolute top-4 right-4 md:hidden text-white hover:bg-[#1e3a5f] p-2 rounded-lg"
        >
          <X className="w-6 h-6" />
        </button>
      </div>

      {/* Main Content */}
      <div className="flex-1 overflow-auto">
        {/* Header */}
        <div className="bg-white border-b border-gray-200 p-4 md:p-6 sticky top-0 z-40">
          <div className="flex items-center justify-between">
            <button
              onClick={() => setSidebarOpen(true)}
              className="md:hidden p-2 hover:bg-gray-100 rounded-lg"
            >
              <Menu className="w-6 h-6 text-gray-700" />
            </button>
            <h2 className="text-2xl font-bold text-[#0f172a]">
              {navItems.find((item) => item.id === currentPage)?.label}
            </h2>
            <div className="w-10"></div>
          </div>
        </div>

        {/* Page Content */}
        <div className="p-4 md:p-6 max-w-7xl mx-auto">{children}</div>

        {/* Footer */}
        <footer className="text-center text-xs text-gray-400 py-6">
          Powered by{' '}
          <a
            href="https://mrhewbuc.com"
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-gray-500 hover:text-[#0ea5e9]"
          >
            Mr. Hewbuc
          </a>
        </footer>
      </div>

      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/50 md:hidden z-40"
          onClick={() => setSidebarOpen(false)}
        />
      )}
    </div>
  );
}
