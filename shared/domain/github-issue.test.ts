// shared/domain/github-issue.test.ts
//
// Unit tests for appendRequester — the pure body-composition helper.

import { describe, it, expect } from "vitest";
import { appendRequester, parseRequester } from "./github-issue";

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

describe("parseRequester", () => {
  it("round-trips the email appended by appendRequester", () => {
    const body = appendRequester("Body with steps", "user@example.com");
    expect(parseRequester(body)).toBe("user@example.com");
  });

  it("reads the fallback marker", () => {
    expect(parseRequester(appendRequester("x", ""))).toBe("desconhecido");
  });

  it("returns null when the footer is absent", () => {
    expect(parseRequester("Body created outside the app form")).toBeNull();
  });

  it("ignores an earlier --- divider in the body", () => {
    const body = "Intro\n\n---\nMid section\n\n---\nSolicitante: real@x.com";
    expect(parseRequester(body)).toBe("real@x.com");
  });
});
