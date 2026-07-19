// api/lib/relay.test.ts
//
// Unit tests for getRelayJob — injected S3 client stub keeps no AWS calls.

import { describe, expect, it, vi } from "vitest";
import { TRPCError } from "@trpc/server";
import type { S3Client } from "@aws-sdk/client-s3";
import { getRelayJob } from "./relay";

// Minimal S3Client stub: `send` is replaced per-test via vi.fn().
function makeS3Stub(sendImpl: (cmd: unknown) => Promise<unknown>) {
  return { send: vi.fn(sendImpl) } as unknown as S3Client;
}

function bodyFrom(obj: unknown) {
  const text = JSON.stringify(obj);
  return { transformToString: async () => text };
}

describe("getRelayJob", () => {
  it("returns pending on NoSuchKey", async () => {
    const err = Object.assign(new Error("no key"), { name: "NoSuchKey" });
    const s3 = makeS3Stub(() => Promise.reject(err));
    await expect(getRelayJob("u1", "j1", s3)).resolves.toEqual({ status: "pending" });
  });

  it("returns pending on HTTP 404", async () => {
    const err = Object.assign(new Error("not found"), { $metadata: { httpStatusCode: 404 } });
    const s3 = makeS3Stub(() => Promise.reject(err));
    await expect(getRelayJob("u1", "j1", s3)).resolves.toEqual({ status: "pending" });
  });

  it("throws BAD_GATEWAY with error label on non-404 S3 error", async () => {
    const err = Object.assign(new Error("denied"), { name: "AccessDenied" });
    const s3 = makeS3Stub(() => Promise.reject(err));
    const promise = getRelayJob("u1", "j1", s3);
    await expect(promise).rejects.toBeInstanceOf(TRPCError);
    await expect(promise).rejects.toMatchObject({
      code: "BAD_GATEWAY",
      message: expect.stringContaining("AccessDenied") as string,
    });
  });

  it("throws BAD_GATEWAY with HTTP status label on non-404 numeric error", async () => {
    const err = Object.assign(new Error("server error"), { $metadata: { httpStatusCode: 503 } });
    const s3 = makeS3Stub(() => Promise.reject(err));
    const promise = getRelayJob("u1", "j1", s3);
    await expect(promise).rejects.toMatchObject({
      code: "BAD_GATEWAY",
      message: expect.stringContaining("HTTP 503") as string,
    });
  });

  it("returns done on success:true result", async () => {
    const s3 = makeS3Stub(() =>
      Promise.resolve({ Body: bodyFrom({ success: true, data: { text: "ok" } }) }),
    );
    await expect(getRelayJob("u1", "j1", s3)).resolves.toEqual({
      status: "done",
      data: { text: "ok" },
    });
  });

  it("returns error on success:false result", async () => {
    const s3 = makeS3Stub(() =>
      Promise.resolve({ Body: bodyFrom({ success: false, error: "provider failed" }) }),
    );
    await expect(getRelayJob("u1", "j1", s3)).resolves.toEqual({
      status: "error",
      error: "provider failed",
    });
  });

  it("returns pending when Body is undefined", async () => {
    const s3 = makeS3Stub(() => Promise.resolve({ Body: undefined }));
    await expect(getRelayJob("u1", "j1", s3)).resolves.toEqual({ status: "pending" });
  });
});
