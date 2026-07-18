// shared/lib/relay-poll.test.ts
import { describe, it, expect, vi } from "vitest";
import { pollRelayJob, type RelayJobStatus } from "./relay-poll";

describe("pollRelayJob", () => {
  it("returns data immediately on done", async () => {
    const fetch = vi.fn().mockResolvedValue({
      status: "done",
      data: { text: "ok" },
    } satisfies RelayJobStatus);
    const result = await pollRelayJob(fetch as () => Promise<RelayJobStatus>, {
      intervalMs: 1,
      timeoutMs: 100,
    });
    expect(result).toEqual({ text: "ok" });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("polls until done", async () => {
    let calls = 0;
    const fetch = vi.fn().mockImplementation(async () => {
      calls++;
      const s: RelayJobStatus =
        calls < 3 ? { status: "pending" } : { status: "done", data: "result" };
      return s;
    });
    const result = await pollRelayJob(fetch as () => Promise<RelayJobStatus>, {
      intervalMs: 1,
      timeoutMs: 1000,
    });
    expect(result).toBe("result");
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("throws on error status", async () => {
    const fetch = vi.fn().mockResolvedValue({
      status: "error",
      error: "relay boom",
    } satisfies RelayJobStatus);
    await expect(
      pollRelayJob(fetch as () => Promise<RelayJobStatus>, { intervalMs: 1, timeoutMs: 100 }),
    ).rejects.toThrow("relay boom");
  });

  it("throws timeout when never done", async () => {
    const fetch = vi.fn().mockResolvedValue({ status: "pending" } satisfies RelayJobStatus);
    await expect(
      pollRelayJob(fetch as () => Promise<RelayJobStatus>, { intervalMs: 1, timeoutMs: 5 }),
    ).rejects.toThrow("Tempo esgotado");
  });
});
