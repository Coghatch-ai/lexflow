// api/relay/relay-handler.ts
//
// Per-project outbound "relay" Lambda — the non-VPC sender that the VPC-bound
// API Lambda invokes (via lambda:InvokeFunction) to reach external services it
// cannot hit from inside the VPC (no NAT). Replaces the shared mrhewbuc-issues
// central Lambda for LexFlow. Channel-routed: a new channel is one more case in
// the dispatch switch, not a new Lambda.
//
//   ai     → Google Gemini completion (API resolves the prompt; relay forwards)
//   github → GitHub issue ops (create/list/get/close) against a FIXED repo
//   email  → SMTP via nodemailer (scaffold; live once /smtp-* SSM params exist)
//
// Trust boundary: invoked ONLY by the LexFlow API role (IAM-gated) — no Function
// URL / API Gateway event, so it is unreachable from a browser and can never act
// as an open relay. The API has already verified the Clerk JWT + role; the relay
// does no auth of its own. Secrets (Gemini key, GitHub PAT, SMTP creds) are read
// from SSM under SSM_PREFIX at runtime, KMS-decrypted, and cached for the life of
// the warm container — never placed in the function's environment configuration.

import nodemailer, { type Transporter } from "nodemailer";
import { SSMClient, GetParameterCommand, GetParametersCommand } from "@aws-sdk/client-ssm";

const REGION = process.env.AWS_REGION ?? "sa-east-1";
// Set by the SAM template to /lexflow/relay/${Environment}.
const SSM_PREFIX = process.env.SSM_PREFIX ?? "/lexflow/relay/prod";
// Repo is server-derived — the caller never picks it (scoping is the boundary).
const GITHUB_REPO = process.env.GITHUB_REPO ?? "Coghatch-ai/lexflow";

const DEFAULT_AI_MODEL = "gemini-2.0-flash";
// Bound the upstream LLM call below the Lambda timeout so a hung provider returns
// a clean error rather than an opaque Lambda timeout.
const AI_TIMEOUT_MS = 25_000;

const ssm = new SSMClient({ region: REGION });

// ── Channel-tagged event (discriminated union; sent by api/lib/relay.ts) ───────
interface AiEvent {
  channel: "ai";
  // RESOLVED prompt: the API already interpolated the template. The relay never
  // sees promptId/variables — it just forwards system+user to the model.
  system?: string;
  user: string;
  json?: boolean;
  maxOutputTokens?: number;
}
interface GithubEvent {
  channel: "github";
  action: "list" | "get" | "create" | "close";
  title?: string;
  body?: string;
  labels?: string[];
  number?: number;
}
interface EmailEvent {
  channel: "email";
  to: string;
  subject: string;
  body: string;
  html?: string;
}
type RelayEvent = AiEvent | GithubEvent | EmailEvent;

// Success carries a channel-specific `data`; failure carries an error string.
type RelayResult = { success: true; data: unknown } | { success: false; error: string };

// ── Secrets (SSM, decrypted, cached for the warm container) ────────────────────
const secretCache = new Map<string, string>();

async function getSecret(leaf: string): Promise<string> {
  const name = `${SSM_PREFIX}/${leaf}`;
  const cached = secretCache.get(name);
  if (cached !== undefined) return cached;
  const out = await ssm.send(new GetParameterCommand({ Name: name, WithDecryption: true }));
  const value = out.Parameter?.Value;
  if (value === undefined || value.length === 0) throw new Error(`SSM ${name} is empty`);
  secretCache.set(name, value);
  return value;
}

// ── ai channel (Google Gemini) ─────────────────────────────────────────────────
// The model name is read live (uncached, non-secret String) so it can be swapped
// with `aws ssm put-parameter --overwrite` — no redeploy.
async function getModel(): Promise<string> {
  try {
    const out = await ssm.send(new GetParameterCommand({ Name: `${SSM_PREFIX}/ai-model` }));
    const value = out.Parameter?.Value;
    return value !== undefined && value.length > 0 ? value : DEFAULT_AI_MODEL;
  } catch {
    return DEFAULT_AI_MODEL;
  }
}

async function geminiComplete(apiKey: string, model: string, payload: AiEvent): Promise<string> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  const generationConfig: Record<string, unknown> = {
    max_output_tokens: payload.maxOutputTokens ?? 1024,
  };
  if (payload.json === true) generationConfig["response_mime_type"] = "application/json";

  const body: Record<string, unknown> = {
    contents: [{ role: "user", parts: [{ text: payload.user }] }],
    generation_config: generationConfig,
  };
  if (payload.system !== undefined && payload.system.length > 0) {
    body["system_instruction"] = { parts: [{ text: payload.system }] };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, AI_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "x-goog-api-key": apiKey, "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Gemini API ${String(res.status)}: ${detail}`);
  }
  const data = (await res.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const text = (data.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? "").join("");
  if (text.length === 0) throw new Error("Empty completion from model");
  return text;
}

async function aiChannel(e: AiEvent): Promise<string> {
  const apiKey = await getSecret("ai-api-key");
  const model = await getModel();
  return geminiComplete(apiKey, model, e);
}

// ── github channel (issue ops; declarative registry) ───────────────────────────
function author(u: { login?: string; avatar_url?: string } | undefined): {
  login: string | null;
  avatarUrl: string | null;
} {
  return { login: u?.login ?? null, avatarUrl: u?.avatar_url ?? null };
}

interface IssueOp {
  method: "GET" | "POST" | "PATCH";
  sub: (e: GithubEvent) => string;
  requires?: ReadonlyArray<"title" | "body" | "number">;
  body?: (e: GithubEvent) => unknown;
  // Also GET the comment thread (in parallel) for composite read views.
  withComments?: boolean;
  transform: (data: unknown, e: GithubEvent, comments?: unknown) => unknown;
}

const ISSUE_OPS: Record<GithubEvent["action"], IssueOp> = {
  list: {
    method: "GET",
    sub: () => "?state=open&per_page=50&sort=created&direction=desc",
    transform: (data) => {
      const rows = data as Array<{
        number: number;
        title: string;
        html_url: string;
        created_at: string;
        pull_request?: unknown;
        labels: Array<{ name: string }>;
      }>;
      const issues = rows
        .filter((r) => r.pull_request === undefined)
        .map((r) => ({
          number: r.number,
          title: r.title,
          url: r.html_url,
          createdAt: r.created_at,
          labels: r.labels.map((l) => l.name),
        }));
      return { issues };
    },
  },
  get: {
    method: "GET",
    requires: ["number"],
    sub: (e) => `/${String(e.number)}`,
    withComments: true,
    transform: (data, _e, comments) => {
      const i = data as {
        number: number;
        title: string;
        body: string | null;
        state: string;
        html_url: string;
        created_at: string;
        updated_at: string;
        user?: { login?: string; avatar_url?: string };
        labels: Array<{ name: string }>;
      };
      const rows = (comments ?? []) as Array<{
        id: number;
        body: string;
        created_at: string;
        user?: { login?: string; avatar_url?: string };
      }>;
      return {
        issue: {
          number: i.number,
          title: i.title,
          body: i.body,
          state: i.state,
          url: i.html_url,
          createdAt: i.created_at,
          updatedAt: i.updated_at,
          author: author(i.user),
          labels: i.labels.map((l) => l.name),
        },
        comments: rows.map((c) => ({
          id: c.id,
          body: c.body,
          createdAt: c.created_at,
          author: author(c.user),
        })),
      };
    },
  },
  create: {
    method: "POST",
    requires: ["title", "body"],
    sub: () => "",
    body: (e) => ({ title: e.title, body: e.body, labels: e.labels ?? [] }),
    transform: (data) => {
      const issue = data as { number: number; html_url: string };
      return { number: issue.number, url: issue.html_url };
    },
  },
  close: {
    method: "PATCH",
    requires: ["number"],
    sub: (e) => `/${String(e.number)}`,
    body: () => ({ state: "closed" }),
    transform: (data) => {
      const issue = data as { number: number; state: string };
      return { number: issue.number, state: issue.state };
    },
  },
};

async function githubChannel(e: GithubEvent): Promise<unknown> {
  const op = ISSUE_OPS[e.action];
  for (const field of op.requires ?? []) {
    if (e[field] === undefined) throw new Error(`${field} is required for ${e.action}`);
  }

  const token = await getSecret("github-token");
  const ghHeaders: Record<string, string> = {
    authorization: `Bearer ${token}`,
    accept: "application/vnd.github+json",
    "x-github-api-version": "2022-11-28",
    "user-agent": "lexflow-relay",
    "content-type": "application/json",
  };
  const issuesBase = `https://api.github.com/repos/${GITHUB_REPO}/issues`;
  const init: { method: string; headers: Record<string, string>; body?: string } = {
    method: op.method,
    headers: ghHeaders,
  };
  if (op.body !== undefined) init.body = JSON.stringify(op.body(e));

  const commentsUrl =
    op.withComments === true && e.number !== undefined
      ? `${issuesBase}/${String(e.number)}/comments?per_page=100`
      : null;

  const [res, commentsRes] = await Promise.all([
    fetch(`${issuesBase}${op.sub(e)}`, init),
    commentsUrl !== null ? fetch(commentsUrl, { method: "GET", headers: ghHeaders }) : null,
  ]);

  for (const r of [res, commentsRes]) {
    if (r !== null && !r.ok) {
      const detail = await r.text().catch(() => "");
      console.error(`[relay:github] GitHub ${String(r.status)}: ${detail}`);
      throw new Error(`GitHub API error ${String(r.status)}`);
    }
  }

  const data: unknown = await res.json();
  const comments: unknown = commentsRes !== null ? await commentsRes.json() : undefined;
  return op.transform(data, e, comments);
}

// ── email channel (SMTP, scaffold) ──────────────────────────────────────────────
interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  password: string;
  from: string;
}

let configPromise: Promise<SmtpConfig> | undefined;

async function loadSmtpConfig(): Promise<SmtpConfig> {
  const leaves = [
    "smtp-host",
    "smtp-port",
    "smtp-secure",
    "smtp-user",
    "smtp-password",
    "smtp-from",
  ];
  const res = await ssm.send(
    new GetParametersCommand({
      Names: leaves.map((l) => `${SSM_PREFIX}/${l}`),
      WithDecryption: true,
    }),
  );
  const byLeaf: Record<string, string> = {};
  for (const p of res.Parameters ?? []) {
    if (p.Name !== undefined) byLeaf[p.Name.slice(p.Name.lastIndexOf("/") + 1)] = p.Value ?? "";
  }
  return {
    host: byLeaf["smtp-host"] ?? "",
    port: Number(byLeaf["smtp-port"] ?? "587"),
    secure: byLeaf["smtp-secure"] === "true",
    user: byLeaf["smtp-user"] ?? "",
    password: byLeaf["smtp-password"] ?? "",
    from: byLeaf["smtp-from"] ?? "",
  };
}

// Cache the fetch promise so concurrent invocations share one SSM round-trip.
function getSmtpConfig(): Promise<SmtpConfig> {
  return (configPromise ??= loadSmtpConfig());
}

let transporter: Transporter | undefined;
function getTransport(cfg: SmtpConfig): Transporter {
  // Many shared hosts (e.g. HostGator) use self-signed/mismatched TLS certs.
  transporter ??= nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    auth: { user: cfg.user, pass: cfg.password },
    tls: { rejectUnauthorized: false },
  });
  return transporter;
}

async function emailChannel(e: EmailEvent): Promise<RelayResult> {
  const cfg = await getSmtpConfig();
  await getTransport(cfg).sendMail({
    from: cfg.from,
    to: e.to,
    subject: e.subject,
    text: e.body,
    html: e.html ?? e.body.replace(/\n/g, "<br>"),
  });
  return { success: true, data: { sent: true } };
}

// ── dispatch ────────────────────────────────────────────────────────────────────
async function dispatch(event: RelayEvent): Promise<RelayResult> {
  switch (event.channel) {
    case "ai":
      return { success: true, data: { text: await aiChannel(event) } };
    case "github":
      return { success: true, data: await githubChannel(event) };
    case "email":
      return emailChannel(event);
  }
}

export const handler = async (event: RelayEvent): Promise<RelayResult> => {
  try {
    return await dispatch(event);
  } catch (err) {
    console.error(`[relay:${event.channel}] failed`, err);
    return { success: false, error: String(err) };
  }
};
