import type { ReactElement } from "react";
import { SignIn } from "@clerk/clerk-react";

// Branded sign-in screen shown when signed out. Clerk's <SignIn> runs in
// "virtual" routing mode since this SPA has no URL router.
export function SignInPage(): ReactElement {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-[#f8fafc] p-4">
      <div className="text-center mb-8">
        <h1 className="text-4xl text-[#0f172a]">LexFlow</h1>
        <p className="text-gray-500 mt-2">Sua aprovação no Direito</p>
      </div>
      <SignIn routing="virtual" />
      <p className="mt-8 text-xs text-gray-400">
        Powered by{" "}
        <a
          href="https://mrhewbuc.com"
          target="_blank"
          rel="noopener noreferrer"
          className="font-medium text-gray-500 hover:text-[#0ea5e9]"
        >
          Mr. Hewbuc
        </a>
      </p>
    </div>
  );
}
