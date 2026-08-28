import { useEffect, useRef, useState, type ReactElement } from "react";
import { useLocation } from "wouter";
import type { AiExplanation } from "@shared/domain/ai-eval";
import {
  NO_ELIMINATIONS,
  type EliminationState,
  clearForQuestion,
  eliminatedFor,
  optionRowKey,
  toggleElimination,
} from "@shared/domain/eliminations";
import {
  NO_CARRIED_TIME,
  type CarriedTime,
  canPostponeGuard,
  postponeOnce,
  totalTimeFor,
} from "@shared/domain/exam-queue";
import { exitPrompt } from "@shared/run/exit-rules";
import { appendAnswer, type DraftClaim } from "@shared/run/run-persistence";
import { mobileRunMode, type MobileSurface } from "@shared/run/mobile-run";
import { trpc } from "../lib/trpc";
import { usePracticeState, type Difficulty, type PracticeMode } from "../state/practice-context";
import { AiExplanationButton } from "./AiExplanationButton";
import { AiTutorPanel } from "./AiTutorPanel";
import { LegalRefs } from "./LegalRefs";
import { Centered } from "./Centered";
import { RunnerOption } from "./RunnerOption";
import { RunnerActions, RunnerHeader, RunnerTopRow } from "./RunnerChrome";
import { QuitTestDialog } from "./QuitTestDialog";
import { RunOverlays } from "./RunOverlays";
import { useRunExit, type AdoptedDraft, type TrackedAnswer } from "./use-run-exit";

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

/** What a resumed run (BR-05.2) puts back on screen. Absent = a fresh run. */
export interface RunResumeSeed {
  cursor: number;
  answers: TrackedAnswer[];
  carriedTime: CarriedTime;
  draft: AdoptedDraft;
}

// Difficulty isn't surfaced in the POC; every session carries a neutral tag.
// Per-answer correctness still feeds stats + the SM-2 schedule exactly.
const SESSION_DIFFICULTY: Difficulty = "medium";

export function QuestionRunner({
  questions,
  sessionDiscipline,
  surface,
  resume,
  onReloadFromServer,
  onRestart,
}: {
  questions: RunnerQuestion[];
  sessionDiscipline: string;
  /** Which screen this run belongs to — it decides the saved mode (BR-05). */
  surface: MobileSurface;
  resume?: RunResumeSeed | undefined;
  /** CONFLICT → rehydrate from the server's copy. */
  onReloadFromServer: () => void;
  /** The server's copy was discarded — start this mode over. */
  onRestart: () => void;
}): ReactElement {
  const [, navigate] = useLocation();
  const utils = trpc.useUtils();
  const { setResult } = usePracticeState();

  const recordMut = trpc.sessions.record.useMutation();
  const bookmarkMut = trpc.bookmarks.toggle.useMutation();
  const bookmarksQ = trpc.bookmarks.list.useQuery();

  const [index, setIndex] = useState(resume?.cursor ?? 0);
  const [selected, setSelected] = useState<string | null>(null);
  const [bookmarkOverrides, setBookmarkOverrides] = useState<Map<string, boolean>>(new Map());
  // The run's own queue (BR-03: "responder depois" moves a question to its end).
  // Seeded ONCE on purpose: finish() invalidates questions.reviewQueue/list, so
  // the `questions` prop changes right after recording — re-syncing here would
  // reorder the queue mid-session. A resume is already seeded in this order.
  const [queue, setQueue] = useState<RunnerQuestion[]>(questions);
  const [eliminations, setEliminations] = useState<EliminationState>(NO_ELIMINATIONS);
  const answersRef = useRef<TrackedAnswer[]>(resume?.answers ?? []);
  const startRef = useRef<number>(Date.now());
  // Seconds already spent on questions that were postponed (BR-03.1) — a
  // postpone must not throw the reading time away, nor bill it to the next one.
  const carriedRef = useRef<CarriedTime>(resume?.carriedTime ?? NO_CARRIED_TIME);
  // The queue reference a postpone already consumed — the single-flight token.
  // It collapses same-task / re-entrant double-firing: two calls before React
  // commits the new queue would otherwise both move it (skipping an unseen
  // question) and bank the same seconds twice. A human double-tap is NOT that
  // case — two taps are two tasks, so the second sees the committed queue and
  // legitimately applies (benign: carry near zero, question returns at the tail).
  const consumedQueueRef = useRef<RunnerQuestion[] | null>(null);

  // Reset the per-question timer whenever the question changes.
  useEffect(() => {
    startRef.current = Date.now();
  }, [index]);

  const current = queue.at(index);
  // The Result screen's tag: the Drill is a practice run for the student, and
  // the SAVED mode is a separate decision (`mobileRunMode`, BR-05 EMENDA).
  const resultMode: PracticeMode = surface === "review" ? "review" : "practice";

  function elapsedSeconds(): number {
    return Math.max(0, Math.round((Date.now() - startRef.current) / 1000));
  }

  function trackedFor(question: RunnerQuestion, answer: string): TrackedAnswer {
    return {
      questionId: question.id,
      questionText: question.questionText,
      options: question.options,
      userAnswer: answer,
      correctAnswer: question.correctAnswer,
      correct: answer === question.correctAnswer,
      // Everything banked by earlier postpones of this question plus this visit.
      timeSpent: totalTimeFor(carriedRef.current, question.id, elapsedSeconds()),
    };
  }

  // The answer already revealed on screen but not yet confirmed with "Próxima".
  // It joins an exit's payload exactly as "Próxima" would have recorded it.
  function pendingAnswer(): TrackedAnswer | null {
    if (selected === null || current === undefined) return null;
    return trackedFor(current, selected);
  }

  async function recordRun(all: TrackedAnswer[], claim: DraftClaim | undefined): Promise<void> {
    const data = await recordMut.mutateAsync({
      discipline: sessionDiscipline,
      difficulty: SESSION_DIFFICULTY,
      answers: all.map((a) => ({
        questionId: a.questionId,
        userAnswer: a.userAnswer,
        correct: a.correct,
        timeSpent: a.timeSpent,
      })),
      // Criterion 5: a persisted run is NEVER recorded without its claim, or
      // the draft would survive its own session and come back as "Continuar".
      ...(claim !== undefined ? { draft: claim } : {}),
    });
    // Recording moves the SM-2 schedule and kills the draft in the same
    // transaction, so the queue/badge/stats/saved-run cards are now stale.
    void utils.stats.summary.invalidate();
    void utils.stats.byDiscipline.invalidate();
    void utils.questions.dueCount.invalidate();
    void utils.questions.reviewQueue.invalidate();
    void utils.sessions.listRecent.invalidate();
    void utils.examDrafts.invalidate();
    setResult({
      discipline: sessionDiscipline,
      difficulty: SESSION_DIFFICULTY,
      mode: resultMode,
      totalQuestions: data.totalQuestions,
      correctAnswers: data.correctAnswers,
      recap: all,
    });
    navigate("/result");
  }

  const run = useRunExit({
    surface,
    discipline: sessionDiscipline,
    queueIds: () => queue.map((q) => q.id),
    answers: answersRef,
    carried: carriedRef,
    pending: pendingAnswer,
    record: recordRun,
    adopted: resume?.draft ?? null,
    exit: () => {
      void utils.examDrafts.invalidate();
      navigate("/");
    },
  });

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

  function next(): void {
    if (selected === null || current === undefined || run.busy) return;
    // `appendAnswer`, never a spread: after a failed recording the run comes
    // back on screen with this question ALREADY answered, and the second
    // confirmation must overwrite that entry instead of adding a twin.
    const all = appendAnswer(answersRef.current, trackedFor(current, selected));
    answersRef.current = all;
    // The answer is committed: this question's cross-outs die with it (BR-02.3).
    setEliminations((prev) => clearForQuestion(prev, current.id));
    if (index >= queue.length - 1) {
      void run.finishRun(all);
      return;
    }
    setSelected(null);
    setIndex(index + 1);
    // BR-05.1: progress is saved as the student answers, with no deliberate
    // action. The postpone above deliberately does NOT save (a draft is not
    // progress) — the reordering rides along with the next answer.
    run.persistence.scheduleSave();
  }

  // "Responder depois" (BR-03): the question goes to the END of the queue, the
  // cursor stays, nothing is recorded and the cross-outs travel with it.
  function postpone(): void {
    if (current === undefined) return;
    // ONE guarded snapshot decides both the queue move and the carried time, so
    // a second tap on the same rendered question is a no-op (not a second
    // transition that skips a question and double-counts its seconds).
    const outcome = postponeOnce({
      queue,
      index,
      questionId: current.id,
      elapsedSeconds: elapsedSeconds(),
      carried: carriedRef.current,
      consumedQueue: consumedQueueRef.current,
    });
    if (!outcome.applied) return;
    consumedQueueRef.current = queue;
    carriedRef.current = outcome.carried;
    setQueue(outcome.queue);
    setSelected(null);
    // The timer effect keys on `index`, and postponing does NOT move it (the
    // next question slides into the same slot) — so restart it by hand or the
    // next question inherits the postponed one's clock.
    startRef.current = Date.now();
  }

  if (current === undefined) return <Centered>Sem questões.</Centered>;

  const answered = selected !== null;
  const isLast = index >= queue.length - 1;
  const saved = isBookmarked(current.id);
  const eliminated = eliminatedFor(eliminations, current.id);
  // On mobile the reveal IS the check: after choosing, cross-out freezes.
  const canPostpone = canPostponeGuard({ checked: answered, hasMoreQuestions: !isLast });
  // A revealed question counts as answered: it is locked and joins the payload
  // on exit, exactly as "Próxima" would have recorded it.
  const answeredCount = answersRef.current.length + (answered ? 1 : 0);
  const busy = run.busy || recordMut.isPending;

  return (
    <>
      <div className="flex min-h-screen flex-col bg-paper">
        <RunnerHeader
          index={index}
          total={queue.length}
          onExit={() => {
            // BR-05.4: leaving a run in progress asks first (and leaves silently
            // when nothing was answered).
            run.requestExit(answeredCount);
          }}
        />

        {/* Question */}
        <div className="flex-1 px-4 py-4">
          <RunnerTopRow
            discipline={current.discipline}
            saved={saved}
            onToggleBookmark={() => {
              toggleBookmark(current.id);
            }}
          />
          <p className="text-base font-medium leading-relaxed text-ink">{current.questionText}</p>

          <div className="mt-5 flex flex-col gap-2.5">
            {current.options.map((option, idx) => (
              <RunnerOption
                // Question id + index + text: the row owns touch state, so a key
                // without the question identity lets React reuse a row instance
                // (and its swipe latch) across questions that share an option.
                key={optionRowKey(current.id, idx, option)}
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

        <RunnerActions
          canPostpone={canPostpone}
          onPostpone={postpone}
          onNext={next}
          disabled={!answered || busy}
          label={busy ? "Salvando…" : isLast ? "Ver resultado" : "Próxima"}
        />
      </div>

      <QuitTestDialog
        open={run.exitOpen}
        prompt={exitPrompt(mobileRunMode(surface), answeredCount, queue.length)}
        busy={busy}
        onContinue={run.dismissExit}
        onQuit={() => {
          void run.quitAndProcess();
        }}
        onSave={() => {
          void run.saveAndExit();
        }}
      />
      <RunOverlays
        persistence={run.persistence}
        busy={busy}
        onReload={onReloadFromServer}
        onRestart={onRestart}
        onExit={() => {
          navigate("/");
        }}
      />
    </>
  );
}
