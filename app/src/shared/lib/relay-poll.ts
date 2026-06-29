// app/src/shared/lib/relay-poll.ts
//
// Polls an async relay job (api/lib/relay.ts) until the relay has written its
// result. The API enqueues the job and runs the channel (e.g. Gemini) out-of-band,
// dropping the result in S3; this loops every ~2s until done/error or the timeout.

export interface RelayJobStatus {
  status: "pending" | "done" | "error";
  data?: unknown;
  error?: string;
}

export async function pollRelayJob(
  fetchStatus: () => Promise<RelayJobStatus>,
  opts: { intervalMs?: number; timeoutMs?: number } = {},
): Promise<unknown> {
  const intervalMs = opts.intervalMs ?? 2000;
  const timeoutMs = opts.timeoutMs ?? 60000;
  const tries = Math.max(1, Math.ceil(timeoutMs / intervalMs));
  for (let i = 0; i < tries; i++) {
    const s = await fetchStatus();
    if (s.status === "done") return s.data;
    if (s.status === "error") throw new Error(s.error ?? "Erro no serviço externo");
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error("Tempo esgotado aguardando o resultado da IA");
}
