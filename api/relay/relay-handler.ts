// api/relay/relay-handler.ts
//
// Per-project outbound "relay" Lambda — the non-VPC sender for services the
// VPC-bound API Lambda can't reach (no NAT, no Lambda interface endpoint). It is
// S3-triggered: the API enqueues a job to the relay outbox bucket
// (jobs/{userId}/{jobId}.json) via the free S3 gateway endpoint; this handler runs
// on the ObjectCreated event, processes the channel, writes the result to
// results/{userId}/{jobId}.json, and deletes the job. Channels:
//
//   ai    → AI completion (Gemini default; OpenAI selectable per-event)
//   email → SMTP via nodemailer (scaffold; live once /smtp-* SSM params exist)
//
// GitHub issues moved back to the central mrhewbuc-issues service (browser-direct),
// so there is no github channel here anymore.
//
// Trust boundary: triggered only by objects the API wrote to the private outbox
// bucket (the API already verified the Clerk JWT + role). No Function URL / API
// event → unreachable from a browser. Secrets are read from SSM under SSM_PREFIX
// at runtime, KMS-decrypted, and cached for the life of the warm container —
// never placed in the function's environment configuration.

import nodemailer, { type Transporter } from "nodemailer";
import { SSMClient, GetParameterCommand, GetParametersCommand } from "@aws-sdk/client-ssm";
import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import type { S3Event } from "aws-lambda";
import { geminiComplete, openaiComplete } from "./providers";

const REGION = process.env.AWS_REGION ?? "sa-east-1";
// Set by the SAM template to /lexflow/relay/${Environment}.
const SSM_PREFIX = process.env.SSM_PREFIX ?? "/lexflow/relay/prod";

const DEFAULT_AI_PROVIDER = "gemini";
const DEFAULT_GEMINI_MODEL = "gemini-2.0-flash";
const DEFAULT_OPENAI_MODEL = "gpt-4o-mini";

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
  // Optional provider/model selection. Absent → SSM default (gemini).
  provider?: "gemini" | "openai";
  model?: string;
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

// ── ai channel ─────────────────────────────────────────────────────────────────
// Provider and model are read live (uncached, non-secret String) so they can be
// swapped with `aws ssm put-parameter --overwrite` — no redeploy required.

async function getProvider(): Promise<string> {
  try {
    const out = await ssm.send(new GetParameterCommand({ Name: `${SSM_PREFIX}/ai-provider` }));
    const value = out.Parameter?.Value;
    return value !== undefined && value.length > 0 ? value : DEFAULT_AI_PROVIDER;
  } catch {
    return DEFAULT_AI_PROVIDER;
  }
}

async function getModel(provider: string): Promise<string> {
  const defaultModel = provider === "openai" ? DEFAULT_OPENAI_MODEL : DEFAULT_GEMINI_MODEL;
  const leaf = provider === "openai" ? "openai-model" : "ai-model";
  try {
    const out = await ssm.send(new GetParameterCommand({ Name: `${SSM_PREFIX}/${leaf}` }));
    const value = out.Parameter?.Value;
    return value !== undefined && value.length > 0 ? value : defaultModel;
  } catch {
    return defaultModel;
  }
}

// Secret leaf per provider. Missing openai-api-key only breaks OpenAI calls —
// the deploy does not fail (no template.yaml SSM resolution for this key).
function secretLeaf(provider: string): string {
  return provider === "openai" ? "openai-api-key" : "ai-api-key";
}

async function aiChannel(e: AiEvent): Promise<string> {
  const provider = e.provider ?? (await getProvider());
  const model = e.model ?? (await getModel(provider));
  const apiKey = await getSecret(secretLeaf(provider));

  const payload = {
    ...(e.system !== undefined ? { system: e.system } : {}),
    user: e.user,
    ...(e.json !== undefined ? { json: e.json } : {}),
    ...(e.maxOutputTokens !== undefined ? { maxOutputTokens: e.maxOutputTokens } : {}),
  };

  if (provider === "openai") {
    return openaiComplete(apiKey, model, payload);
  }
  return geminiComplete(apiKey, model, payload);
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
