// app/src/components/discursive/DiscursiveQuestionCard.tsx
//
// One discursive question: read the situação-problema, write a free-text answer,
// then "Corrigir" to reveal the official padrão + legal basis and self-score
// (0..maxPoints). Optionally request an AI grade via the central service. This
// is NOT the MC QuestionCard — discursivas have no options.

import type { ReactElement } from "react";
import { Clock, Sparkles, CheckCircle2, ChevronRight } from "lucide-react";
import { clampScore } from "@shared/domain/discursive-attempt";
import type { AiResult, AnswerKey, DiscursiveQuestion } from "./types";
import { META_SEP } from "@shared/domain/ui-format";
import AllowanceChip from "../../shared/components/AllowanceChip";

function RevealPanel({ answerKey }: { answerKey: AnswerKey }): ReactElement {
  return (
    <div className="mt-5 space-y-4">
      <div className="bg-[#16161a]/[0.03] border border-gray-200 rounded-lg p-4">
        <p className="text-xs font-bold uppercase tracking-wide text-[#16161a] mb-2">Padrão de resposta</p>
        <p className="text-sm text-gray-800 whitespace-pre-line leading-relaxed">
          {answerKey.modelAnswer ?? "Padrão de resposta não disponível para esta questão."}
        </p>
      </div>
      {answerKey.legalBasis !== null && answerKey.legalBasis.length > 0 && (
        <div className="bg-[#d9ab53]/[0.08] border border-[#d9ab53]/30 rounded-lg p-4">
          <p className="text-xs font-bold uppercase tracking-wide text-[#b8893b] mb-1">Base legal</p>
          <p className="text-sm text-gray-700 whitespace-pre-line">{answerKey.legalBasis}</p>
        </div>
      )}
    </div>
  );
}

interface AiPanelProps {
  enabled: boolean;
  result: AiResult | null;
  loading: boolean;
  error: string | null;
  maxPoints: number;
  onRequest: () => void;
}

function AiPanel({ enabled, result, loading, error, maxPoints, onRequest }: AiPanelProps): ReactElement {
  return (
    <div className="mt-4 border-t border-gray-100 pt-4">
      <div className="flex flex-wrap items-center gap-3 mb-3">
        <AllowanceChip compact />
      </div>
      <button
        onClick={onRequest}
        disabled={!enabled || loading}
        title={enabled ? "Avaliar sua resposta com IA" : "Avaliação por IA indisponível"}
        className="flex items-center gap-2 text-sm font-semibold text-[#16161a] bg-[#16161a]/[0.06] hover:bg-[#16161a]/10 px-3 py-2 rounded-lg transition disabled:opacity-40"
      >
        <Sparkles className="w-4 h-4" />
        {loading ? "Avaliando…" : "Avaliar com IA"}
      </button>
      {!enabled && (
        <p className="mt-2 text-xs text-gray-400">Avaliação por IA indisponível nesta instalação.</p>
      )}
      {error !== null && <p className="mt-2 text-xs text-red-600">{error}</p>}
      {result !== null && (
        <div className="mt-3 bg-[#3f7a52]/[0.06] border border-[#3f7a52]/30 rounded-lg p-4">
          <p className="text-sm font-bold text-[#3f7a52]">
            Nota IA: {clampScore(result.score, maxPoints).toFixed(2)} / {maxPoints.toFixed(2)}
          </p>
          <p className="mt-1 text-sm text-gray-700 whitespace-pre-line">{result.feedback}</p>
        </div>
      )}
    </div>
  );
}

export interface DiscursiveQuestionCardProps {
  question: DiscursiveQuestion;
  areaLabel: string;
  typeLabel: string;
  index: number;
  total: number;
  timer: number;
  answerText: string;
  onAnswerChange: (text: string) => void;
  revealed: boolean;
  answerKey: AnswerKey | null;
  selfScore: number | null;
  onSelfScoreChange: (score: number) => void;
  aiEnabled: boolean;
  aiResult: AiResult | null;
  aiLoading: boolean;
  aiError: string | null;
  onRequestAi: () => void;
  onSubmit: () => void;
  onNext: () => void;
  isLast: boolean;
  submitting: boolean;
}

export default function DiscursiveQuestionCard(props: DiscursiveQuestionCardProps): ReactElement {
  const { question, answerText, revealed, answerKey, selfScore } = props;
  const lineCount = answerText.length === 0 ? 0 : answerText.split("\n").length;
  const overLimit = question.maxLines !== null && lineCount > question.maxLines;

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <span className="text-sm font-medium text-gray-700">Questão {props.index + 1} de {props.total}</span>
        <div className="flex items-center gap-2 text-sm text-gray-600">
          <Clock className="w-4 h-4" />
          {Math.floor(props.timer / 60)}:{String(props.timer % 60).padStart(2, "0")}
        </div>
      </div>

      <div className="bg-white rounded-xl p-6 shadow">
        <div className="flex flex-wrap items-center gap-2 mb-3 text-xs">
          <span className="font-semibold text-[#16161a]">{question.examLabel}</span>
          <span className="text-gray-300">{META_SEP}</span>
          <span className="text-gray-600">{props.areaLabel}</span>
          <span className="ml-auto bg-[#16161a]/[0.06] text-[#16161a] font-semibold px-2 py-1 rounded">{props.typeLabel}</span>
          <span className="bg-[#d9ab53]/15 text-[#b8893b] font-semibold px-2 py-1 rounded">{question.maxPoints.toFixed(2)} pts</span>
          {question.maxLines !== null && (
            <span className="bg-gray-100 text-gray-600 font-medium px-2 py-1 rounded">máx. {question.maxLines} linhas</span>
          )}
        </div>
        {question.topic !== null && question.topic.length > 0 && (
          <p className="text-sm font-medium text-gray-500 mb-2">{question.topic}</p>
        )}

        <p className="text-gray-800 whitespace-pre-line leading-relaxed mb-5">{question.statement}</p>

        <label className="block text-sm font-medium text-gray-700 mb-2">Sua resposta</label>
        <textarea
          value={answerText}
          onChange={(e) => { props.onAnswerChange(e.target.value); }}
          disabled={revealed}
          rows={10}
          placeholder="Redija sua resposta aqui…"
          className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:border-[#16161a] text-gray-800 placeholder-gray-400 disabled:bg-gray-50"
        />
        <p className={`mt-1 text-xs ${overLimit ? "text-red-600" : "text-gray-400"}`}>
          {lineCount} linha{lineCount === 1 ? "" : "s"}
          {question.maxLines !== null ? ` de ${question.maxLines}` : ""}
          {overLimit ? " — acima do limite" : ""}
        </p>

        {!revealed ? (
          <button
            onClick={props.onSubmit}
            disabled={answerText.trim().length === 0}
            className="mt-5 w-full bg-gradient-to-r from-[#26262c] to-[#26262c] text-white py-3 rounded-lg font-semibold hover:shadow-lg transition disabled:opacity-50 flex items-center justify-center gap-2"
          >
            <CheckCircle2 className="w-5 h-5" />
            Corrigir
          </button>
        ) : (
          <>
            {answerKey !== null && <RevealPanel answerKey={answerKey} />}

            <div className="mt-5">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Sua nota (0 a {question.maxPoints.toFixed(2)})
              </label>
              <input
                type="number"
                min={0}
                max={question.maxPoints}
                step={0.05}
                value={selfScore ?? ""}
                onChange={(e) => {
                  const parsed = parseFloat(e.target.value);
                  props.onSelfScoreChange(Number.isNaN(parsed) ? 0 : clampScore(parsed, question.maxPoints));
                }}
                placeholder="0,00"
                className="w-32 text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:border-[#16161a]"
              />
            </div>

            <AiPanel
              enabled={props.aiEnabled}
              result={props.aiResult}
              loading={props.aiLoading}
              error={props.aiError}
              maxPoints={question.maxPoints}
              onRequest={props.onRequestAi}
            />

            <button
              onClick={props.onNext}
              disabled={props.submitting}
              className="mt-6 w-full bg-gradient-to-r from-[#16161a] to-[#16161a] text-white py-3 rounded-lg font-semibold hover:shadow-lg transition disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {props.isLast ? "Finalizar" : "Próxima"}
              <ChevronRight className="w-5 h-5" />
            </button>
          </>
        )}
      </div>
    </div>
  );
}
