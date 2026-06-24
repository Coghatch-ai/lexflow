// api/lib/relay.ts
//
// Thin client for LexFlow's own outbound relay Lambda (lexflow-relay-${env}).
// The API Lambda is VPC-bound with no NAT, so it cannot reach Gemini / GitHub /
// SMTP directly — it invokes the non-VPC relay over IAM (via the Lambda VPC
// interface endpoint). Replaces the browser → mrhewbuc-issues Function URL path.
//
//   invokeRelay      — synchronous (RequestResponse): ai + github channels need
//                      the result back. Relay errors surface as TRPCError.
//   invokeRelayAsync — fire-and-forget (Event): the email channel; never fails
//                      or blocks the parent request (logs only).

import {
  LambdaClient,
  InvokeCommand,
  InvocationType,
  type InvokeCommandOutput,
} from "@aws-sdk/client-lambda";
import { TRPCError } from "@trpc/server";

const REGION = process.env.AWS_REGION ?? "sa-east-1";
const RELAY_FN = `lexflow-relay-${process.env.ENVIRONMENT ?? "prod"}`;

const lambda = new LambdaClient({ region: REGION });

type RelayResult = { success: true; data: unknown } | { success: false; error: string };

function gateway(message: string): TRPCError {
  return new TRPCError({ code: "BAD_GATEWAY", message });
}

export async function invokeRelay<T>(payload: object): Promise<T> {
  let out: InvokeCommandOutput;
  try {
    out = await lambda.send(
      new InvokeCommand({
        FunctionName: RELAY_FN,
        InvocationType: InvocationType.RequestResponse,
        Payload: Buffer.from(JSON.stringify(payload)),
      }),
    );
  } catch (err) {
    console.error("[relay] invoke failed", err);
    throw gateway("Falha ao contatar o serviço externo");
  }

  if (out.FunctionError !== undefined) {
    console.error("[relay] function error", out.FunctionError);
    throw gateway("Falha no serviço externo");
  }
  if (out.Payload === undefined) {
    throw gateway("Resposta vazia do serviço externo");
  }

  const parsed = JSON.parse(Buffer.from(out.Payload).toString("utf8")) as RelayResult;
  if (!parsed.success) {
    console.error("[relay] channel error", parsed.error);
    throw gateway("Erro no serviço externo");
  }
  return parsed.data as T;
}

export async function invokeRelayAsync(payload: object): Promise<void> {
  try {
    await lambda.send(
      new InvokeCommand({
        FunctionName: RELAY_FN,
        InvocationType: InvocationType.Event,
        Payload: Buffer.from(JSON.stringify(payload)),
      }),
    );
  } catch (err) {
    console.error("[relay] async invoke failed", err);
  }
}
