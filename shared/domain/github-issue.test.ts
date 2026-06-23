// shared/domain/github-issue.test.ts
//
// Unit tests for appendRequester — the pure body-composition helper.

import { describe, it, expect } from "vitest";
import { appendRequester } from "./github-issue";

describe("appendRequester", () => {
  it("appends the email when present", () => {
    const result = appendRequester("Issue body here", "user@example.com");
    expect(result).toBe("Issue body here\n\n---\nSolicitante: user@example.com");
  });

  it("falls back to 'desconhecido' when email is empty string", () => {
    const result = appendRequester("Issue body here", "");
    expect(result).toBe("Issue body here\n\n---\nSolicitante: desconhecido");
  });

  it("preserves the original body verbatim", () => {
    const body = "## Title\n\nSteps:\n1. Do this\n2. Then that";
    const result = appendRequester(body, "dev@lexflow.io");
    expect(result.startsWith(body)).toBe(true);
    expect(result).toContain("\n\n---\nSolicitante: dev@lexflow.io");
  });
});
