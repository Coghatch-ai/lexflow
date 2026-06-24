// shared/domain/github-issue.ts
//
// Zod schema for the admin "create GitHub issue" form. The actual issue is
// created server-side via trpc.issues.* → lexflow-relay → GitHub (the API Lambda
// has no NAT egress, so the relay makes the call); this schema only validates the
// client-side form payload.

import { z } from "zod";

// Issue "kind" → GitHub label. English code, pt-BR display (conventions §LOV).
export const ISSUE_KINDS = [
  { code: "bug", label: "Bug", ghLabel: "bug" },
  { code: "enhancement", label: "Melhoria", ghLabel: "enhancement" },
  { code: "feedback", label: "Feedback", ghLabel: "beta-feedback" },
] as const;

export type IssueKind = (typeof ISSUE_KINDS)[number]["code"];

export const githubIssueInputSchema = z.object({
  title: z.string().min(1, "Título é obrigatório").max(256),
  body: z.string().min(1, "Descrição é obrigatória").max(20000),
  kind: z.enum(["bug", "enhancement", "feedback"]),
});

export type GithubIssueInput = z.infer<typeof githubIssueInputSchema>;

/**
 * Appends a "Solicitante" footer to a GitHub issue body.
 * Falls back to "desconhecido" when email is empty.
 */
export function appendRequester(body: string, email: string): string {
  const requester = email.length > 0 ? email : "desconhecido";
  return `${body}\n\n---\nSolicitante: ${requester}`;
}

const REQUESTER_RE = /\n---\nSolicitante: (.+?)\s*$/;

/**
 * Extracts the "Solicitante" email appended by {@link appendRequester} from a
 * GitHub issue body. Returns null when the footer is absent (issue created
 * outside the app form). The body is otherwise returned verbatim by the caller.
 */
export function parseRequester(body: string): string | null {
  return REQUESTER_RE.exec(body)?.[1] ?? null;
}
