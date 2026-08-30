// api/stream/stream-handler.ts
//
// Browser-direct STREAMING Lambda (non-VPC, Function URL with RESPONSE_STREAM).
// Two-step flow keeps the trust boundary intact:
//   1. tRPC (VPC API) assembles the server-owned prompt, debits credits, and
//      writes a ticket to tickets/{jobId}.json (sub + userId + resolved payload).
//   2. Browser POSTs {jobId} here with its Clerk Bearer token; this handler
//      verifies the JWT offline (CLERK_JWT_KEY), checks sub === ticket.sub,
//      streams the LLM tokens back as plain text, then writes the full text to
//      results/{userId}/{jobId}.json — the SAME key the relay would write — so
//      the existing finalize procedures persist it server-side unchanged.
//
// No RDS access here (non-VPC): prompts, credits, and persistence all stay in
// the API Lambda. On upstream failure an error marker is written to results/
// so the credit refund rail (relay.job poll) still fires.

import { clerkAuthProvider } from "../lib/auth-provider/clerk";
import { SSMClient, GetParameterCommand } from "@aws-sdk/client-ssm";
import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import type { APIGatewayProxyEventV2 } from "aws-lambda";
import type { AiPayload } from "../relay/providers";
import type { Usage } from "../../shared/domain/cost-of-goods";
import { streamGemini, streamOpenai } from "./stream-providers";

const REGION = process.env.AWS_REGION ?? "sa-east-1";
const SSM_PREFIX = process.env.SSM_PREFIX ?? "/lexflow/relay/prod";
const OUTBOX_BUCKET = process.env.OUTBOX_BUCKET ?? "";

const DEFAULT_AI_PROVIDER = "gemini";
// Mirrors api/relay/relay-handler.ts — gemini-2.0-flash was shut down
// 2026-06-01; gemini-3.6-flash is its official replacement and the id with a
// cost-of-goods rate row (#98). Change both handlers or the paths diverge.
const DEFAULT_GEMINI_MODEL = "gemini-3.6-flash";
// Mirrors api/relay/relay-handler.ts (#98, human decision 2026-08-30): the
// OpenAI default is gpt-5.6-luna, which has a verified rate row. SSM
// /openai-model still overrides it at runtime.
const DEFAULT_OPENAI_MODEL = "gpt-5.6-luna";

const ssm = new SSMClient({ region: REGION });
const s3 = new S3Client({ region: REGION });

// Minimal surface of the Lambda response stream (write/end like a Writable).
interface ResponseStream {
  write(chunk: string): void;
  end(): void;
}

// Provided by the nodejs Lambda runtime when response streaming is enabled.
declare const awslambda: {
  streamifyResponse: (
    fn: (event: APIGatewayProxyEventV2, stream: ResponseStream) => Promise<void>,
  ) => unknown;
};

interface StreamTicket {
  sub: string;
  userId: string;
  payload: AiPayload & { provider?: "gemini" | "openai"; model?: string };
}

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

// Provider/model read live (uncached) — swappable via SSM without redeploy,
// mirroring relay-handler.ts.
async function getParamOr(leaf: string, fallback: string): Promise<string> {
  try {
    const out = await ssm.send(new GetParameterCommand({ Name: `${SSM_PREFIX}/${leaf}` }));
    const value = out.Parameter?.Value;
    return value !== undefined && value.length > 0 ? value : fallback;
  } catch {
    return fallback;
  }
}

async function readTicket(jobId: string): Promise<StreamTicket | null> {
  try {
    const obj = await s3.send(
      new GetObjectCommand({ Bucket: OUTBOX_BUCKET, Key: `tickets/${jobId}.json` }),
    );
    if (obj.Body === undefined) return null;
    return JSON.parse(await obj.Body.transformToString()) as StreamTicket;
  } catch {
    return null;
  }
}

// The success payload is byte-identical in shape to the relay's (#98): the
// door's parseAiResult reads ONE format regardless of which sender produced it.
async function writeResult(
  userId: string,
  jobId: string,
  result:
    | { success: true; data: { text: string; model: string; usage: Usage | null } }
    | { success: false; error: string },
): Promise<void> {
  await s3.send(
    new PutObjectCommand({
      Bucket: OUTBOX_BUCKET,
      Key: `results/${userId}/${jobId}.json`,
      Body: JSON.stringify(result),
      ContentType: "application/json",
    }),
  );
}

async function verifySub(event: APIGatewayProxyEventV2): Promise<string | null> {
  const auth = event.headers["authorization"] ?? event.headers["Authorization"];
  if (auth?.startsWith("Bearer ") !== true) return null;
  try {
    const verified = await clerkAuthProvider.verifyToken(auth.slice(7));
    return verified.sub;
  } catch {
    return null;
  }
}

const JOB_ID_RE = /^[0-9a-f-]{36}$/;

async function handle(event: APIGatewayProxyEventV2, stream: ResponseStream): Promise<void> {
  let jobId = "";
  try {
    const body = JSON.parse(event.body ?? "{}") as { jobId?: string };
    jobId = body.jobId ?? "";
  } catch {
    jobId = "";
  }
  if (!JOB_ID_RE.test(jobId)) {
    stream.write("ERRO: requisição inválida");
    stream.end();
    return;
  }

  const sub = await verifySub(event);
  if (sub === null) {
    stream.write("ERRO: não autorizado");
    stream.end();
    return;
  }

  const ticket = await readTicket(jobId);
  if (ticket?.sub !== sub) {
    stream.write("ERRO: não autorizado");
    stream.end();
    return;
  }

  const provider =
    ticket.payload.provider ?? (await getParamOr("ai-provider", DEFAULT_AI_PROVIDER));
  const model =
    ticket.payload.model ??
    (provider === "openai"
      ? await getParamOr("openai-model", DEFAULT_OPENAI_MODEL)
      : await getParamOr("ai-model", DEFAULT_GEMINI_MODEL));
  const apiKey = await getSecret(provider === "openai" ? "openai-api-key" : "ai-api-key");

  try {
    const onDelta = (text: string): void => {
      stream.write(text);
    };
    const full =
      provider === "openai"
        ? await streamOpenai(apiKey, model, ticket.payload, onDelta)
        : await streamGemini(apiKey, model, ticket.payload, onDelta);
    await writeResult(ticket.userId, jobId, {
      success: true,
      data: { text: full.text, model: full.model, usage: full.usage },
    });
  } catch (err) {
    console.error("[stream] upstream failed", { jobId, err });
    // Error marker keeps the finalize/refund rails working (relay.job → refund).
    await writeResult(ticket.userId, jobId, { success: false, error: String(err) }).catch(() => {
      /* best effort */
    });
    stream.write("\nERRO: falha ao gerar a resposta");
  } finally {
    await s3
      .send(new DeleteObjectCommand({ Bucket: OUTBOX_BUCKET, Key: `tickets/${jobId}.json` }))
      .catch(() => {
        /* lifecycle will clear it */
      });
    stream.end();
  }
}

export const handler = awslambda.streamifyResponse(handle);
