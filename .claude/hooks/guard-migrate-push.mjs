#!/usr/bin/env node
/* global process */
// PreToolUse(Bash) guard: block an AGENT `git push` when a drizzle migration SQL
// file on disk was never applied locally (so the pushed schema change would ship
// ahead of any run migration). Only gates pushes the agent runs through the Bash
// tool — the human's own terminal `git push` is untouched (this is a Claude Code
// hook, NOT a .git/hooks or husky hook, on purpose).
//
// Logic: on `git push`, read drizzle/meta/_applied.json (written atomically at the
// end of a SUCCESSFUL `pnpm db:migrate`) and compare it to the set of drizzle/*.sql
// files on disk. Any .sql not in the marker — or the marker missing while
// migrations exist — BLOCKS the push, naming the unapplied file(s). All applied →
// allow (stay silent).
//
// Escape hatch: MIGRATE_GUARD_SKIP=1 bypasses the guard intentionally.
// Fail-open on the guard's OWN errors (parse/read failures → exit 0, allow),
// matching guard-branch-create.mjs — the guard never wedges a push on its own bug.

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (c) => (input += c));
process.stdin.on("end", () => {
  let cmd = "";
  try {
    cmd = JSON.parse(input)?.tool_input?.command ?? "";
  } catch {
    process.exit(0); // can't parse → don't block
  }

  if (process.env["MIGRATE_GUARD_SKIP"] === "1") process.exit(0);
  if (!isGitPush(stripQuoted(cmd))) process.exit(0);

  let unapplied;
  try {
    unapplied = findUnapplied();
  } catch {
    process.exit(0); // guard's own error → fail open (allow)
  }

  if (unapplied.length > 0) {
    const list = unapplied.map((f) => `  • ${f}`).join("\n");
    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "deny",
          permissionDecisionReason:
            `Push blocked: ${unapplied.length} migration(s) not applied locally:\n${list}\n` +
            "Run `pnpm db:migrate` to apply them, then push again. " +
            "(Intentional bypass: set MIGRATE_GUARD_SKIP=1.)",
        },
      }),
    );
  }
  process.exit(0);
});

// Replace quoted strings and heredoc bodies with a placeholder so `git push`
// matching never trips on message/heredoc text (e.g. a commit body mentioning
// "git push"). Mirrors guard-branch-create.mjs.
function stripQuoted(cmd) {
  let s = cmd;
  s = s.replace(/<<-?\s*(['"]?)([A-Za-z_]\w*)\1[\s\S]*?\n[ \t]*\2\b/g, " Q ");
  s = s.replace(/\$'(?:[^'\\]|\\.)*'/g, " Q ");
  s = s.replace(/'[^']*'/g, " Q ");
  s = s.replace(/"(?:[^"\\]|\\.)*"/g, " Q ");
  return s;
}

function isGitPush(cmd) {
  return /\bgit\s+push\b/.test(cmd);
}

// Returns the sorted list of drizzle/*.sql filenames NOT present in the applied
// marker. Marker missing while migrations exist → every migration is unapplied.
function findUnapplied() {
  const projectDir = process.env["CLAUDE_PROJECT_DIR"] ?? process.cwd();
  const drizzleDir = path.join(projectDir, "drizzle");
  const markerPath = path.join(drizzleDir, "meta", "_applied.json");

  const onDisk = readdirSync(drizzleDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  if (onDisk.length === 0) return [];

  let applied = [];
  try {
    const parsed = JSON.parse(readFileSync(markerPath, "utf8"));
    if (Array.isArray(parsed)) applied = parsed;
  } catch {
    applied = []; // marker missing/unreadable → treat all migrations as unapplied
  }

  const appliedSet = new Set(applied);
  return onDisk.filter((f) => !appliedSet.has(f));
}
