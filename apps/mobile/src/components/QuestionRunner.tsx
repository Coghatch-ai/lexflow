import { useEffect, useRef, useState, type ReactElement } from "react";
import { useLocation } from "wouter";
import { ArrowLeft, Bookmark } from "lucide-react";
import type { AiExplanation } from "@shared/domain/ai-eval";
import {
  NO_ELIMINATIONS,
  type EliminationState,
  clearForQuestion,
  eliminatedFor,
  toggleElimination,
} from "@shared/domain/eliminations";
import {
  NO_CARRIED_TIME,
  type CarriedTime,
  canPostponeGuard,
  carryTime,
  moveToEnd,
  totalTimeFor,
} from "@shared/domain/exam-queue";
import { trpc } from "../lib/trpc";
import {
  usePracticeState,
  type AnswerRecap,
  type Difficulty,
  type PracticeMode,
} from "../state/practice-context";
import { AiExplanationButton } from "./AiExplanationButton";
import { AiTutorPanel } from "./AiTutorPanel";
import { LegalRefs } from "./LegalRefs";
import { Centered } from "./Centered";
import { RunnerOption } from "./RunnerOption";

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
  legalBasis?: string | null;
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
  // The run's own queue (BR-03: "responder depois" moves a question to its end).
  // Seeded ONCE on purpose: finish() invalidates questions.reviewQueue/list, so
  // the `questions` prop changes right after recording — re-syncing here would
  // reorder the queue mid-session.
  const [queue, setQueue] = useState<RunnerQuestion[]>(questions);
  const [eliminations, setEliminations] = useState<EliminationState>(NO_ELIMINATIONS);
  const answersRef = useRef<TrackedAnswer[]>([]);
  const startRef = useRef<number>(Date.now());
  // Seconds already spent on questions that were postponed (BR-03.1) — a
  // postpone must not throw the reading time away, nor bill it to the next one.
  const carriedRef = useRef<CarriedTime>(NO_CARRIED_TIME);

  // Reset the per-question timer whenever the question changes.
  useEffect(() => {
    startRef.current = Date.now();
  }, [index]);

  const current = queue.at(index);

  function elapsedSeconds(): number {
    return Math.max(0, Math.round((Date.now() - startRef.current) / 1000));
  }

  function choose(option: string): void {
    if (current === undefined) return;
    // A crossed-out alternative cannot be chosen until restored (BR-02.2).
    if (eliminatedFor(eliminations, current.id).includes(option)) return;
    if (selected === null) setSelected(option);
  }

  function toggleEliminate(option: string): void {
    if (current === undefined) return;
    setEliminations((prev) => toggleElimination(prev, current.id, option));
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
    // Everything banked by earlier postpones of this question plus this visit.
    const timeSpent = totalTimeFor(carriedRef.current, current.id, elapsedSeconds());
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
    // The answer is committed: this question's cross-outs die with it (BR-02.3).
    setEliminations((prev) => clearForQuestion(prev, current.id));
    if (index >= queue.length - 1) {
      finish(all);
    } else {
      setSelected(null);
      setIndex(index + 1);
    }
  }

  // "Responder depois" (BR-03): the question goes to the END of the queue, the
  // cursor stays, nothing is recorded and the cross-outs travel with it.
  function postpone(): void {
    if (current === undefined) return;
    carriedRef.current = carryTime(carriedRef.current, current.id, elapsedSeconds());
    setQueue((prev) => moveToEnd(prev, index));
    setSelected(null);
    // The timer effect keys on `index`, and postponing does NOT move it (the
    // next question slides into the same slot) — so restart it by hand or the
    // next question inherits the postponed one's clock.
    startRef.current = Date.now();
  }

  if (current === undefined) return <Centered>Sem questões.</Centered>;

  const answered = selected !== null;
  const isLast = index >= queue.length - 1;
  const progress = ((index + 1) / queue.length) * 100;
  const saved = isBookmarked(current.id);
  const eliminated = eliminatedFor(eliminations, current.id);
  // On mobile the reveal IS the check: after choosing, cross-out freezes.
  const canPostpone = canPostponeGuard({ checked: answered, hasMoreQuestions: !isLast });

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
            {index + 1}/{queue.length}
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
          {current.options.map((option, idx) => (
            <RunnerOption
              // Index + text: the row owns touch state, so a bare index would
              // let React reuse a row instance (and its latch) across questions.
              key={`${String(idx)}-${option}`}
              option={option}
              selected={selected}
              correctAnswer={current.correctAnswer}
              answered={answered}
              isEliminated={eliminated.includes(option)}
              onChoose={choose}
              {...(answered ? {} : { onToggleEliminate: toggleEliminate })}
            />
          ))}
        </div>

        {answered ? (
          <div className="mt-5 rounded-xl border border-line bg-surface p-4">
            <p className="eyebrow mb-1.5">Comentário</p>
            <p className="text-sm leading-relaxed text-ink-soft">{current.explanation}</p>
            <LegalRefs legalBasis={current.legalBasis ?? null} />
            <AiExplanationButton
              questionId={current.id}
              aiExplanation={current.aiExplanation}
              explanation={current.explanation}
            />
            <AiTutorPanel
              questionId={current.id}
              userAnswer={selected}
              wasWrong={selected !== current.correctAnswer}
            />
          </div>
        ) : null}
      </div>

      {/* Action bar */}
      <div
        className="sticky bottom-0 border-t border-line bg-surface px-4 py-3"
        style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}
      >
        <div className="flex flex-col gap-2">
          {canPostpone ? (
            <button
              type="button"
              onClick={postpone}
              className="w-full rounded-xl border border-line-strong px-4 py-3 text-sm font-semibold text-ink-soft active:bg-paper-sink"
            >
              Responder depois
            </button>
          ) : null}
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
    </div>
  );
}
