import type { ReactElement } from "react";
import { SignIn } from "@clerk/clerk-react";
import { Scale } from "lucide-react";

// Mobile sign-in: a single centered column (the desktop brand panel is dropped).
// Clerk's <SignIn> runs in "virtual" routing mode since this SPA has no URL
// router for auth. Themed to the "Chambers" palette to match the main app.
export function SignInPage(): ReactElement {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-paper px-5 py-12">
      <div className="mb-8 flex items-center gap-2.5">
        <Scale className="h-7 w-7 text-seal" strokeWidth={1.75} />
        <span className="font-display text-2xl font-bold tracking-tightish text-ink">
          Prob<span className="text-seal">ius</span>
        </span>
      </div>

      <p className="eyebrow mb-6 !text-seal">Prática OAB · uso interno</p>

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
            rootBox: "w-full max-w-sm",
            card: "shadow-none border border-line w-full",
            headerTitle: "font-display",
            formButtonPrimary: "bg-ink hover:bg-ink-raised text-surface normal-case font-semibold",
            footerActionLink: "text-seal hover:text-ink",
          },
        }}
      />

      {/* Turnstile mount point — same reason as the web app: the prod Clerk instance
          has bot protection on, and without this element Clerk uses an invisible
          widget that blocks the first sign-in on a new device. */}
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
  );
}
