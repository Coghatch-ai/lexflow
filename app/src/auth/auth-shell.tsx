// app/src/auth/auth-shell.tsx
//
// The branded frame around any Clerk auth widget: dark brand panel on the left, widget column
// on the right. <SignInPage> and <SignUpPage> both render through this, so sign-in and sign-up
// are the same screen with a different widget inside — no chance of the two drifting apart.
import type { ReactElement, ReactNode } from "react";
import { Scale } from "lucide-react";

export function AuthShell({
  headline,
  blurb,
  children,
}: {
  headline: ReactNode;
  blurb: string;
  children: ReactNode;
}): ReactElement {
  return (
    <div className="min-h-screen md:grid md:grid-cols-[1.05fr_1fr]">
      {/* Brand panel — the black is the point. */}
      <aside className="relative hidden md:flex flex-col justify-between overflow-hidden bg-ink px-12 py-14 text-surface">
        {/* faint judicial rule lines */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-[0.05]"
          style={{
            backgroundImage: "repeating-linear-gradient(0deg, #ffffff 0 1px, transparent 1px 64px)",
          }}
        />
        <div className="relative flex items-center gap-2.5">
          <Scale className="w-6 h-6 text-seal-bright" strokeWidth={1.75} />
          <span className="font-display text-xl font-bold tracking-tightish">
            Prob<span className="text-seal-bright">ius</span>
          </span>
        </div>

        <div className="relative max-w-sm">
          <p className="eyebrow !text-seal-bright">Plataforma interna</p>
          {/* text-surface is required, not decorative: index.css sets `h1..h6 { color: var(--ink) }`
              as an element rule, which beats the `text-surface` inherited from this dark <aside>.
              Without it the headline renders ink-on-ink and is invisible. */}
          <h1 className="mt-4 font-display text-[2.5rem] leading-[1.05] font-bold tracking-tightish text-surface">
            {headline}
          </h1>
          <p className="mt-5 text-sm leading-relaxed text-ink-mute">{blurb}</p>
        </div>

        <p className="relative text-xs text-ink-mute">
          <span className="inline-block h-1 w-1 rounded-full bg-seal align-middle mr-2" />
          Acesso restrito · uso interno
        </p>
      </aside>

      {/* Auth column */}
      <main className="flex flex-col items-center justify-center bg-paper px-4 py-12">
        <div className="md:hidden mb-8 flex items-center gap-2.5">
          <Scale className="w-6 h-6 text-seal" strokeWidth={1.75} />
          <span className="font-display text-xl font-bold tracking-tightish text-ink">
            Prob<span className="text-seal">ius</span>
          </span>
        </div>

        {children}

        {/* Turnstile mount point. The production Clerk instance has bot protection on
            (user_settings.sign_up.captcha_enabled = true, widget "smart"). Without this element
            Clerk falls back to an INVISIBLE widget that blocks suspected-bot traffic — breaking
            the first sign-in on a new device (Client Trust) and every sign-up. Dev instances run
            in test_mode and never enforce it, so its absence only surfaces in production. It
            lives in the shell so BOTH auth screens always have it. */}
        <div id="clerk-captcha" />

        <p className="mt-8 text-xs text-ink-mute">
          Powered by{" "}
          <a
            href="https://mrhewbuc.com"
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-ink-soft underline-offset-2 hover:underline hover:text-ink"
          >
            Mr. Hewbuc
          </a>
        </p>
      </main>
    </div>
  );
}
