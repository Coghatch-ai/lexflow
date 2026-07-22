// apps/mobile/src/components/AiTutorPanel.tsx
//
// Per-question AI tutor ("buddy") panel — rendered in the answered state of the
// question flow, below the comentário + AI explanation. Fixed-mode chips plus
// one bounded free-text follow-up; each exchange is a one-shot relay job
// (runTutorFlow), displayed as a thread persisted server-side (ai.tutorHistory).
// Cannot import from app/src/**.

import { useState, type ReactElement } from "react";
import { Sparkles } from "lucide-react";
import { TUTOR_FOLLOW_UP_MAX_CHARS, type TutorMode } from "@shared/domain/ai-tutor";
import { runTutorFlow } from "@shared/lib/run-tutor-flow";
import { streamTutorAnswer } from "@shared/lib/stream-tutor";
import { getAuthToken, trpc } from "../lib/trpc";

// When set (the streaming Lambda's Function URL), tutor replies stream
// token-by-token; otherwise the S3-relay polling path is used.
const STREAM_URL: string = import.meta.env.VITE_AI_STREAM_URL ?? "";

interface AiTutorPanelProps {
  questionId: string;
  /** Option text the student selected; null when unknown. */
  userAnswer: string | null;
  /** Whether the student got this question wrong (controls the "Por que errei?" chip). */
  wasWrong: boolean;
}

type LocalMessage = { role: "user" | "assistant"; content: string };

const MODE_CHIPS: { mode: TutorMode; label: string; wrongOnly: boolean }[] = [
  { mode: "why_my_answer_wrong", label: "Por que errei?", wrongOnly: true },
  { mode: "explain_differently", label: "Explicar de outro jeito", wrongOnly: false },
  { mode: "give_example", label: "Dar um exemplo", wrongOnly: false },
];

const MODE_LABEL: Partial<Record<string, string>> = Object.fromEntries(
  MODE_CHIPS.map((c) => [c.mode, c.label]),
);

export function AiTutorPanel({
  questionId,
  userAnswer,
  wasWrong,
}: AiTutorPanelProps): ReactElement {
  const [local, setLocal] = useState<LocalMessage[]>([]);
  const [followUp, setFollowUp] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const utils = trpc.useUtils();
  const historyQ = trpc.ai.tutorHistory.useQuery({ questionId });
  const askMut = trpc.ai.tutorAsk.useMutation();
  const finalizeMut = trpc.ai.tutorFinalize.useMutation();

  // Server thread (survives navigation) + turns from this session not yet refetched.
  const messages: LocalMessage[] = [
    ...(historyQ.data ?? []).map((m) => {
      const label = m.mode === null ? undefined : MODE_LABEL[m.mode];
      return {
        role: m.role === "assistant" ? ("assistant" as const) : ("user" as const),
        content: label ?? m.content,
      };
    }),
    ...local,
  ];

  // Streamed path: ask (writes ticket) → stream tokens into a growing bubble →
  // finalize (server persists the canonical text from S3).
  async function sendStreaming(mode: TutorMode, text?: string): Promise<string> {
    const { jobId } = await askMut.mutateAsync({
      questionId,
      mode,
      userAnswer,
      stream: true,
      ...(mode === "free_text" && text !== undefined ? { followUp: text } : {}),
    });
    const token = await getAuthToken();
    if (token === null) throw new Error("Sessão expirada — entre novamente");
    let acc = "";
    setLocal((prev) => [...prev, { role: "assistant", content: "" }]);
    await streamTutorAnswer(STREAM_URL, jobId, token, (delta) => {
      acc += delta;
      setLocal((prev) => {
        const copy = [...prev];
        copy[copy.length - 1] = { role: "assistant", content: acc };
        return copy;
      });
    });
    const { answer } = await finalizeMut.mutateAsync({ questionId, jobId });
    return answer;
  }

  async function sendPolling(mode: TutorMode, text?: string): Promise<string> {
    return runTutorFlow(
      {
        questionId,
        mode,
        userAnswer,
        ...(mode === "free_text" && text !== undefined ? { followUp: text } : {}),
      },
      {
        ask: (input) => askMut.mutateAsync(input),
        fetchRelayJob: (jobId) => utils.relay.job.fetch({ jobId }, { staleTime: 0 }),
        finalize: (input) => finalizeMut.mutateAsync(input),
      },
    );
  }

  async function send(mode: TutorMode, text?: string): Promise<void> {
    setLoading(true);
    setError(null);
    const shown = mode === "free_text" ? (text ?? "") : (MODE_LABEL[mode] ?? "");
    const before = local.length;
    setLocal((prev) => [...prev, { role: "user", content: shown }]);
    try {
      const answer =
        STREAM_URL.length > 0 ? await sendStreaming(mode, text) : await sendPolling(mode, text);
      setLocal((prev) => {
        // Replace everything this exchange appended with the canonical pair.
        const base = prev.slice(0, before);
        return [...base, { role: "user", content: shown }, { role: "assistant", content: answer }];
      });
    } catch (err) {
      // Roll back the optimistic turns so the thread matches the server.
      setLocal((prev) => prev.slice(0, before));
      setError(err instanceof Error ? err.message : "Falha ao falar com o tutor");
    } finally {
      setLoading(false);
      void utils.ai.tutorHistory.invalidate({ questionId });
    }
  }

  function sendFreeText(): void {
    const text = followUp.trim();
    if (text.length === 0 || loading) return;
    setFollowUp("");
    void send("free_text", text);
  }

  return (
    <div className="mt-3 border-t border-line pt-3">
      <p className="eyebrow mb-2 flex items-center gap-1">
        <Sparkles className="h-3.5 w-3.5" /> Tutor
      </p>

      {messages.length > 0 ? (
        <div className="mb-2.5 space-y-2">
          {messages.map((m, i) => (
            <div
              key={i}
              className={
                m.role === "user"
                  ? "ml-8 rounded-xl bg-paper-sink px-3 py-2 text-xs text-ink"
                  : "mr-4 rounded-xl border border-line bg-paper px-3 py-2 text-sm leading-relaxed text-ink-soft"
              }
            >
              {m.content}
            </div>
          ))}
        </div>
      ) : null}

      {loading ? <p className="mb-2 text-xs text-ink-mute">Pensando…</p> : null}
      {error !== null ? <p className="mb-2 text-xs text-neg">{error}</p> : null}

      <div className="flex flex-wrap gap-1.5">
        {MODE_CHIPS.filter((c) => !c.wrongOnly || wasWrong).map((c) => (
          <button
            key={c.mode}
            type="button"
            disabled={loading}
            onClick={() => {
              void send(c.mode);
            }}
            className="rounded-full border border-line-strong bg-surface px-3 py-1.5 text-xs font-semibold text-ink disabled:opacity-50 active:opacity-70"
          >
            {c.label}
          </button>
        ))}
      </div>

      <div className="mt-2 flex gap-1.5">
        <input
          type="text"
          value={followUp}
          maxLength={TUTOR_FOLLOW_UP_MAX_CHARS}
          onChange={(e) => {
            setFollowUp(e.target.value);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") sendFreeText();
          }}
          placeholder="Pergunte sobre esta questão…"
          className="min-w-0 flex-1 rounded-lg border border-line-strong bg-paper px-3 py-2 text-sm text-ink placeholder:text-ink-mute"
        />
        <button
          type="button"
          disabled={loading || followUp.trim().length === 0}
          onClick={sendFreeText}
          className="rounded-lg bg-ink px-3 py-2 text-xs font-semibold text-paper disabled:opacity-50 active:opacity-70"
        >
          Enviar
        </button>
      </div>
    </div>
  );
}
