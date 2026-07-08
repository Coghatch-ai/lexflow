// apps/mobile/src/pages/FlashcardsPage.tsx
//
// Immersive flashcard review flow. Shows question front, tap to reveal back,
// then "Não sabia" / "Sabia" self-rating. Batches review items and submits
// them all via flashcards.review on finish.

import { useState, type ReactElement } from "react";
import { useLocation } from "wouter";
import { ArrowLeft, ChevronRight, Eye } from "lucide-react";
import { trpc } from "../lib/trpc";
import { Centered } from "../components/Centered";
import type { FlashcardCard } from "@shared/domain/flashcard";

type ReviewItem = { questionId: string; known: boolean };

export function FlashcardsPage(): ReactElement {
  const [, navigate] = useLocation();
  const utils = trpc.useUtils();

  const dueQ = trpc.flashcards.dueQueue.useQuery();
  const newBatchQ = trpc.flashcards.newBatch.useQuery(
    { limit: 10 },
    { enabled: dueQ.isSuccess && dueQ.data.length === 0 },
  );
  const reviewMut = trpc.flashcards.review.useMutation();

  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [collected, setCollected] = useState<ReviewItem[]>([]);
  const [done, setDone] = useState(false);

  const cards: FlashcardCard[] =
    dueQ.data !== undefined && dueQ.data.length > 0 ? dueQ.data : (newBatchQ.data ?? []);

  const isLoading =
    dueQ.isLoading || (dueQ.isSuccess && dueQ.data.length === 0 && newBatchQ.isLoading);

  function goHome(): void {
    navigate("/");
  }

  function reveal(): void {
    setRevealed(true);
  }

  function rate(known: boolean, current: FlashcardCard): void {
    const next = [...collected, { questionId: current.id, known }];
    setCollected(next);

    if (next.length >= cards.length) {
      reviewMut.mutate(
        { items: next },
        {
          onSuccess: () => {
            void utils.flashcards.dueQueue.invalidate();
            void utils.questions.dueCount.invalidate();
            setDone(true);
          },
        },
      );
    } else {
      setRevealed(false);
      setIndex(index + 1);
    }
  }

  if (isLoading) {
    return (
      <div className="flex min-h-screen flex-col bg-paper">
        <ImmersiveHeader onBack={goHome} index={0} total={0} />
        <Centered>Carregando flashcards…</Centered>
      </div>
    );
  }

  if (done) {
    const knownCount = collected.filter((c) => c.known).length;
    const total = collected.length;
    return (
      <div className="flex min-h-screen flex-col bg-paper">
        <ImmersiveHeader onBack={goHome} index={total} total={total} />
        <Centered>
          <div className="flex flex-col items-center gap-4 px-6 text-center">
            <p className="text-3xl font-bold text-ink">
              {knownCount}/{total}
            </p>
            <p className="text-sm text-ink-mute">flashcards que você sabia</p>
            <button type="button" onClick={goHome} className="btn-primary flex items-center gap-2">
              <ChevronRight className="h-4 w-4" />
              Voltar ao início
            </button>
          </div>
        </Centered>
      </div>
    );
  }

  if (cards.length === 0) {
    return (
      <div className="flex min-h-screen flex-col bg-paper">
        <ImmersiveHeader onBack={goHome} index={0} total={0} />
        <Centered>
          <div className="flex flex-col items-center gap-4 px-6 text-center">
            <p className="text-lg font-semibold text-ink">Nenhum flashcard disponível.</p>
            <p className="text-sm text-ink-mute">
              Responda algumas questões para gerar cartões de revisão.
            </p>
            <button type="button" onClick={goHome} className="btn-primary flex items-center gap-2">
              <ChevronRight className="h-4 w-4" />
              Voltar ao início
            </button>
          </div>
        </Centered>
      </div>
    );
  }

  // cards.length > 0 (empty handled above); index always within bounds.
  // Slice to a single-element array and destructure — avoids indexed-access lint
  // while staying within the no-! rule (CLAUDE.md).
  const [current] = cards.slice(index, index + 1) as [FlashcardCard];

  const progress = ((index + 1) / cards.length) * 100;
  const isPending = reviewMut.isPending;

  return (
    <div className="flex min-h-screen flex-col bg-paper">
      <ImmersiveHeader onBack={goHome} index={index + 1} total={cards.length} progress={progress} />

      {/* Card body */}
      <div className="flex-1 px-4 py-4">
        <p className="badge-seal mb-3">{current.discipline}</p>

        <p className="text-base font-medium leading-relaxed text-ink">{current.questionText}</p>

        <div className="mt-5 flex flex-col gap-2.5">
          {current.options.map((option) => {
            const isCorrect = option === current.correctAnswer;
            let cls =
              "flex items-center gap-2 rounded-xl border px-4 py-3.5 text-left text-sm font-medium";
            if (revealed) {
              cls += isCorrect
                ? " border-pos bg-pos/10 text-ink"
                : " border-line bg-surface text-ink-mute opacity-60";
            } else {
              cls += " border-line-strong bg-surface text-ink";
            }
            return (
              <div key={option} className={cls}>
                <span className="flex-1">{option}</span>
              </div>
            );
          })}
        </div>

        {revealed ? (
          <div className="mt-5 rounded-xl border border-line bg-surface p-4">
            <p className="eyebrow mb-1.5">Explicação</p>
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink-soft">
              {current.back}
            </p>
          </div>
        ) : null}
      </div>

      {/* Action bar */}
      <div
        className="sticky bottom-0 border-t border-line bg-surface px-4 py-3"
        style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}
      >
        {!revealed ? (
          <button
            type="button"
            onClick={reveal}
            className="btn-primary flex w-full items-center justify-center gap-2 text-base"
          >
            <Eye className="h-5 w-5" strokeWidth={1.75} />
            Revelar resposta
          </button>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => {
                rate(false, current);
              }}
              disabled={isPending}
              className="rounded-xl border border-neg bg-neg/10 px-4 py-3.5 text-sm font-semibold text-neg active:opacity-80"
            >
              Não sabia
            </button>
            <button
              type="button"
              onClick={() => {
                rate(true, current);
              }}
              disabled={isPending}
              className="rounded-xl border border-pos bg-pos/10 px-4 py-3.5 text-sm font-semibold text-pos active:opacity-80"
            >
              Sabia
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function ImmersiveHeader({
  onBack,
  index,
  total,
  progress,
}: {
  onBack: () => void;
  index: number;
  total: number;
  progress?: number;
}): ReactElement {
  return (
    <div
      className="sticky top-0 z-10 bg-paper/95 px-4 pb-3 backdrop-blur"
      style={{ paddingTop: "max(0.75rem, env(safe-area-inset-top))" }}
    >
      <div className="flex items-center gap-3">
        <button type="button" onClick={onBack} aria-label="Sair" className="text-ink-mute">
          <ArrowLeft className="h-5 w-5" />
        </button>
        {total > 0 ? (
          <>
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-line">
              <div
                className="h-full rounded-full bg-seal transition-all"
                style={{ width: `${progress ?? 0}%` }}
              />
            </div>
            <span className="text-xs font-semibold tnum text-ink-mute">
              {index}/{total}
            </span>
          </>
        ) : (
          <div className="flex-1" />
        )}
      </div>
    </div>
  );
}
