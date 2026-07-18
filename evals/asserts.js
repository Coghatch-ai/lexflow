// evals/asserts.js — deterministic (free) assertions for the LexFlow OAB eval.
//
// Each export is a promptfoo `javascript` assert value: receives (output, context)
// and returns { pass, score, reason }.
//
// SOURCE contract: production responses must be valid JSON matching the shapes
// defined in shared/domain/ai-eval.ts (ExplainResult / GradeResult).
// These asserts catch structural regressions without an LLM judge call.

"use strict";

/**
 * Validates that the model output is valid JSON with the oab-explain shape:
 *   { whyCorrect: string, whyWrong: object, memoryTip: string, commonTraps: string }
 *
 * @param {string} output
 * @returns {{ pass: boolean, score: number, reason: string }}
 */
function isValidExplainJson(output) {
  let parsed;
  try {
    parsed = JSON.parse(typeof output === "string" ? output : JSON.stringify(output));
  } catch {
    return { pass: false, score: 0, reason: "Output is not valid JSON" };
  }

  const missing = [];
  if (typeof parsed.whyCorrect !== "string" || parsed.whyCorrect.trim() === "") {
    missing.push("whyCorrect (string)");
  }
  if (typeof parsed.whyWrong !== "object" || parsed.whyWrong === null || Array.isArray(parsed.whyWrong)) {
    missing.push("whyWrong (object with letter keys)");
  }
  if (typeof parsed.memoryTip !== "string" || parsed.memoryTip.trim() === "") {
    missing.push("memoryTip (string)");
  }
  if (typeof parsed.commonTraps !== "string" || parsed.commonTraps.trim() === "") {
    missing.push("commonTraps (string)");
  }

  if (missing.length > 0) {
    return {
      pass: false,
      score: 0,
      reason: `Missing or invalid fields: ${missing.join(", ")}`,
    };
  }
  return { pass: true, score: 1, reason: "Valid oab-explain JSON shape" };
}

/**
 * Validates that the model output is valid JSON with the oab-grade shape:
 *   { score: number, feedback: string }
 *
 * @param {string} output
 * @returns {{ pass: boolean, score: number, reason: string }}
 */
function isValidGradeJson(output) {
  let parsed;
  try {
    parsed = JSON.parse(typeof output === "string" ? output : JSON.stringify(output));
  } catch {
    return { pass: false, score: 0, reason: "Output is not valid JSON" };
  }

  if (typeof parsed.score !== "number") {
    return { pass: false, score: 0, reason: `score must be a number, got: ${typeof parsed.score}` };
  }
  if (typeof parsed.feedback !== "string" || parsed.feedback.trim() === "") {
    return { pass: false, score: 0, reason: "feedback must be a non-empty string" };
  }
  return { pass: true, score: 1, reason: "Valid oab-grade JSON shape" };
}

/**
 * Validates that the numeric score is within [0, maxPoints].
 * Reads maxPoints from context.vars (string → parsed as float).
 *
 * @param {string} output
 * @param {{ vars: Record<string, string> }} context
 * @returns {{ pass: boolean, score: number, reason: string }}
 */
function scoreInRange(output, context) {
  let parsed;
  try {
    parsed = JSON.parse(typeof output === "string" ? output : JSON.stringify(output));
  } catch {
    return { pass: false, score: 0, reason: "Output is not valid JSON" };
  }

  if (typeof parsed.score !== "number") {
    return { pass: false, score: 0, reason: "score field is not a number" };
  }

  const maxPoints = parseFloat(String(context.vars.maxPoints ?? "10"));
  if (isNaN(maxPoints)) {
    return { pass: false, score: 0, reason: "maxPoints var is not a number" };
  }

  if (parsed.score < 0 || parsed.score > maxPoints) {
    return {
      pass: false,
      score: 0,
      reason: `score ${parsed.score} is outside [0, ${maxPoints}]`,
    };
  }
  return {
    pass: true,
    score: 1,
    reason: `score ${parsed.score} is within [0, ${maxPoints}]`,
  };
}

/**
 * pt-BR language lock (borrowed from maggie-evals #145). Cheap negative check,
 * not a classifier: pt text reliably carries accents/ç or pt-only function
 * words; a reply with none of them but with English function words is the
 * English-drift regression. Runs on the JSON string values, not the keys.
 *
 * @param {string} output
 * @returns {{ pass: boolean, score: number, reason: string }}
 */
function isPtBr(output) {
  const text = typeof output === "string" ? output : JSON.stringify(output);
  if (text.trim() === "") return { pass: false, score: 0, reason: "resposta vazia" };
  const PT_MARKERS = /[áàâãéêíóôõúüç]|\b(você|voce|não|nao|com|uma|que|isso|mas|está|esta|seu|sua|pois|porque)\b/i;
  const EN_MARKERS = /\b(the|your|with|this|that|because|answer|correct|therefore)\b/i;
  if (PT_MARKERS.test(text)) return { pass: true, score: 1, reason: "pt-BR" };
  if (EN_MARKERS.test(text)) {
    return { pass: false, score: 0, reason: `respondeu em inglês: "${text.slice(0, 80)}"` };
  }
  return { pass: true, score: 1, reason: "sem marcadores de inglês" };
}

module.exports = { isValidExplainJson, isValidGradeJson, scoreInRange, isPtBr };
