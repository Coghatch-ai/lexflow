// app/src/shared/lib/issue-service.ts
//
// Thin client for the central mrhewbuc-issues service. The lexflow Lambda has no
// internet egress (no NAT), so issue creation is done from the browser: we POST
// the form payload + the user's Clerk JWT to the service's Function URL. The
// service validates the JWT offline and creates the issue with its own GitHub
// token. No secret lives in this bundle.

import { ISSUE_KINDS, type GithubIssueInput } from "@shared/domain/github-issue";

// Identifies lexflow in the service's PROJECTS registry.
const PROJECT = "lexflow";

const serviceUrl = import.meta.env.VITE_ISSUE_SERVICE_URL;

export interface CreateIssueResult {
  number: number;
  url: string;
}

function ghLabelFor(kind: GithubIssueInput["kind"]): string {
  return ISSUE_KINDS.find((k) => k.code === kind)?.ghLabel ?? kind;
}

export async function createIssue(
  input: GithubIssueInput,
  token: string | null,
): Promise<CreateIssueResult> {
  if (serviceUrl.length === 0) {
    throw new Error("VITE_ISSUE_SERVICE_URL não configurado");
  }
  if (token === null || token.length === 0) {
    throw new Error("Sessão expirada — faça login novamente");
  }

  const res = await fetch(serviceUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      project: PROJECT,
      title: input.title,
      body: input.body,
      labels: [ghLabelFor(input.kind)],
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text.length > 0 ? text : `Falha ao criar issue (${String(res.status)})`);
  }

  return (await res.json()) as CreateIssueResult;
}

export interface IssueListItem {
  number: number;
  title: string;
  url: string;
  createdAt: string;
  labels: string[];
}

export async function listOpenIssues(token: string | null): Promise<IssueListItem[]> {
  if (serviceUrl.length === 0) {
    throw new Error("VITE_ISSUE_SERVICE_URL não configurado");
  }
  if (token === null || token.length === 0) {
    throw new Error("Sessão expirada — faça login novamente");
  }

  const res = await fetch(serviceUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ project: PROJECT, action: "list" }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text.length > 0 ? text : `Falha ao carregar issues (${String(res.status)})`);
  }

  const data = (await res.json()) as { issues: IssueListItem[] };
  return data.issues;
}

export async function closeIssue(number: number, token: string | null): Promise<void> {
  if (serviceUrl.length === 0) {
    throw new Error("VITE_ISSUE_SERVICE_URL não configurado");
  }
  if (token === null || token.length === 0) {
    throw new Error("Sessão expirada — faça login novamente");
  }

  const res = await fetch(serviceUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ project: PROJECT, action: "close", number }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text.length > 0 ? text : `Falha ao fechar issue (${String(res.status)})`);
  }
}
