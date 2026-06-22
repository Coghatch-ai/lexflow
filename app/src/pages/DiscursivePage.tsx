// app/src/pages/DiscursivePage.tsx
//
// OAB 2ª-fase (discursive) study. Two practice units — single-question and
// full-prova — share one answering runner. AI grades are SERVER-TRUSTED and
// persisted the moment they're produced (DiscursiveRunner → saveAnswer), so a
// refresh keeps them. This page owns the prova session (created lazily, shared
// with the runner via getSessionId) and, on finish, upserts each answer's final
// self-score and closes the session.

import { useRef, useState, type ReactElement } from "react";
import { useLov } from "../shared/hooks/use-lov";
import { trpc } from "../shared/lib/trpc";
import { sumScores } from "@shared/domain/discursive-attempt";
import {
  DiscursiveModeSelect,
  DiscursiveProvaPicker,
  DiscursiveSingleFilters,
  type ProvaMode,
} from "../components/discursive/DiscursiveFilters";
import DiscursiveRunner from "../components/discursive/DiscursiveRunner";
import DiscursiveResult from "../components/discursive/DiscursiveResult";
import type { CollectedAnswer, DiscursiveQuestion } from "../components/discursive/types";

type Status = "select" | "single-config" | "prova-config" | "running" | "done";

type SaveAnswerFn = (input: {
  answerId?: string;
  questionId: string;
  answerText: string;
  selfScore: number | null;
  timeSpent: number;
  sessionId: string | null;
}) => Promise<unknown>;

// Parse the picker's composite key (examLabel|area|year) back into a prova.
function parseProvaKey(key: string): { examLabel: string; area: string; year: number } | null {
  const parts = key.split("|");
  if (parts.length < 3) return null;
  return { examLabel: parts[0], area: parts[1], year: Number(parts[2]) };
}

// Persist each answer's final state. Graded answers already exist (carry answerId)
// so this updates their self-score/time without touching the verified ai_* grade;
// ungraded answers are inserted. No grade proof is sent — grades are saved at
// grade time while their signature is fresh.
async function persistAnswers(
  answers: CollectedAnswer[],
  sessionId: string | null,
  saveAnswer: SaveAnswerFn,
): Promise<void> {
  for (const a of answers) {
    await saveAnswer({
      answerId: a.answerId ?? undefined,
      questionId: a.questionId,
      answerText: a.answerText,
      selfScore: a.selfScore,
      timeSpent: a.timeSpent,
      sessionId,
    });
  }
}

export default function DiscursivePage(): ReactElement {
  const areaLov = useLov("DISCIPLINE");
  const questionTypeLov = useLov("QUESTION_TYPE");
  const utils = trpc.useUtils();
  const exams = trpc.discursive.exams.useQuery();
  const saveAnswer = trpc.discursive.saveAnswer.useMutation();
  const ensureSession = trpc.discursive.ensureSession.useMutation();
  const finalizeSession = trpc.discursive.finalizeSession.useMutation();

  const [status, setStatus] = useState<Status>("select");
  const [mode, setMode] = useState<ProvaMode>("single");
  const [area, setArea] = useState("");
  const [examLabel, setExamLabel] = useState("");
  const [questionType, setQuestionType] = useState("");
  const [provaSel, setProvaSel] = useState("");
  const [questions, setQuestions] = useState<DiscursiveQuestion[]>([]);
  const [finished, setFinished] = useState<CollectedAnswer[]>([]);
  const [finishing, setFinishing] = useState(false);
  // Caches the in-flight/created prova session for the whole run so grade-time and
  // finish-time persistence share one session row. Reset when a new run starts.
  const sessionPromiseRef = useRef<Promise<string | null> | null>(null);

  const provas = exams.data ?? [];
  const examLabels = [...new Set(provas.map((p) => p.examLabel))];

  // Single practice has no session; prova creates one lazily on first use.
  const getSessionId = (): Promise<string | null> => {
    if (mode !== "prova") return Promise.resolve(null);
    const meta = parseProvaKey(provaSel);
    if (meta === null) return Promise.resolve(null);
    sessionPromiseRef.current ??= ensureSession.mutateAsync(meta).then((r) => r.sessionId);
    return sessionPromiseRef.current;
  };

  const startSingle = async (): Promise<void> => {
    sessionPromiseRef.current = null;
    const rows = await utils.discursive.list.fetch({
      area: area !== "" ? area : undefined,
      examLabel: examLabel !== "" ? examLabel : undefined,
      questionType: questionType !== "" ? (questionType as "PECA_PRATICA" | "DISCURSIVE") : undefined,
      limit: 10,
    });
    setQuestions(rows);
    setStatus("running");
  };

  const startProva = async (): Promise<void> => {
    const meta = parseProvaKey(provaSel);
    if (meta === null) return;
    sessionPromiseRef.current = null;
    const rows = await utils.discursive.getProva.fetch(meta);
    setQuestions(rows);
    setStatus("running");
  };

  const handleFinish = async (answers: CollectedAnswer[]): Promise<void> => {
    setFinishing(true);
    try {
      const sessionId = mode === "prova" ? await getSessionId() : null;
      await persistAnswers(answers, sessionId, saveAnswer.mutateAsync);
      if (sessionId !== null) {
        const scored = answers.some((a) => a.selfScore !== null);
        await finalizeSession.mutateAsync({
          sessionId,
          totalSelfScore: scored ? sumScores(answers.map((a) => a.selfScore)) : null,
        });
      }
      void utils.discursive.invalidate();
      setFinished(answers);
      setStatus("done");
    } finally {
      setFinishing(false);
    }
  };

  if (status === "select") {
    return (
      <DiscursiveModeSelect
        onSelect={(m) => { setMode(m); setStatus(m === "single" ? "single-config" : "prova-config"); }}
      />
    );
  }

  if (status === "single-config") {
    return (
      <DiscursiveSingleFilters
        area={area} examLabel={examLabel} questionType={questionType}
        loading={false} areaLov={areaLov} questionTypeLov={questionTypeLov} examLabels={examLabels}
        onAreaChange={setArea} onExamChange={setExamLabel} onTypeChange={setQuestionType}
        onBack={() => { setStatus("select"); }}
        onStart={() => { void startSingle(); }}
      />
    );
  }

  if (status === "prova-config") {
    return (
      <DiscursiveProvaPicker
        provas={provas} selectedKey={provaSel} loading={false} areaLov={areaLov}
        onSelectKey={setProvaSel}
        onBack={() => { setStatus("select"); }}
        onStart={() => { void startProva(); }}
      />
    );
  }

  if (status === "running") {
    return (
      <DiscursiveRunner
        questions={questions}
        areaLov={areaLov}
        questionTypeLov={questionTypeLov}
        finishing={finishing}
        getSessionId={getSessionId}
        onBack={() => { setStatus(mode === "single" ? "single-config" : "prova-config"); }}
        onFinish={(answers) => { void handleFinish(answers); }}
      />
    );
  }

  return (
    <DiscursiveResult
      mode={mode}
      answers={finished}
      questions={questions}
      questionTypeLov={questionTypeLov}
      onRestart={() => { setStatus(mode === "single" ? "single-config" : "prova-config"); }}
      onSwitchMode={() => { setStatus("select"); }}
    />
  );
}
