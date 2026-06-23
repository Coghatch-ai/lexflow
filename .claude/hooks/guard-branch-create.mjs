#!/usr/bin/env node
/* global process */
// PreToolUse(Bash) guard: require user approval before creating a git branch.
// Returns permissionDecision "ask" for branch-creating commands; otherwise stays
// silent (allow). Listing/checking out existing branches, deleting, status, log,
// commit, push, etc. pass through untouched.
//
// Quoted strings and heredoc bodies are blanked to a placeholder BEFORE matching,
// so text inside a commit message (e.g. `git commit -m "... git checkout -b ..."`)
// can never trip the guard — only an actual branch-creating command token does.

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

  if (createsBranch(stripQuoted(cmd))) {
    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "ask",
          permissionDecisionReason:
            "Creating a git branch requires your approval (no-branch-without-approval hook). " +
            "Approve to create it, or deny to stay on the current branch.",
        },
      }),
    );
  }
  process.exit(0);
});

// Replace quoted strings and heredoc bodies with a harmless placeholder token so
// branch-pattern matching only sees actual command tokens, never message text.
// A placeholder (not empty) is used so a genuinely quoted branch name still counts
// as a name, e.g. `git branch "x"` -> `git branch Q` still matches the create form.
function stripQuoted(cmd) {
  let s = cmd;
  // Heredoc bodies first (e.g. `-m "$(cat <<'EOF' ... EOF)"`): <<EOF / <<'EOF' / <<-EOF
  s = s.replace(/<<-?\s*(['"]?)([A-Za-z_]\w*)\1[\s\S]*?\n[ \t]*\2\b/g, " Q ");
  // $'...' (ANSI-C, backslash escapes), then '...' (literal), then "..." (\" escapes)
  s = s.replace(/\$'(?:[^'\\]|\\.)*'/g, " Q ");
  s = s.replace(/'[^']*'/g, " Q ");
  s = s.replace(/"(?:[^"\\]|\\.)*"/g, " Q ");
  return s;
}

function createsBranch(cmd) {
  // `git checkout -b|-B <name>`
  if (/\bgit\s+checkout\b[^&|;\n]*\s-(b|B)\b/.test(cmd)) return true;
  // `git switch -c|-C|--create <name>`
  if (/\bgit\s+switch\b[^&|;\n]*\s(-(c|C)\b|--create\b)/.test(cmd)) return true;
  // `git worktree add` (creates a branch unless --detach)
  if (/\bgit\s+worktree\s+add\b/.test(cmd) && !/--detach\b/.test(cmd)) return true;
  // `git branch <name>` (creating) — but NOT list/delete/move/copy/describe forms
  if (/\bgit\s+branch\b/.test(cmd)) {
    const seg = cmd.match(/\bgit\s+branch\b[^&|;\n]*/)?.[0] ?? "";
    const nonCreate =
      /\s-(d|D|m|M|c|C|a|r|v|vv)\b/.test(seg) ||
      /\s--(delete|move|copy|list|all|remotes|verbose|show-current|merged|no-merged|contains|no-contains|edit-description|set-upstream-to|unset-upstream)\b/.test(
        seg,
      );
    const hasBareName = /\bgit\s+branch\b(?:\s+-{1,2}[\w-]+(?:=\S+)?)*\s+(?!-)\S+/.test(seg);
    if (hasBareName && !nonCreate) return true;
  }
  return false;
}
