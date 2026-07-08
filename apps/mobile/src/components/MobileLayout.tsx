import type { ReactElement, ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { BarChart3, Bookmark, Home, LogOut, RefreshCw, Scale, Layers } from "lucide-react";
import { useSession } from "../auth";

type Tab = { href: string; label: string; icon: typeof Home };

const TABS: Tab[] = [
  { href: "/", label: "Início", icon: Home },
  { href: "/review", label: "Revisar", icon: RefreshCw },
  { href: "/flashcards", label: "Flashcards", icon: Layers },
  { href: "/progress", label: "Progresso", icon: BarChart3 },
  { href: "/saved", label: "Salvos", icon: Bookmark },
];

// App shell: phone-width column, sticky brand header (with sign-out), sticky
// bottom tab bar. The practice/review/result screens run immersive (no chrome)
// so the question fills the viewport like a native flow. Safe-area insets keep
// the bars clear of the notch and home indicator.
export function MobileLayout({ children }: { children: ReactNode }): ReactElement {
  const [location] = useLocation();
  const { signOut } = useSession();
  const immersive =
    location === "/practice" ||
    location === "/review" ||
    location === "/result" ||
    location === "/flashcards";

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-md flex-col bg-paper">
      {!immersive && (
        <header
          className="sticky top-0 z-10 flex items-center justify-center border-b border-line bg-paper/90 px-4 py-3 backdrop-blur"
          style={{ paddingTop: "max(0.75rem, env(safe-area-inset-top))" }}
        >
          <div className="flex items-center gap-2">
            <Scale className="h-5 w-5 text-seal" strokeWidth={1.75} />
            <span className="font-display text-lg font-bold tracking-tightish text-ink">
              Prob<span className="text-seal">ius</span>
            </span>
          </div>
          <button
            type="button"
            onClick={signOut}
            aria-label="Sair"
            className="absolute right-4 text-ink-mute"
          >
            <LogOut className="h-5 w-5" strokeWidth={1.75} />
          </button>
        </header>
      )}

      <main className="flex-1">{children}</main>

      {!immersive && (
        <nav
          className="sticky bottom-0 z-10 grid grid-cols-5 border-t border-line bg-surface"
          style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
        >
          {TABS.map(({ href, label, icon: Icon }) => {
            const active = location === href;
            return (
              <Link
                key={href}
                href={href}
                className={`flex flex-col items-center gap-0.5 py-2.5 text-[0.7rem] font-semibold ${
                  active ? "text-ink" : "text-ink-mute"
                }`}
              >
                <Icon className="h-5 w-5" strokeWidth={active ? 2.25 : 1.75} />
                {label}
              </Link>
            );
          })}
        </nav>
      )}
    </div>
  );
}
