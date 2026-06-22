---
description: Extract OAB 2ª-fase questions for an exam + area from oabrj banco-provas into the DB
argument-hint: <EXAM> <AREA_CODE> <YEAR>   e.g. XL CIVIL_LAW 2024
---

The arguments are `$ARGUMENTS` — three space-separated values in this exact order:
**EXAM AREA_CODE YEAR** (e.g. `XL CIVIL_LAW 2024` → EXAM=`XL`, AREA_CODE=`CIVIL_LAW`, YEAR=`2024`).
Parse those three values before doing anything; if any is missing, ask for it.

Run the OAB 2ª-fase import pipeline for that EXAM / AREA_CODE / YEAR. Two-step gate
(extract → review → save):

1. Run the extractor (substitute the parsed values):

   ```bash
   pnpm import:2fase:extract --exam <EXAM> --area <AREA_CODE> --year <YEAR>
   ```

   - It resolves the caderno + gabarito PDFs from oabrj.org.br/banco-provas via Playwright,
     then a Claude Code agent reads them (uses my login — no API key) and writes a draft to
     `scripts/out/<exam>-<area>.draft.json`.
   - If `--exam` matches no section, the error lists the available 2ª-fase exams — surface it.

2. **Review before saving.** Read the draft and show me a compact summary:
   item count (expect 1 peça `PECA_PRATICA` + 4 `DISCURSIVE`), each item's `topic`,
   and how many have a non-empty `modelAnswer` / `legalBasis`. Flag anything that looks off
   (missing padrão, wrong count, truncated statement). Let me edit the JSON if needed.

3. After my OK, save:

   ```bash
   pnpm import:2fase:save scripts/out/<the-draft-file>.json
   ```

   This upserts `oab_discursive_questions` and records the tracker row in
   `oab_discursive_imports` (idempotent — safe to re-run).

4. Report the saved row count and the tracker line (`imp-… (N items, M with padrão)`).

**Area codes:** CIVIL_LAW, CRIMINAL_LAW, TAX_LAW, LABOR_LAW, CONSTITUTIONAL_LAW,
ADMINISTRATIVE_LAW, COMMERCIAL_LAW.

Notes:

- `--exam` is matched word-boundary against the section title (`XL` → "XL Exame Unificado - 2ª Fase").
- Older exams use a different PDF host pattern (`oabrj.org.br/arquivos/files/...`); the resolver
  already matches `arquivos/` + `.pdf`, but if an older exam fails to resolve, the fetch in
  `scripts/lib/banco-provas.ts` may need a small adjustment — call it out, don't force it.
- Auth, deps, schema: see the pipeline in `scripts/import-2fase-*.ts` + `scripts/lib/banco-provas.ts`.
