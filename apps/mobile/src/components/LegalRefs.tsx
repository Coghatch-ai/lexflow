// apps/mobile/src/components/LegalRefs.tsx
//
// Tappable legal references parsed from a question's legal_basis — the student
// reads the actual dispositivo (Planalto article anchor / court súmula page)
// without leaving for Google. Renders nothing when no known law is cited.

import type { ReactElement } from "react";
import { ExternalLink } from "lucide-react";
import { parseLegalRefs } from "@shared/domain/legal-refs";

export function LegalRefs({ legalBasis }: { legalBasis: string | null }): ReactElement | null {
  const refs = parseLegalRefs(legalBasis);
  if (refs.length === 0) return null;
  return (
    <div className="mt-2.5 flex flex-wrap gap-1.5">
      {refs.map((r) => (
        <a
          key={r.label}
          href={r.url}
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-1 rounded-full border border-line bg-paper px-2.5 py-1 text-[0.7rem] font-semibold text-ink active:opacity-70"
        >
          {r.label}
          <ExternalLink className="h-3 w-3 text-ink-mute" strokeWidth={1.75} />
        </a>
      ))}
    </div>
  );
}
