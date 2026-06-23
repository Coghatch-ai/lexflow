// app/src/components/discursive/DiscursiveRunner.tsx
//
// Steps through a list of discursive questions one at a time, collecting each
// answer (text + self-score + optional AI grade). An AI grade is obtained via the
// central relay (browser → relay → LLM) and persisted fire-and-forget via
// saveAnswer. The relay owns the prompt; the client sends { promptId, variables }.
// The persisted row id rides in each CollectedAnswer so the page can finalize at finish.

import { useEffect, useRef, useState, type ReactElement } from "react";
import { useGetToken } from "../../auth";
import { trpc } from "../../shared/lib/trpc";
import { aiComplete, isAiEvalConfigured } from "../../shared/lib/ai-eval-service";
import {
  buildGradeVariables,
  parseGradeResponse,
} from "@shared/domain/ai-eval";
import DiscursiveQuestionCard from "./DiscursiveQuestionCard";
import type { AiResult, AnswerKey, CollectedAnswer, DiscursiveQuestion, Lov } from "./types";

interface RunnerProps {
  questions: DiscursiveQuestion[];
  areaLov: Lov;
  questionTypeLov: Lov;
  finishing: boolean;
  // Lazily resolves the prova session id (null for single-question practice).
  // Owned by the page so grade-time and finish-time persistence share one session.
  getSessionId: () => Promise<string | null>;
  onBack: () => void;
  onFinish: (answers: CollectedAnswer[]) => void;
}

export default function DiscursiveRunner({
  questions, areaLov, questionTypeLov, finishing, getSessionId, onBack, onFinish,
}: RunnerProps): ReactElement {
  const utils = trpc.useUtils();
  const getToken = useGetToken();
  const saveAnswer = trpc.discursive.saveAnswer.useMutation();
  // AI grading is available when the relay URL is configured (VITE_AI_SERVICE_URL).
  const aiEnabled = isAiEvalConfigured();

  const [index, setIndex] = useState(0);
  const [answerText, setAnswerText] = useState("");
  const [revealed, setRevealed] = useState(false);
  const [answerKey, setAnswerKey] = useState<AnswerKey | null>(null);
  const [selfScore, setSelfScore] = useState<number | null>(null);
  const [aiResult, setAiResult] = useState<AiResult | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [timer, setTimer] = useState(0);
  const [collected, setCollected] = useState<CollectedAnswer[]>([]);
  // The grade persist is fire-and-forget; we hold its row id and the in-flight
  // promise in refs so "Próxima" can finalize without forcing a re-render.
  const answerIdRef = useRef<string | null>(null);
  const gradePersistRef = useRef<Promise<void> | null>(null);
  const advancingRef = useRef(false);

  const current = questions[index];

  useEffect(() => {
    if (revealed) return;
    const id = setInterval(() => { setTimer((t) => t + 1); }, 1000);
    return () => { clearInterval(id); };
  }, [revealed, index]);

  if (questions.length === 0) return <p className="text-gray-600">Nenhuma questão encontrada.</p>;

  const reset = (): void => {
    setAnswerText("");
    setRevealed(false);
    setAnswerKey(null);
    setSelfScore(null);
    setAiResult(null);
    setAiError(null);
    setTimer(0);
    answerIdRef.current = null;
    gradePersistRef.current = null;
  };

  const handleSubmit = async (): Promise<void> => {
    const [key] = await utils.discursive.answerKey.fetch({ ids: [current.id] });
    setAnswerKey({ modelAnswer: key.modelAnswer, legalBasis: key.legalBasis });
    setRevealed(true);
  };

  // Relay grades (owns prompt); we display the parsed score immediately, then
  // fire-and-forget saveAnswer (Clerk-gated, persists the client-parsed result).
  const gradeViaRelay = async (sessionId: string | null): Promise<void> => {
    const token = await getToken();
    const { text } = await aiComplete(
      {
        promptId: "oab-grade",
        variables: buildGradeVariables({
          statement: current.statement,
          studentAnswer: answerText,
          modelAnswer: answerKey?.modelAnswer ?? null,
          legalBasis: answerKey?.legalBasis ?? null,
          maxPoints: current.maxPoints,
        }),
      },
      token,
    );
    const parsed = parseGradeResponse(text, current.maxPoints);
    if (parsed === null) throw new Error("Não foi possível interpretar a avaliação da IA");
    setAiResult(parsed); // inline display first — persistence is fire-and-forget
    gradePersistRef.current = saveAnswer
      .mutateAsync({
        answerId: answerIdRef.current ?? undefined,
        questionId: current.id,
        answerText,
        selfScore,
        timeSpent: timer,
        sessionId,
        aiScore: parsed.score,
        aiFeedback: parsed.feedback,
      })
      .then((r) => { answerIdRef.current = r.answerId; })
      .catch((err: unknown) => { console.error("Falha ao salvar avaliação da IA", err); });
  };

  const handleRequestAi = async (): Promise<void> => {
    setAiLoading(true);
    setAiError(null);
    try {
      const sessionId = await getSessionId();
      await gradeViaRelay(sessionId);
    } catch (err) {
      setAiError(err instanceof Error ? err.message : "Falha ao avaliar com IA");
    } finally {
      setAiLoading(false);
    }
  };

  const handleNext = async (): Promise<void> => {
    if (advancingRef.current) return;
    advancingRef.current = true;
    try {
      // Ensure a fire-and-forget grade write finished so we carry its row id.
      if (gradePersistRef.current !== null) await gradePersistRef.current;
      const answer: CollectedAnswer = {
        questionId: current.id,
        answerText,
        selfScore,
        timeSpent: timer,
        ai: aiResult,
        answerId: answerIdRef.current,
      };
      const all = [...collected, answer];
      if (index + 1 >= questions.length) {
        onFinish(all);
        return;
      }
      setCollected(all);
      setIndex(index + 1);
      reset();
    } finally {
      advancingRef.current = false;
    }
  };

  return (
    <div className="space-y-4">
      <button onClick={onBack} className="text-sm text-[#16161a] hover:text-[#26262c] font-medium transition">
        Voltar
      </button>
      <DiscursiveQuestionCard
        question={current}
        areaLabel={areaLov.labelOf(current.area)}
        typeLabel={questionTypeLov.labelOf(current.questionType)}
        index={index}
        total={questions.length}
        timer={timer}
        answerText={answerText}
        onAnswerChange={setAnswerText}
        revealed={revealed}
        answerKey={answerKey}
        selfScore={selfScore}
        onSelfScoreChange={setSelfScore}
        aiEnabled={aiEnabled}
        aiResult={aiResult}
        aiLoading={aiLoading}
        aiError={aiError}
        onRequestAi={() => { void handleRequestAi(); }}
        onSubmit={() => { void handleSubmit(); }}
        onNext={() => { void handleNext(); }}
        isLast={index + 1 >= questions.length}
        submitting={finishing}
      />
    </div>
  );
}
