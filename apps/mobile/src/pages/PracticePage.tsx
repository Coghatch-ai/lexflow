import { useEffect, useMemo, useRef, useState, type ReactElement, type ReactNode } from "react";
import { useLocation } from "wouter";
import { ArrowLeft, Check, X } from "lucide-react";
import { toQuestion, type Question } from "@shared/domain/question";
import { trpc } from "../lib/trpc";
import { usePracticeState, type AnswerRecap, type Difficulty } from "../state/practice-context";

// A practice session is tagged with one discipline (chosen on Home) and one
// difficulty. We don't filter by difficulty in the POC, so the session carries
// a neutral "medium" tag; per-answer correctness still feeds stats exactly.
const SESSION_DIFFICULTY: Difficulty = "medium";
const QUESTION_LIMIT = 10;

type TrackedAnswer = AnswerRecap & { timeSpent: number };

export function PracticePage(): ReactElement {
  const [, navigate] = useLocation();
  const { discipline, setResult } = usePracticeState();

  const listQ = trpc.questions.list.useQuery(
    { discipline, limit: QUESTION_LIMIT },
    { enabled: discipline !== "", refetchOnWindowFocus: false },
  );
  const recordMut = trpc.sessions.record.useMutation();

  const questions = useMemo<Question[]>(() => (listQ.data ?? []).map(toQuestion), [listQ.data]);

  const [index, setIndex] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const answersRef = useRef<TrackedAnswer[]>([]);
  const startRef = useRef<number>(Date.now());

  // Opened /practice without choosing a discipline -> back to Home.
  useEffect(() => {
    if (discipline === "") navigate("/");
  }, [discipline, navigate]);

  // Reset the per-question timer whenever the question changes.
  useEffect(() => {
    startRef.current = Date.now();
  }, [index]);

  const current = questions.at(index);

  function choose(option: string): void {
    if (selected === null) setSelected(option);
  }

  function finish(all: TrackedAnswer[]): void {
    recordMut.mutate(
      {
        discipline,
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
          setResult({
            discipline,
            difficulty: SESSION_DIFFICULTY,
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

  if (discipline === "") return <Centered>Redirecionando…</Centered>;
  if (listQ.isLoading) return <Centered>Carregando questões…</Centered>;
  if (listQ.isError) return <Centered>Erro ao carregar. Tente novamente.</Centered>;
  if (current === undefined) {
    return (
      <Centered>
        <p className="text-ink-mute">Sem questões para esta disciplina.</p>
        <button
          type="button"
          onClick={() => {
            navigate("/");
          }}
          className="btn-secondary mt-4"
        >
          Voltar
        </button>
      </Centered>
    );
  }

  const answered = selected !== null;
  const isLast = index >= questions.length - 1;
  const progress = ((index + 1) / questions.length) * 100;

  return (
    <div className="flex min-h-screen flex-col bg-paper">
      {/* Immersive header: progress + exit */}
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
        <p className="badge-seal mb-3">{current.discipline}</p>
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

function Centered({ children }: { children: ReactNode }): ReactElement {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-6 text-center text-ink-mute">
      {children}
    </div>
  );
}
