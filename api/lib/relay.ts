// api/lib/relay.ts
//
// Client for LexFlow's outbound relay (lexflow-relay). The VPC-bound API Lambda
// has no internet egress and no Lambda interface endpoint, so it can't invoke the
// relay directly. Instead it enqueues a job to the relay outbox S3 bucket (reached
// via the free S3 gateway endpoint, no NAT); an S3 ObjectCreated event triggers the
// relay, which writes the result back to S3. The caller polls getRelayJob().
//
// Per-user isolation: jobs/results are keyed by userId; getRelayJob only ever reads
// the caller's own prefix, so one user can never poll another user's result.

import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";

const REGION = process.env.AWS_REGION ?? "sa-east-1";
// Set by the SAM template to the relay outbox bucket name.
const OUTBOX_BUCKET = process.env.OUTBOX_BUCKET ?? "";

const s3 = new S3Client({ region: REGION });

export type RelayJobStatus =
  | { status: "pending" }
  | { status: "done"; data: unknown }
  | { status: "error"; error: string };

// Enqueue a relay job for `userId`; returns the jobId the client polls with.
export async function enqueueRelayJob(userId: string, payload: object): Promise<string> {
  const jobId = randomUUID();
  try {
    await s3.send(
      new PutObjectCommand({
        Bucket: OUTBOX_BUCKET,
        Key: `jobs/${userId}/${jobId}.json`,
        Body: JSON.stringify(payload),
        ContentType: "application/json",
      }),
    );
  } catch (err) {
    console.error("[relay] enqueue failed", err);
    throw new TRPCError({ code: "BAD_GATEWAY", message: "Falha ao contatar o serviço externo" });
  }
  return jobId;
}

// Poll the result for a job owned by `userId`. A missing result object → pending.
export async function getRelayJob(
  userId: string,
  jobId: string,
  s3Client: S3Client = s3,
): Promise<RelayJobStatus> {
  let text: string;
  try {
    const out = await s3Client.send(
      new GetObjectCommand({ Bucket: OUTBOX_BUCKET, Key: `results/${userId}/${jobId}.json` }),
    );
    if (out.Body === undefined) return { status: "pending" };
    text = await out.Body.transformToString();
  } catch (err) {
    if (isNotFound(err)) return { status: "pending" };
    const label = s3ErrLabel(err);
    console.error("[relay] result read failed", err);
    throw new TRPCError({
      code: "BAD_GATEWAY",
      message: `Falha ao ler o resultado da IA (${label}). Tente gerar novamente.`,
    });
  }
  const parsed = JSON.parse(text) as { success: boolean; data?: unknown; error?: string };
  if (parsed.success) return { status: "done", data: parsed.data ?? null };
  return { status: "error", error: parsed.error ?? "Erro no serviço externo" };
}

function isNotFound(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
  return e.name === "NoSuchKey" || e.$metadata?.httpStatusCode === 404;
}

// Returns a short diagnostic label from an S3 SDK error (no `any`, no `!`).
// Prefers a meaningful `.name` (not the JS default "Error") then falls back to
// the HTTP status from `$metadata`, then "unknown".
function s3ErrLabel(err: unknown): string {
  if (typeof err !== "object" || err === null) return "unknown";
  const e = err as { name?: unknown; $metadata?: { httpStatusCode?: unknown } };
  const status = e.$metadata?.httpStatusCode;
  if (typeof status === "number") return `HTTP ${String(status)}`;
  if (typeof e.name === "string" && e.name.length > 0 && e.name !== "Error") return e.name;
  return "unknown";
}
