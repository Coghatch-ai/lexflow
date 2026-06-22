// app/src/components/discursive/DiscursiveResult.tsx
//
// Post-run summary: per-item self-scores, and for a full prova the total out of
// 10 with a pass/fail badge (threshold 6,0). Keeps formulas in the shared domain
// (sumScores / isProvaPass / PROVA_MAX_POINTS).

import type { ReactElement } from "react";
import { isProvaPass, PROVA_MAX_POINTS, sumScores } from "@shared/domain/discursive-attempt";
import type { CollectedAnswer, DiscursiveQuestion, Lov } from "./types";

interface ResultProps {
  mode: "single" | "prova";
  answers: CollectedAnswer[];
  questions: DiscursiveQuestion[];
  questionTypeLov: Lov;
  onRestart: () => void;
  onSwitchMode: () => void;
}

export default function DiscursiveResult({
  mode, answers, questions, questionTypeLov, onRestart, onSwitchMode,
}: ResultProps): ReactElement {
  const byId = new Map(questions.map((q) => [q.id, q]));
  const total = sumScores(answers.map((a) => a.selfScore));
  const passed = isProvaPass(total);

  return (
    <div className="space-y-6">
      <div className="bg-gradient-to-r from-[#16161a] to-[#16161a] rounded-xl p-6 text-white">
        <h3 className="text-2xl font-bold mb-2">{mode === "prova" ? "Prova finalizada!" : "Sessão concluída!"}</h3>
        <p className="text-white/80">Suas respostas foram salvas.</p>
      </div>

      {mode === "prova" && (
        <div className="grid md:grid-cols-2 gap-4">
          <div className="bg-white rounded-xl p-6 shadow text-center">
            <div className="text-4xl font-bold text-[#16161a] mb-2">
              {total.toFixed(2)}<span className="text-xl text-gray-400"> / {PROVA_MAX_POINTS.toFixed(0)}</span>
            </div>
            <p className="text-gray-600">Sua nota (autoavaliação)</p>
          </div>
          <div className="bg-white rounded-xl p-6 shadow text-center flex flex-col items-center justify-center">
            <span className={`inline-block px-4 py-1.5 rounded-full text-sm font-bold ${
              passed ? "bg-[#3f7a52]/10 text-[#3f7a52]" : "bg-red-50 text-red-600"
            }`}>
              {passed ? "Aprovado (≥ 6,0)" : "Abaixo de 6,0"}
            </span>
            <p className="mt-3 text-sm text-gray-500">Nota mínima de aprovação: 6,0</p>
          </div>
        </div>
      )}

      <div className="bg-white rounded-xl p-6 shadow">
        <h4 className="text-lg font-bold text-[#16161a] mb-4">Resumo</h4>
        <div className="space-y-2">
          {answers.map((a, idx) => {
            const q = byId.get(a.questionId);
            const max = q?.maxPoints ?? 0;
            return (
              <div key={a.questionId} className="p-3 rounded-lg border-l-4 border-[#16161a]/20 bg-gray-50 flex items-center justify-between">
                <div>
                  <p className="font-medium text-gray-800">
                    {idx + 1}. {q !== undefined ? questionTypeLov.labelOf(q.questionType) : "Questão"}
                  </p>
                  {q?.topic !== null && q?.topic !== undefined && (
                    <p className="text-sm text-gray-500">{q.topic}</p>
                  )}
                </div>
                <div className="text-right text-sm">
                  <p className="font-semibold text-[#16161a]">
                    {a.selfScore !== null ? a.selfScore.toFixed(2) : "—"} / {max.toFixed(2)}
                  </p>
                  {a.ai !== null && <p className="text-xs text-[#3f7a52]">IA: {a.ai.score.toFixed(2)}</p>}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="flex gap-3">
        <button onClick={onSwitchMode} className="flex-1 bg-gray-200 text-gray-700 py-3 rounded-lg font-semibold hover:bg-gray-300 transition">
          Trocar modo
        </button>
        <button onClick={onRestart} className="flex-1 bg-gradient-to-r from-[#26262c] to-[#26262c] text-white py-3 rounded-lg font-semibold hover:shadow-lg transition">
          {mode === "prova" ? "Nova prova" : "Praticar mais"}
        </button>
      </div>
    </div>
  );
}
