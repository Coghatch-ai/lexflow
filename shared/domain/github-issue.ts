// shared/domain/github-issue.ts
//
// Zod schema for the admin "create GitHub issue" form. The actual issue is
// created by the central mrhewbuc-issues service (the lexflow Lambda has no NAT
// egress); this schema only validates the client-side form payload.

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
