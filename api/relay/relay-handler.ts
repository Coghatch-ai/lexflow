// api/relay/relay-handler.ts
//
// Per-project outbound "relay" Lambda — the non-VPC sender for services the
// VPC-bound API Lambda can't reach (no NAT, no Lambda interface endpoint). It is
// S3-triggered: the API enqueues a job to the relay outbox bucket
// (jobs/{userId}/{jobId}.json) via the free S3 gateway endpoint; this handler runs
// on the ObjectCreated event, processes the channel, writes the result to
// results/{userId}/{jobId}.json, and deletes the job. Channels:
//
//   ai    → Google Gemini completion (API resolves the prompt; relay forwards)
//   email → SMTP via nodemailer (scaffold; live once /smtp-* SSM params exist)
//
// GitHub issues moved back to the central mrhewbuc-issues service (browser-direct),
// so there is no github channel here anymore.
//
// Trust boundary: triggered only by objects the API wrote to the private outbox
// bucket (the API already verified the Clerk JWT + role). No Function URL / API
// event → unreachable from a browser. Secrets (Gemini key, SMTP creds) are read
// from SSM under SSM_PREFIX at runtime, KMS-decrypted, and cached for the life of
// the warm container — never placed in the function's environment configuration.

import nodemailer, { type Transporter } from "nodemailer";
import { SSMClient, GetParameterCommand, GetParametersCommand } from "@aws-sdk/client-ssm";
import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import type { S3Event } from "aws-lambda";

const REGION = process.env.AWS_REGION ?? "sa-east-1";
// Set by the SAM template to /lexflow/relay/${Environment}.
const SSM_PREFIX = process.env.SSM_PREFIX ?? "/lexflow/relay/prod";

const DEFAULT_AI_MODEL = "gemini-2.0-flash";
// Bound the upstream LLM call below the Lambda timeout so a hung provider returns
// a clean error rather than an opaque Lambda timeout.
const AI_TIMEOUT_MS = 25_000;

const ssm = new SSMClient({ region: REGION });
const s3 = new S3Client({ region: REGION });

// ── Channel-tagged event (the job payload written by api/lib/relay.ts) ──────────
interface AiEvent {
  channel: "ai";
  // RESOLVED prompt: the API already interpolated the template. The relay never
  // sees promptId/variables — it just forwards system+user to the model.
  system?: string;
  user: string;
  json?: boolean;
  maxOutputTokens?: number;
}
interface EmailEvent {
  channel: "email";
  to: string;
  subject: string;
  body: string;
  html?: string;
}
type RelayEvent = AiEvent | EmailEvent;

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
    case "email":
      return emailChannel(event);
  }
}

// S3-triggered (ObjectCreated on the `jobs/` prefix): for each job object, read it,
// run the channel, write the result under the matching `results/` key, delete the
// job. Result writes land under `results/` (not `jobs/`) so they never re-trigger.
export const handler = async (event: S3Event): Promise<void> => {
  for (const record of event.Records) {
    const bucket = record.s3.bucket.name;
    const jobKey = decodeURIComponent(record.s3.object.key.replace(/\+/g, " "));
    const resultKey = jobKey.replace(/^jobs\//, "results/");
    let result: RelayResult;
    try {
      const obj = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: jobKey }));
      if (obj.Body === undefined) throw new Error("empty job object");
      const payload = JSON.parse(await obj.Body.transformToString()) as RelayEvent;
      result = await dispatch(payload);
    } catch (err) {
      console.error("[relay] job failed", { jobKey, err });
      result = { success: false, error: String(err) };
    }
    try {
      await s3.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: resultKey,
          Body: JSON.stringify(result),
          ContentType: "application/json",
        }),
      );
      await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: jobKey }));
    } catch (err) {
      console.error("[relay] result write failed", { resultKey, err });
    }
  }
};
