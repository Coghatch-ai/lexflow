// app/src/shared/lib/issues-client.ts
//
// Browser-direct client for the central mrhewbuc-issues Function URL. Replaces the
// former lexflow API → relay → GitHub path: the SPA calls the service with the
// user's Clerk JWT; the service authorizes by origin + token and scopes the repo to
// lexflow server-side. The GitHub PAT lives only in mrhewbuc-issues, never here.

import { getAuthToken } from "./trpc";

const FUNCTION_URL = import.meta.env.VITE_ISSUES_FUNCTION_URL;
const PROJECT = "lexflow";

export interface IssueListItem {
  number: number;
  title: string;
  url: string;
  createdAt: string;
  labels: string[];
}
export interface IssueAuthor {
  login: string | null;
  avatarUrl: string | null;
}
export interface IssueDetail {
  number: number;
  title: string;
  body: string | null;
  state: string;
  url: string;
  createdAt: string;
  updatedAt: string;
  author: IssueAuthor;
  labels: string[];
}
export interface IssueComment {
  id: number;
  body: string;
  createdAt: string;
  author: IssueAuthor;
}
export interface IssueDetailResult {
  issue: IssueDetail;
  comments: IssueComment[];
}

async function call<T>(payload: Record<string, unknown>): Promise<T> {
  if (FUNCTION_URL.length === 0) {
    throw new Error("VITE_ISSUES_FUNCTION_URL não configurado");
  }
  const token = await getAuthToken();
  if (token === null || token.length === 0) {
    throw new Error("Sessão expirada — entre novamente.");
  }
  const res = await fetch(FUNCTION_URL, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ project: PROJECT, ...payload }),
  });
  if (!res.ok) {
    let msg = `Falha na requisição (${String(res.status)})`;
    try {
      const j = (await res.json()) as { error?: string };
      if (j.error !== undefined) msg = j.error;
    } catch {
      // keep the default message
    }
    throw new Error(msg);
  }
  return (await res.json()) as T;
}

export const issuesApi = {
  list: (): Promise<{ issues: IssueListItem[] }> => call({ action: "list" }),
  get: (issueNumber: number): Promise<IssueDetailResult> =>
    call({ action: "get", number: issueNumber }),
  create: (input: {
    title: string;
    body: string;
    labels: string[];
  }): Promise<{ number: number; url: string }> => call({ action: "create", ...input }),
  close: (issueNumber: number): Promise<{ number: number; state: string }> =>
    call({ action: "close", number: issueNumber }),
};
