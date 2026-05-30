// api/trpc/log-error.ts
//
// tRPC onError hook. Surfaces the underlying pg / runtime error to CloudWatch
// and dev-server stdout (without it, drizzle errors reach the client as a
// generic message with the real cause stripped). Expected user-facing 4xx
// errors are not logged so the channel stays useful.

import type { TRPCError } from "@trpc/server";
import { DrizzleQueryError } from "drizzle-orm/errors";

type LogArgs = {
  error: TRPCError;
  type: "query" | "mutation" | "subscription" | "unknown";
  path: string | undefined;
};

const SILENT_CODES = new Set<TRPCError["code"]>([
  "BAD_REQUEST",
  "UNAUTHORIZED",
  "FORBIDDEN",
  "NOT_FOUND",
  "CONFLICT",
  "PRECONDITION_FAILED",
  "UNPROCESSABLE_CONTENT",
  "TOO_MANY_REQUESTS",
]);

export function logTrpcError({ error, type, path }: LogArgs): void {
  if (SILENT_CODES.has(error.code)) return;

  const cause = error.cause;
  const dbCause =
    cause instanceof DrizzleQueryError && cause.cause instanceof Error ? cause.cause : undefined;

  const lines = [`[trpc] ${type} ${path ?? "<unknown>"} ${error.code}: ${error.message}`];
  if (cause instanceof Error) {
    lines.push(`  cause: ${cause.message}`);
  }
  if (dbCause) {
    lines.push(`  db cause: ${dbCause.message}`);
  }

  console.error(lines.join("\n"), cause ?? error);
}
