// shared/domain/issue-notification.test.ts

import { describe, it, expect } from "vitest";
import { buildIssueClosedEmail } from "./issue-notification";

describe("buildIssueClosedEmail", () => {
  const base = {
    issueNumber: 42,
    title: "Botão de login não funciona",
    requesterEmail: "user@example.com",
  };

  it("subject contains issue number", () => {
    const { subject } = buildIssueClosedEmail(base);
    expect(subject).toContain("#42");
  });

  it("subject is pt-BR", () => {
    const { subject } = buildIssueClosedEmail(base);
    expect(subject).toContain("resolvida");
  });

  it("body contains issue number", () => {
    const { body } = buildIssueClosedEmail(base);
    expect(body).toContain("#42");
  });

  it("body contains the issue title", () => {
    const { body } = buildIssueClosedEmail(base);
    expect(body).toContain("Botão de login não funciona");
  });

  it("body contains the requester email", () => {
    const { body } = buildIssueClosedEmail(base);
    expect(body).toContain("user@example.com");
  });

  it("body contains the prod URL", () => {
    const { body } = buildIssueClosedEmail(base);
    expect(body).toContain("https://my.probius.app");
  });

  it("different issue numbers produce distinct subjects", () => {
    const a = buildIssueClosedEmail({ ...base, issueNumber: 1 });
    const b = buildIssueClosedEmail({ ...base, issueNumber: 99 });
    expect(a.subject).not.toBe(b.subject);
    expect(a.subject).toContain("#1");
    expect(b.subject).toContain("#99");
  });

  it("returns a non-empty subject and body", () => {
    const { subject, body } = buildIssueClosedEmail(base);
    expect(subject.length).toBeGreaterThan(0);
    expect(body.length).toBeGreaterThan(0);
  });
});
