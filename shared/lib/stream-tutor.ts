// shared/lib/stream-tutor.ts
//
// Client for the browser-direct streaming Lambda. Reads the plain-text token
// stream, invoking onDelta per chunk; an "ERRO:" prefix line marks a handled
// server-side failure. The caller still runs tutorFinalize afterwards — the
// streamed text is display-only; the persisted text is server-read from S3.

export async function streamTutorAnswer(
  streamUrl: string,
  jobId: string,
  token: string,
  onDelta: (text: string) => void,
): Promise<void> {
  const res = await fetch(streamUrl, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ jobId }),
  });
  if (!res.ok || res.body === null) {
    throw new Error("Falha ao conectar ao streaming");
  }
  // Chunks are raw bytes; typed any by Node's fetch types in the api program.
  const reader = res.body.getReader() as ReadableStreamDefaultReader<Uint8Array>;
  const decoder = new TextDecoder();
  let full = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = decoder.decode(value, { stream: true });
    full += chunk;
    onDelta(chunk);
  }
  if (full.startsWith("ERRO:") || full.includes("\nERRO:")) {
    throw new Error("O tutor falhou ao responder. Tente novamente.");
  }
  if (full.length === 0) {
    throw new Error("Resposta vazia do streaming");
  }
}
