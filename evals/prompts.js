// evals/prompts.js — CJS module loaded by promptfoo as file://prompts.js:oabExplainSystem etc.
//
// Extracts the production prompt strings live from api/lib/ai-prompts.ts via tsx.
// This means the eval ALWAYS reflects the real prompts — no divergent copy to maintain.
//
// SOURCE: api/lib/ai-prompts.ts → AI_PROMPTS["oab-explain"] / AI_PROMPTS["oab-grade"]
//
// promptfoo calls each exported function with { vars, provider } and expects a string.
// System + user are separate exports so promptfoo can compose them per its own format.

"use strict";

const { execSync } = require("child_process");
const path = require("path");

const REPO_ROOT = path.resolve(__dirname, "..");

// Lazily extract prompts once and cache.
let _prompts = null;
function getPrompts() {
  if (_prompts !== null) return _prompts;
  const script = `import { AI_PROMPTS } from './api/lib/ai-prompts.ts'; process.stdout.write(JSON.stringify(AI_PROMPTS))`;
  const raw = execSync(`node --import tsx/esm --eval "${script}"`, {
    cwd: REPO_ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  _prompts = /** @type {Record<string, {system:string,user:string,vars:string[],maxOutputTokens:number}>} */ (JSON.parse(raw));
  return _prompts;
}

// promptfoo prompt functions receive context = { vars, provider, ... }
// Return a string — for chat models promptfoo also accepts [{role,content}[]].

/** System prompt for oab-explain (1ª fase) */
function oabExplainSystem(_context) {
  return getPrompts()["oab-explain"].system;
}

/** User prompt for oab-explain — interpolate vars from the test case. */
function oabExplainUser(context) {
  const vars = context.vars;
  return getPrompts()["oab-explain"].user
    .replace("{{questionText}}", String(vars.questionText ?? ""))
    .replace("{{options}}", String(vars.options ?? ""))
    .replace("{{correctAnswer}}", String(vars.correctAnswer ?? ""))
    .replace("{{legalBasis}}", String(vars.legalBasis ?? ""));
}

/** System prompt for oab-grade (2ª fase) */
function oabGradeSystem(_context) {
  return getPrompts()["oab-grade"].system;
}

/** User prompt for oab-grade — interpolate vars from the test case. */
function oabGradeUser(context) {
  const vars = context.vars;
  return getPrompts()["oab-grade"].user
    .replace(/\{\{maxPoints\}\}/g, String(vars.maxPoints ?? ""))
    .replace("{{statement}}", String(vars.statement ?? ""))
    .replace("{{modelAnswer}}", String(vars.modelAnswer ?? ""))
    .replace("{{legalBasis}}", String(vars.legalBasis ?? ""))
    .replace("{{studentAnswer}}", String(vars.studentAnswer ?? ""));
}

/** System prompt for oab-tutor (per-question buddy) */
function oabTutorSystem(_context) {
  return getPrompts()["oab-tutor"].system;
}

/** User prompt for oab-tutor — interpolate vars from the test case. */
function oabTutorUser(context) {
  const vars = context.vars;
  return getPrompts()["oab-tutor"].user
    .replace("{{questionText}}", String(vars.questionText ?? ""))
    .replace("{{options}}", String(vars.options ?? ""))
    .replace("{{correctAnswer}}", String(vars.correctAnswer ?? ""))
    .replace("{{userAnswer}}", String(vars.userAnswer ?? ""))
    .replace("{{explanation}}", String(vars.explanation ?? ""))
    .replace("{{legalBasis}}", String(vars.legalBasis ?? ""))
    .replace("{{request}}", String(vars.request ?? ""));
}

/** System prompt for oab-coach (weak-point digest) */
function oabCoachSystem(_context) {
  return getPrompts()["oab-coach"].system;
}

/** User prompt for oab-coach — interpolate vars from the test case. */
function oabCoachUser(context) {
  const vars = context.vars;
  return getPrompts()["oab-coach"].user.replace("{{studentData}}", String(vars.studentData ?? ""));
}

/**
 * Single chat prompt routed on vars.task — the ONLY prompt the eval should use.
 * Returns a [system, user] message pair so every test row gets the full
 * production prompt context. Listing system/user fragments as separate prompts
 * made promptfoo cross every test with every fragment (system alone = no
 * question, user alone = no schema) → 0% pass across the board.
 */
function oabChat(context) {
  const task = String(context.vars.task ?? "");
  if (task === "explain") {
    return [
      { role: "system", content: oabExplainSystem(context) },
      { role: "user", content: oabExplainUser(context) },
    ];
  }
  if (task === "grade") {
    return [
      { role: "system", content: oabGradeSystem(context) },
      { role: "user", content: oabGradeUser(context) },
    ];
  }
  if (task === "tutor") {
    return [
      { role: "system", content: oabTutorSystem(context) },
      { role: "user", content: oabTutorUser(context) },
    ];
  }
  if (task === "coach") {
    return [
      { role: "system", content: oabCoachSystem(context) },
      { role: "user", content: oabCoachUser(context) },
    ];
  }
  throw new Error(`Unknown task var: "${task}" (expected "explain", "grade", "tutor" or "coach")`);
}

module.exports = {
  oabChat,
  oabExplainSystem,
  oabExplainUser,
  oabGradeSystem,
  oabGradeUser,
  oabTutorSystem,
  oabTutorUser,
  oabCoachSystem,
  oabCoachUser,
};
