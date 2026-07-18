// shared/lib/relay-poll.ts
//
// Polls an async relay job until the relay has written its result to S3.
// Framework-agnostic (no React, no browser globals beyond setTimeout).
// Importable by both app/ and apps/mobile/ (repo shared/ boundary).

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
    await new Promise<void>((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error("Tempo esgotado aguardando o resultado da IA");
}
