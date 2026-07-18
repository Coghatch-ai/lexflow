import { useEffect, useRef, useState, type ReactElement } from "react";
import { useLocation } from "wouter";
import { ArrowLeft, Bookmark, Check, X } from "lucide-react";
import type { AiExplanation } from "@shared/domain/ai-eval";
import { trpc } from "../lib/trpc";
import {
  usePracticeState,
  type AnswerRecap,
  type Difficulty,
  type PracticeMode,
} from "../state/practice-context";
import { AiExplanationButton } from "./AiExplanationButton";
import { Centered } from "./Centered";

// The minimal question shape the runner needs. Both questions.list rows (mapped
// through toQuestion) and the leaner questions.reviewQueue rows satisfy it, so
// practice and review share this one immersive flow.
export type RunnerQuestion = {
  id: string;
  questionText: string;
  options: string[];
  correctAnswer: string;
  discipline: string;
  explanation: string;
  aiExplanation?: AiExplanation | null;
};

// Difficulty isn't surfaced in the POC; every session carries a neutral tag.
// Per-answer correctness still feeds stats + the SM-2 schedule exactly.
const SESSION_DIFFICULTY: Difficulty = "medium";

type TrackedAnswer = AnswerRecap & { timeSpent: number };

export function QuestionRunner({
  questions,
  sessionDiscipline,
  mode,
}: {
  questions: RunnerQuestion[];
  sessionDiscipline: string;
  mode: PracticeMode;
}): ReactElement {
  const [, navigate] = useLocation();
  const utils = trpc.useUtils();
  const { setResult } = usePracticeState();

  const recordMut = trpc.sessions.record.useMutation();
  const bookmarkMut = trpc.bookmarks.toggle.useMutation();
  const bookmarksQ = trpc.bookmarks.list.useQuery();

  const [index, setIndex] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [bookmarkOverrides, setBookmarkOverrides] = useState<Map<string, boolean>>(new Map());
  const answersRef = useRef<TrackedAnswer[]>([]);
  const startRef = useRef<number>(Date.now());

  // Reset the per-question timer whenever the question changes.
  useEffect(() => {
    startRef.current = Date.now();
  }, [index]);

  const current = questions.at(index);

  function choose(option: string): void {
    if (selected === null) setSelected(option);
  }

  function isBookmarked(id: string): boolean {
    const override = bookmarkOverrides.get(id);
    if (override !== undefined) return override;
    return (bookmarksQ.data ?? []).includes(id);
  }

  function toggleBookmark(id: string): void {
    bookmarkMut.mutate(
      { questionId: id },
      {
        onSuccess: ({ bookmarked }) => {
          setBookmarkOverrides((prev) => new Map(prev).set(id, bookmarked));
          void utils.bookmarks.list.invalidate();
        },
      },
    );
  }

  function finish(all: TrackedAnswer[]): void {
    recordMut.mutate(
      {
        discipline: sessionDiscipline,
        difficulty: SESSION_DIFFICULTY,
        answers: all.map((a) => ({
          questionId: a.questionId,
          userAnswer: a.userAnswer,
          correct: a.correct,
          timeSpent: a.timeSpent,
        })),
      },
      {
        onSuccess: (data) => {
          // Recording moves the SM-2 schedule, so the queue/badge/stats are now
          // stale — refresh them here (Result no longer owns this).
          void utils.stats.summary.invalidate();
          void utils.stats.byDiscipline.invalidate();
          void utils.questions.dueCount.invalidate();
          void utils.questions.reviewQueue.invalidate();
          void utils.sessions.listRecent.invalidate();
          setResult({
            discipline: sessionDiscipline,
            difficulty: SESSION_DIFFICULTY,
            mode,
            totalQuestions: data.totalQuestions,
            correctAnswers: data.correctAnswers,
            recap: all,
          });
          navigate("/result");
        },
      },
    );
  }

  function next(): void {
    if (selected === null || current === undefined) return;
    const timeSpent = Math.max(0, Math.round((Date.now() - startRef.current) / 1000));
    const tracked: TrackedAnswer = {
      questionId: current.id,
      questionText: current.questionText,
      options: current.options,
      userAnswer: selected,
      correctAnswer: current.correctAnswer,
      correct: selected === current.correctAnswer,
      timeSpent,
    };
    const all = [...answersRef.current, tracked];
    answersRef.current = all;
    if (index >= questions.length - 1) {
      finish(all);
    } else {
      setSelected(null);
      setIndex(index + 1);
    }
  }

  if (current === undefined) return <Centered>Sem questões.</Centered>;

  const answered = selected !== null;
  const isLast = index >= questions.length - 1;
  const progress = ((index + 1) / questions.length) * 100;
  const saved = isBookmarked(current.id);

  return (
    <div className="flex min-h-screen flex-col bg-paper">
      {/* Immersive header: exit + progress + count */}
      <div
        className="sticky top-0 z-10 bg-paper/95 px-4 pb-3 backdrop-blur"
        style={{ paddingTop: "max(0.75rem, env(safe-area-inset-top))" }}
      >
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => {
              navigate("/");
            }}
            aria-label="Sair"
            className="text-ink-mute"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-line">
            <div
              className="h-full rounded-full bg-seal transition-all"
              style={{ width: `${progress}%` }}
            />
          </div>
          <span className="text-xs font-semibold tnum text-ink-mute">
            {index + 1}/{questions.length}
          </span>
        </div>
      </div>

      {/* Question */}
      <div className="flex-1 px-4 py-4">
        <div className="mb-3 flex items-center justify-between gap-2">
          <p className="badge-seal">{current.discipline}</p>
          <button
            type="button"
            onClick={() => {
              toggleBookmark(current.id);
            }}
            aria-label={saved ? "Remover dos salvos" : "Salvar questão"}
            aria-pressed={saved}
            className={saved ? "text-seal" : "text-ink-mute"}
          >
            <Bookmark
              className="h-5 w-5"
              fill={saved ? "currentColor" : "none"}
              strokeWidth={1.75}
            />
          </button>
        </div>
        <p className="text-base font-medium leading-relaxed text-ink">{current.questionText}</p>

        <div className="mt-5 flex flex-col gap-2.5">
          {current.options.map((option) => (
            <button
              key={option}
              type="button"
              disabled={answered}
              onClick={() => {
                choose(option);
              }}
              className={optionClass(option, selected, current.correctAnswer)}
            >
              <span className="flex-1">{option}</span>
              {answered && option === current.correctAnswer ? (
                <Check className="h-5 w-5 shrink-0 text-pos" />
              ) : null}
              {answered && option === selected && option !== current.correctAnswer ? (
                <X className="h-5 w-5 shrink-0 text-neg" />
              ) : null}
            </button>
          ))}
        </div>

        {answered ? (
          <div className="mt-5 rounded-xl border border-line bg-surface p-4">
            <p className="eyebrow mb-1.5">Comentário</p>
            <p className="text-sm leading-relaxed text-ink-soft">{current.explanation}</p>
            <AiExplanationButton
              questionId={current.id}
              aiExplanation={current.aiExplanation}
              explanation={current.explanation}
            />
          </div>
        ) : null}
      </div>

      {/* Action bar */}
      <div
        className="sticky bottom-0 border-t border-line bg-surface px-4 py-3"
        style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}
      >
        <button
          type="button"
          onClick={next}
          disabled={!answered || recordMut.isPending}
          className="btn-primary w-full text-base"
        >
          {recordMut.isPending ? "Salvando…" : isLast ? "Ver resultado" : "Próxima"}
        </button>
      </div>
    </div>
  );
}

function optionClass(option: string, selected: string | null, correctAnswer: string): string {
  const base =
    "flex items-center gap-2 rounded-xl border px-4 py-3.5 text-left text-sm font-medium transition";
  if (selected === null) {
    return `${base} border-line-strong bg-surface text-ink active:bg-paper-sink`;
  }
  if (option === correctAnswer) {
    return `${base} border-pos bg-pos/10 text-ink`;
  }
  if (option === selected) {
    return `${base} border-neg bg-neg/10 text-ink`;
  }
  return `${base} border-line bg-surface text-ink-mute opacity-60`;
}
