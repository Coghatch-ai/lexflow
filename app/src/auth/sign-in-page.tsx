import type { ReactElement } from "react";
import { SignIn } from "@clerk/clerk-react";
import { Scale } from "lucide-react";

// Branded sign-in screen shown when signed out. Clerk's <SignIn> runs in
// "virtual" routing mode since this SPA has no URL router. The widget is
// themed to the "Chambers" palette so it reads as one continuous instrument.
export function SignInPage(): ReactElement {
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
          <h1 className="mt-4 font-display text-[2.5rem] leading-[1.05] font-bold tracking-tightish">
            Estudo de Ordem,
            <br />
            conduzido com método.
          </h1>
          <p className="mt-5 text-sm leading-relaxed text-ink-mute">
            Simulados adaptativos, revisão espaçada e análise de erros — tudo num só painel,
            calibrado para a sua aprovação.
          </p>
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

        {/* NOTE: withSignUp (combined sign-in-or-up) was tried here to keep registration inside
            this themed widget — the hosted Account Portal cannot be styled from code. It is
            REVERTED because it removed the "Sign up" affordance entirely under routing="virtual",
            leaving no way to register. Availability beats theming. Re-attempt only with a real
            in-app <SignUp> mounted and signUpUrl pointed at it, verified in the browser first. */}
        <SignIn
          routing="virtual"
          appearance={{
            variables: {
              colorPrimary: "#16161a",
              colorText: "#16161a",
              colorTextSecondary: "#6b6b75",
              colorBackground: "#ffffff",
              colorInputBackground: "#ffffff",
              borderRadius: "10px",
              fontFamily: '"Hanken Grotesk", sans-serif',
            },
            elements: {
              card: "shadow-none border border-line",
              headerTitle: "font-display",
              formButtonPrimary:
                "bg-ink hover:bg-ink-raised text-surface normal-case font-semibold",
              footerActionLink: "text-seal hover:text-ink",
            },
          }}
        />

        {/* Turnstile mount point. The prod Clerk instance has bot protection on
            (user_settings.sign_up.captcha_enabled = true, widget "smart"). Without this
            element Clerk falls back to an INVISIBLE widget that blocks suspected-bot
            traffic — which silently breaks the first sign-in on a new device (the
            Client-Trust path) and any sign-up. Dev instances run in test_mode and never
            enforce it, so its absence only shows up in production. */}
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
