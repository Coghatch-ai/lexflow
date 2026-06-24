import type { ReactElement, ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { Home, LogOut, Scale } from "lucide-react";
import { useSession } from "../auth";

// App shell: phone-width column, sticky brand header, sticky bottom tab bar.
// The practice/result screens run immersive (no chrome) so the question fills
// the viewport like a native flow. Safe-area insets keep the bars clear of the
// notch and home indicator.
export function MobileLayout({ children }: { children: ReactNode }): ReactElement {
  const [location] = useLocation();
  const { signOut } = useSession();
  const immersive = location === "/practice" || location === "/result";
  const onHome = location === "/";

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
        </header>
      )}

      <main className="flex-1">{children}</main>

      {!immersive && (
        <nav
          className="sticky bottom-0 z-10 grid grid-cols-2 border-t border-line bg-surface"
          style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
        >
          <Link
            href="/"
            className={`flex flex-col items-center gap-0.5 py-2.5 text-[0.7rem] font-semibold ${
              onHome ? "text-ink" : "text-ink-mute"
            }`}
          >
            <Home className="h-5 w-5" strokeWidth={onHome ? 2.25 : 1.75} />
            Início
          </Link>
          <button
            type="button"
            onClick={signOut}
            className="flex flex-col items-center gap-0.5 py-2.5 text-[0.7rem] font-semibold text-ink-mute"
          >
            <LogOut className="h-5 w-5" strokeWidth={1.75} />
            Sair
          </button>
        </nav>
      )}
    </div>
  );
}
