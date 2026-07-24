// api/lib/stream-ticket.ts
//
// Writes a stream ticket for the browser-direct streaming Lambda. Same outbox
// bucket as the relay, different prefix: tickets/ has NO S3 event wired, so the
// relay never double-processes a streamed job. The ticket carries the resolved
// prompt (server-owned assembly stays in the API), the internal userId (for the
// results/ key), and the Clerk sub (the streaming Lambda's auth check).

import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import type { AiRelayPayload } from "./ai-prompts";

const REGION = process.env.AWS_REGION ?? "sa-east-1";
const OUTBOX_BUCKET = process.env.OUTBOX_BUCKET ?? "";

const s3 = new S3Client({ region: REGION });

export async function enqueueStreamTicket(
  userId: string,
  sub: string,
  payload: AiRelayPayload,
  preMintedJobId?: string,
): Promise<string> {
  const jobId = preMintedJobId ?? randomUUID();
  try {
    await s3.send(
      new PutObjectCommand({
        Bucket: OUTBOX_BUCKET,
        Key: `tickets/${jobId}.json`,
        Body: JSON.stringify({ sub, userId, payload }),
        ContentType: "application/json",
      }),
    );
  } catch (err) {
    console.error("[stream-ticket] enqueue failed", err);
    throw new TRPCError({ code: "BAD_GATEWAY", message: "Falha ao preparar o streaming" });
  }
  return jobId;
}
