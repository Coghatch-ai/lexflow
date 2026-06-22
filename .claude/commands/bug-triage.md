---
description: Triage a GitHub issue — bug or new request? Labels it and posts a pt-BR comment.
argument-hint: <issue-number>   e.g. 14   (or paste a problem description)
---

Use the **bug-triage** agent (Agent tool, `subagent_type: "bug-triage"`) to triage `$ARGUMENTS`.

- If `$ARGUMENTS` is an issue number (e.g. `14` or `#14`), pass it through for full triage:
  the agent classifies it as bug vs. new request, applies the right label, and posts a pt-BR
  comment on `Coghatch-ai/lexflow`.
- If `$ARGUMENTS` is a free-text problem description (no number), pass it through too — the agent
  will classify it and show the comment it _would_ post, without touching GitHub.
- If `$ARGUMENTS` is empty, ask which issue number to triage.

Relay the agent's final triage summary back to me.
