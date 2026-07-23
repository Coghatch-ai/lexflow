# Handoff — LexFlow AI Student Buddy v1 (shipped 2026-07-22)

Repo: `/Users/arthurnunes/Library/MRHEWBUC-LOCAL/probius/lexflow` (GitHub `Coghatch-ai/lexflow`, branch `main`).
Status: **v1 SHIPPED and DEPLOYED to prod** (mobile.probius.app / api.probius.app). All code committed
and pushed; all three deploy workflows green. PRD + per-slice log: **issue #48** (read it — every slice
has a detailed comment). Migrations 0016–0020 applied to RDS.

**Owner's process complaint (read before continuing):** the research phase used plan mode + Opus
subagents properly, but slices 3–7 were implemented directly from chat directives with no per-feature
issues, no re-planning, no subagent review. The agreed correction going forward: **each open item gets
its own issuekit issue with a plan inside; no implementation before the owner approves that issue's
plan; subagent review pass before commits.** Do not repeat the drift.

---

## Product decisions (owner-stated, binding)

- Real value, no gimmicks. Moat = grounding in data ChatGPT can't see: the student's own error log,
  the 1,938-question curated bank (explanations + legal_basis), official 2ª-fase padrões. Every legal
  claim grounded + cited; the AI must admit gaps rather than invent law (students distrust ChatGPT
  precisely for hallucinated jurisprudência — 2025-26 lawyer sanctions).
- **Jurisprudência search: DROPPED** by owner ("attorney tool"). Súmulas matter only as exam-content
  grounding (v2 corpus).
- Kill list (do NOT build): write-my-peça, LLM-generated questions without validation pipeline,
  gamification/streaks/mascot, voice tutor, therapist persona, generic legal chatbot.
- Monetization: **pay-as-you-go credits**, aggressive/thin-margin pricing. Coupons are the only
  top-up until a purchase flow exists (owner: "use cupoms like maggie").
- OpenAI calls: **/v1/responses ONLY** (owner: "DONT USE CHAT COMPLETIONS").
- Infra must match the sibling free-tier template conventions (256/512MB, 30s, 7-day logs, esbuild,
  no provisioned concurrency).

## What was built (commits `0e7d81e..fd9d922` on main)

### Features (all mobile-first, apps/mobile PWA)

1. **Per-question tutor** — chips ("Por que errei?" wrong-only / "Explicar de outro jeito" /
   "Dar um exemplo") + one free-text follow-up (≤500 chars). Distractor-aware: prompt receives the
   student's chosen option. Thread persisted in `ai_tutor_messages`; each call is a stateless one-shot.
   Reply contract is **PLAIN TEXT** (was JSON — changed so streaming renders token-by-token);
   `parseTutorResponse` accepts both shapes. Component `AiTutorPanel.tsx`, mounted in
   `QuestionRunner.tsx` under the Comentário card.
2. **Weak-point coach ("Análise do Coach")** — `coach.generate/finalize/latest`; server assembles real
   aggregates (per-discipline accuracy w/ pt-BR labels, fast-wrong vs slow-wrong buckets = chute vs
   lacuna, recurring errors, SM-2 due, days-to-exam) → one-shot digest
   `{diagnosis, priorities[≤3 w/ severity], actions[≤3]}`; prompt forbids advice unanchored in the
   numbers. 24h cache (`ai_coach_digests`), refuses < 20 answered (`COACH_MIN_ANSWERED`).
   `CoachCard.tsx` on Progresso.
3. **Credits (pay-as-you-go)** — `credit_ledger` (balance = SUM(delta), `ref_id` unique = idempotency).
   Costs `shared/domain/credits.ts`: tutor 1 / coach 2 / grade 2 (ratios track measured LLM cost).
   Spend rail: `assertCredits` → enqueue → `debitCredits(refId=jobId)`. **Refund rail:** `relay.job`
   poll returning `status:error` auto-refunds idempotently (`refund:<jobId>`).
   **NO signup grant — deliberately removed** (farmable: delete acct → re-register → fresh grant;
   maggie #126). New users start at 0 credits.
4. **Coupons** (maggie #126 pattern verbatim) — global `coupons` table; `credits.redeem` with BOTH
   rails: atomic cap (`UPDATE ... WHERE redeemed_count < max AND not-expired RETURNING`) + per-user
   replay guard (`coupon:<code>:<userId>` unique; replay throws → rolls back the cap increment).
   `credits.mintCoupon`/`listCoupons` (admin) + CLI `pnpm db:mint-coupon <credits> [max] [code] [note]`.
   Redeem UI: tappable credits chip on Início (`CreditsChip.tsx`).
   **Live test coupon: `MCA3-U2TH` (200 credits × 5 redemptions).**
5. **Daily quota (anti-abuse backstop under credits)** — `ai_usage_daily` (user, day, `kind`
   'tutor'|'coach' — independent counters; the shared-counter bug was found and fixed in migration
   0018). Atomic upsert-increment at enqueue. Limits are PROVISIONAL agent guesses: 30 tutor / 3 coach.
6. **Treino focado (drill)** — `questions.focusedDrill`: deterministic, zero LLM — 6 recurring-error
   questions (≥2 answered ≥2 wrong) + top-up to 10 from weakest discipline (≥5 answered). Card on
   Início → immersive `/drill` (added to MobileLayout's immersive list). Hidden until enough data.
7. **Streaming Lambda** — `lexflow-stream-{env}`: non-VPC, Function URL `RESPONSE_STREAM`, CORS at the
   URL. **Ticket flow** (non-VPC can't reach RDS): tRPC `tutorAsk({stream:true})` assembles prompt +
   debits credits + writes `tickets/{jobId}.json` to the relay outbox bucket (prefix has **NO S3
   event** — relay never double-fires); browser POSTs `{jobId}` + Clerk Bearer to the Function URL;
   Lambda verifies JWT offline (`clerkAuthProvider`) and requires `sub === ticket.sub`; streams SSE
   deltas (OpenAI `/v1/responses` `response.output_text.delta`; Gemini `streamGenerateContent?alt=sse`);
   writes full text to `results/{userId}/{jobId}.json` → existing `tutorFinalize` + refund rails
   unchanged. Client `shared/lib/stream-tutor.ts`; falls back to polling when `VITE_AI_STREAM_URL`
   unset (local dev). Live URL:
   `https://abuw77bzn3s3mfz273r56tezpy0ezvwc.lambda-url.sa-east-1.on.aws/`
   (also the `StreamFunctionUrl` stack output; set as PROD env secret `VITE_AI_STREAM_URL`).
8. **Tappable legal references** — `shared/domain/legal-refs.ts` parses `legal_basis` free text into
   Planalto article deep-links (CF/88, CC, CPC, CP, CPP, CLT, CDC, CTN, EAOAB; `#artN`/`#artNa`
   anchors) + súmula court pages (STF/STJ/TST; vinculante → STF). Conservative: unknown laws are NEVER
   linked. `LegalRefs.tsx` chips under the Comentário; `reviewQueue` now selects `legal_basis`.
9. **OpenAI provider rewritten to /v1/responses** (`api/relay/providers.ts` `openaiComplete` +
   streaming variant): `instructions`/`input`/`max_output_tokens`/`text.format json_object`, and
   `reasoning:{effort:"none"}` sent ONLY for `gpt-5*` model ids (older models 400 on the param).
   `extractResponsesText` handles `output_text` + message-items shapes.

### Schema / migrations (all APPLIED to RDS, additive)

- 0016: `ai_usage_daily`, `ai_tutor_messages` · 0017: `ai_coach_digests` · 0018: quota `kind` column +
  unique(user,day,kind) · 0019: `credit_ledger` · 0020: `coupons`.
- New tables live in `drizzle/schema-ai.ts` (schema.ts hit the 500-line lint cap; barrel
  `export * from "./schema-ai"` keeps import paths + drizzle-kit single-entry unchanged — references
  to users/oab_questions are lazy so the circular import is safe). ALL have `TABLE_SCOPE` entries in
  `api/db/scope.ts` (coupons = global; rest = user).

### Prompts / evals

- `api/lib/ai-prompts.ts`: `oab-tutor` (plain text, `json:false`, 900 tok), `oab-coach` (JSON, 1200
  tok) added next to existing `oab-explain`/`oab-grade`. `PromptTemplate` gained optional `json` flag;
  `AiRelayPayload.json` is now boolean.
- Builders/parsers: `shared/domain/ai-tutor.ts`, `ai-coach.ts` (+tests). Flow orchestrators:
  `shared/lib/run-tutor-flow.ts`, `run-coach-flow.ts` (mirror `run-explanation-flow.ts`).
- `evals/`: promptfoo rows added — tutor "por que errei" (pegadinha rubric), tutor
  **grounding-honesty trap** (asks for a CPP article NOT in the material; rubric FAILS any invented
  citation), coach fast-wrong-profile rubric. `asserts.js`: `isValidCoachJson` added; tutor JSON assert
  removed (plain text now). **`pnpm eval` was NEVER RUN** (paid, 6 providers).

### Infra changes

- `template.yaml`: `LexFlowStreamFunction` + log group + Function URL (free-tier-matched); API role
  gained `s3:PutObject` on `tickets/*`; stream role: SSM read (relay prefix) + kms via ssm + tickets
  Get/Delete + results Put. `sam validate --lint` passes.
- **`infra/deploy-policy.json`**: added `lexflow-stream-*` to Lambda + Logs scopes AND applied live via
  `aws iam put-role-policy` (first Deploy API failed on `logs:CreateLogGroup` for the new group —
  root cause found in run logs, fixed, rerun green).
- `.github/workflows/deploy-mobile.yml`: passes `VITE_AI_STREAM_URL` (PROD env secret set via
  `gh secret set`).
- `scripts/mint-coupon.ts` needs `ssl: { rejectUnauthorized: false }` on the Pool (RDS pg_hba rejects
  unencrypted) — already fixed; remember for any new script.

### Also committed (separate commit, pre-existing work found uncommitted in the tree)

- `0e7d81e` "fix: backfill discipline codes + LOV/discipline-map hardening (#46)" — migration 0015,
  seed label→code mapping, discipline-map + tests, CLAUDE.md edits. NOT authored this session; it was
  sitting uncommitted and was committed separately to keep history clean.

## Verification state (be honest with the owner)

- `pnpm validate` green: 284 vitest tests, strict tsc (both tsconfigs), eslint `--max-warnings 0`.
- Deploys green (API incl. stream, App, Mobile). Stream Lambda smoke: unauthenticated POST →
  `ERRO: não autorizado` (JWT wall works).
- **NOT verified:** a real end-to-end streamed tutor answer in prod (needs a signed-in user);
  coach/tutor answer QUALITY (no eval run, no real usage); coupon redeem in prod UI; refund rail
  under a real provider failure.

## Cost model (verified vendor pricing 2026-07-21, full table on #48)

gpt-5.4-mini $0.75/$4.50 per 1M · gpt-5.6-luna $1.00/$6.00 (Fast class, effort:none SUPPORTED — the
old "forced reasoning" note is wrong) · gemini-3.1-flash-lite $0.25/$1.50 (cheapest by 3×) ·
gpt-5.4 full $2.50/$15 (skip — kills thin margin). Measured prompt sizes: tutor ~900in/~350out,
coach ~800/~500, grade ~1400/~500. Heavy student (15 tutor + 1 coach + 2 grades daily):
flash-lite ~R$2.40/mo · mini ~R$7.30 · luna ~R$9.50. Owner wants aggressive thin-margin pricing;
R$/credit is a pack-pricing decision, deliberately not in code.

## OPEN ITEMS

**Blocked on owner decisions:**

1. ~~Quota values~~ **RESOLVED — owner reframed the model (#50, single doc
   `docs/monetization.md`).** Owner does NOT want a daily anti-abuse quota. The 30 tutor / 3
   coach `ai_usage_daily` caps are to be **retired**. Real model (authoritative in
   `docs/monetization.md`): **two separate currencies** — an **allowance** covering CORE only
   (AI explanation phases 1 & 2, incl. `grade`) via the subscription, and **credits** covering
   everything else (buddy, coach, future). Free tier gets 1 core AI use/day. No payment gateway
   this build (coupons only). No hardcoded numbers — admin-editable table. `COACH_MIN_ANSWERED=20`
   left as-is (out of scope). Owner wants the rule as a real doc **in the code**, NOT in CLAUDE.md
   agent info. So slice-5's "PROVISIONAL 30/3 quota" is now WRONG — it's being removed.
2. Model choice — run `pnpm eval` (paid) and pick by quality; swap live via SSM
   `/lexflow/relay/prod/ai-provider` + model params, no redeploy.
3. Credit pack pricing + coupon/onboarding strategy (new users have 0 credits — distribute a welcome
   coupon or grant manually).
4. Payment provider for the purchase flow (Stripe / Mercado Pago-Pix / IAP) — coupons are the stopgap.

**Engineering (v2 backlog, each should become its own issuekit issue with a plan, per the corrected
process):** 5. E2E prod verification of streaming + coupon redeem + refund rail (first real user session). 6. Statute full-text ingest (top-5 disciplines) → swap external Planalto links for in-app article text. 7. Sub-topic taxonomy: one-time LLM classification of the 1,938 questions → `oab_questions.sub_topic`
(unlocks precise drills/coaching). 8. Súmulas corpus ingest (STJ dados abertos, CC-BY) as grounding — NOT a search product. 9. Discursive (2ª fase) on mobile — port existing `ai.grade` UI + add the structural anti-zero checker
(wrong peça type / missing fundamentação / self-ID / no subitems). 10. Simulado post-mortem (trap-vs-gap + pacing). 11. Citation-fidelity eval gating prompt changes (the grounding promise must not regress). 12. Housekeeping: delete stale `HANDOFF-discursive-ai.md`; document the AI surface (buddy, credits,
streaming, quota) in lexflow `CLAUDE.md`; known edge — job that never returns (S3 lifecycle purge)
is never refunded; concurrent-debit race can overspend by one action (accepted, single-user).

## Watch out for

- Shared AWS account 394559824800, sa-east-1. Deploys are GitHub-Actions-only; the ONE allowed local
  IAM action was the put-role-policy bootstrap fix. Never `sam deploy` from a laptop.
- tRPC + strict TS quirk: returning a UNION from a procedure stripped `| null` from fields on the
  client (eslint no-unnecessary-condition false-flags). Fix used in `questions.focusedDrill`: single
  explicit return type (`Promise<FocusedDrill>`), no union. Remember for new procedures.
- Tutor/finalize contract: client NEVER supplies model text — finalize re-reads
  `results/{userId}/{jobId}.json` server-side. Keep this for every new AI surface.
- `tickets/` prefix must never get an S3 event (double-processing).
- gpt-5.6 family on `/chat/completions` 400s with tools+effort≠none — irrelevant while we use
  `/v1/responses`, relevant if anyone regresses the provider.
