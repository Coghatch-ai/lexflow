# Admin Questions — use the full width

**Goal** — the `/admin/questions` questions table uses the full window width instead of
being boxed in a centered 78rem column, and the Enunciado column gets the reclaimed space.

**Scope (in)**

- Make the `/admin/questions` page break out of the global `max-w-[78rem] mx-auto`
  container (Layout.tsx:204) so its content spans the full viewport width (with sane
  side padding), on this page ONLY. No edit to `Layout.tsx` (shared by every page).
- Widen the **Enunciado** column so it consumes the reclaimed horizontal space — drop the
  `max-w-xs` cap on that cell; keep it the flexible column (other columns stay
  `whitespace-nowrap` / fixed).

**Scope (out)**

- Widening other admin pages (algorithm, calendar) — user chose page-local only.
- Changing the global 78rem cap / `Layout.tsx` — would hit every page (study, stats); out.
- Row density change — not requested this slice (parked).
- Page size change (stays 50) — not requested (parked).
- Filter bar rework — not requested (parked).
- Adding/removing columns — not requested.
- Un-quarantining `AdminPage` lint / `max-lines-per-function` refactor — separate work.

**Business rules / product facts**

- None new. Pure presentation/UX change; no product-intent rule surfaced in interview.

**Acceptance**

- On a ≥1400px-wide viewport at `/admin/questions`, the questions table's right edge sits
  near the window's right padding, NOT at ~1248px centered — measurable: table container
  width > 78rem (1248px) and left/right dead-space gutters are roughly equal to the page
  padding, not hundreds of px each.
- The **Enunciado** cell no longer carries `max-w-xs`; on a wide viewport the question-text
  column is visibly the widest column and shows more text per row than before (still may
  clamp lines — clamp behavior unchanged unless trivially adjusted).
- Every OTHER page (e.g. `/stats`, `/study`, `/admin/algorithm`) is UNCHANGED — still
  centered at `max-w-[78rem]`. [verify by loading one other page]
- On a narrow/mobile viewport the page still fits (no horizontal overflow beyond the
  existing `overflow-x-auto` table scroll); side padding preserved. [human check]
- `pnpm check` + `pnpm lint` still pass (AdminPage stays within its existing quarantine —
  the change must not push it into new lint violations). [verify]

**Skill notes**

- `docs/conventions.md`: no-duplication rule — prefer a small page-scoped wrapper/util over
  copying container classes ad hoc; reuse `lex-*`/`ink`/`paper`/`line`/`surface` tokens,
  Tailwind 3 syntax (no Tailwind-4-only utilities).
- `AdminPage.tsx` is lint-QUARANTINED for `max-lines-per-function`. Keep the diff minimal;
  do NOT trigger new lint errors. The full-width breakout should be achieved without
  ballooning the component (ideally a wrapper `div` with negative-margin / full-bleed
  classes, or a tiny shared layout helper), not a large restructure.
- pt-BR user-facing text unchanged; English code/classes.

**Applied recommendations**

| Decision             | What I applied                                                        | Why                                                                                                   |
| -------------------- | --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Full-bleed technique | Page-scoped breakout (wrapper div / helper), NOT editing `Layout.tsx` | User chose page-local scope; `Layout.tsx` is shared by all pages so editing it would widen everything |
| Enunciado width      | Remove `max-w-xs` from the Enunciado cell, let it be the flex column  | User selected "Enunciado column too narrow"; it's the natural sink for reclaimed width                |
| Line clamp           | Keep `line-clamp-2` unless it reads badly after widening              | Not asked to change row height/clamp; density parked                                                  |

**Later**

- Denser rows / configurable page size (>50).
- Widen admin algorithm + calendar pages the same way (shared helper).
- Un-quarantine `AdminPage` (`max-lines-per-function` refactor per conventions playbook).
- Filter bar layout polish.

**Open questions** — none blocking.
