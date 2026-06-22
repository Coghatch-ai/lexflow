---
name: scrape-2fase
description: How LexFlow scrapes OAB 2ª-fase (discursive) exams from oabrj banco-provas into the DB — the import pipeline, commands, resolver behavior, DB tables, and known caveats. Use when running, debugging, or extending the 2ª-fase scrape/import.
---

# Scrape: OAB 2ª-fase (discursive) import

Given an exam + area, resolve the prova (caderno) + gabarito (padrão) PDFs from
`oabrj.org.br/banco-provas`, have a Claude Code agent read them, and upsert the extracted
questions (1 peça prático-profissional + 4 discursivas, with official model answers) into
the DB. This documents what currently exists — keep it factual; grow it as the pipeline grows.

## Run it

Two-step gate (extract → review → save), one area at a time:

```bash
pnpm import:2fase:extract --exam <EXAM> --area <AREA> --year <YEAR>
# review scripts/out/<exam>-<area>.draft.json
pnpm import:2fase:save scripts/out/<exam>-<area>.draft.json
```

- Slash-command wrapper for the same flow: `/extract-2fase <EXAM> <AREA> <YEAR>`
- Sync picklists only (e.g. QUESTION_TYPE): `pnpm db:seed-lov`

## Inputs

- **EXAM** — matched word-boundary against the page section title.
  `XL` → "XL Exame Unificado - 2ª Fase"; `XXXIX` → "XXXIX Exame Unificado - 2ª Fase".
- **AREA** (DISCIPLINE codes): `CIVIL_LAW`, `CRIMINAL_LAW`, `TAX_LAW`, `LABOR_LAW`,
  `CONSTITUTIONAL_LAW`, `ADMINISTRATIVE_LAW`, `COMMERCIAL_LAW`.
- **YEAR** — integer (metadata). XL and XXXIX 2ª fase = 2024.

## How it works (files)

- `scripts/lib/banco-provas.ts` — Playwright resolver. Headless Chromium loads the JS listing
  (plain HTTP 403s). Finds the `section.oabrj-section-subitem` whose `<h4>` title matches the
  exam token AND is 2ª fase. Inside, links are grouped under `<strong>` labels ("Cadernos de
  prova" then "Gabarito"/"Padrão de resposta"), one `<a>` per area; the area is matched by
  **link text** ("Direito Civil") — the href is an opaque UUID. PDFs download via the browser
  context (shares UA/cookies → avoids 403).
- `scripts/import-2fase-extract.ts` — resolves PDFs, writes them to a temp dir, runs
  `@anthropic-ai/claude-agent-sdk` `query()` (model `claude-opus-4-8`, `allowedTools: ["Read"]`,
  `maxTurns: 40`) which reads the PDFs and returns JSON. Writes the draft. **Auth: reuses the
  local Claude Code login — no API key.**
- `scripts/import-2fase-save.ts` — idempotent upsert (deterministic ids) into
  `oab_discursive_questions` + tracker row in `oab_discursive_imports`.
- `shared/domain/discursive-question.ts` — zod schemas + `toRows`/`toImportRow`.

## DB

- `oab_discursive_questions` — peça (`order_index` 0) + 4 discursivas (1–4); `model_answer`,
  `max_points` (5 / 1.25), `legal_basis`, `topic`. Global, not user-scoped.
- `oab_discursive_imports` — one row per (exam, area): `item_count`, `model_answer_count`,
  `prova_url`, `padrao_url`, `last_upd_at`. The "what's already extracted" tracker.
- `QUESTION_TYPE` LOV: `PECA_PRATICA`, `DISCURSIVE`.

## Imported so far

- XL Exame Unificado - 2ª Fase — 7/7 areas.
- XXXIX Exame Unificado - 2ª Fase — 7/7 areas.

(70 questions, 14 tracker rows; all 5/5 with model answers. Append new exams here as you import them.)

## What's on the page (47 "2ª-fase" sections, confirmed)

- **Roman "Exame Unificado / Exame de Ordem - 2ª Fase" (≈ X … XL)** — the in-scope format.
  One section per exam, `<strong>` groups "Cadernos de prova" + "Gabarito", one `<a>` per area;
  hosts vary (s.oab.org.br, cloudfront, www.oabrj.org.br/arquivos/files). **Importable as-is.**
  - Available (not yet imported): XXXVII, XXXVI, XXXV, XXXIV, XXXIII, XXXII, XXXI, XXX, … down to ~XV.
  - **XXXVIII is absent** from the portal (the page jumps XXXIX → XXXVII).
- **XX, XIX** — no `<strong>` groups (7 links): prova resolves but **no padrão** (model answers empty).
- **Arabic "33º … 42º Exame de Ordem - 2ª Fase"** — ancient CESPE-era exams (2008–2010),
  external `cespe.unb.br` hosts, different structure. **Out of scope** — not the peça + 4
  discursivas format; don't import.

## Known caveats / open

- `maxTurns: 40` — long padrão PDFs need several Read turns. If you hit "Reached maximum number
  of turns", raise it in `import-2fase-extract.ts`.
- A draft with empty `modelAnswer` → the resolver didn't find a gabarito group ("downloaded
  prova (no padrão found)") — expected for the no-`<strong>` exams (XX/XIX).
- The page lists some exams twice (e.g. XXXIII); the "no match" error dedupes the list.
- GitHub: posting to the private repo needs the `arthur-coghatch` account
  (`gh auth switch --user arthur-coghatch`). The 2ª-fase tracking issue is **#5**.

## Verify

- `pnpm check && pnpm lint && pnpm test`
- Tracker: `SELECT area, item_count, model_answer_count FROM oab_discursive_imports ORDER BY exam_label, area;`
