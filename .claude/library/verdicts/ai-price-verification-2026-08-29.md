---
type: verdict
title: "AI provider price sheet — independent first-party verification (2026-08-29/30)"
description: "Hermes sheet holds — 15/15 price rows CONFIRMED against first-party pages; 3 UNVERIFIABLE items (gemini-1.5 retirement date, an OpenAI page last-updated date, long-context threshold absent from the pricing page itself). Do NOT treat as adopted into COST_OF_GOODS."
timestamp: 2026-08-30
resource: https://developers.openai.com/api/docs/pricing
---

# AI price verification — 2026-08-29/30

**Why** — a Hermes research price sheet was relayed as "verified, first-party cited" with zero
independent checking. This record is the independent check. Nothing here was written into
`shared/domain/cost-of-goods.ts`.

**Unit rule** — the table stores CENTS per 1M tokens; provider pages quote USD per 1M tokens.
Every row below prints both.

## OpenAI — https://developers.openai.com/api/docs/pricing (retrieved 2026-08-29/30, no last-updated date displayed)

The page has SHORT CONTEXT and LONG CONTEXT columns. Hermes quoted the SHORT-context column
only; the long-context column exists and is real money.

| Model id        | Claimed (short ctx)   | Page says (short ctx)                                      | Page says (long ctx)                                       | Verdict                                            |
| --------------- | --------------------- | ---------------------------------------------------------- | ---------------------------------------------------------- | -------------------------------------------------- |
| `gpt-5.6-sol`   | in $4.00 / out $20.00 | in $4.00/1M = 400 cents/1M · out $20.00/1M = 2000 cents/1M | in $8.00/1M = 800 cents/1M · out $30.00/1M = 3000 cents/1M | CONFIRMED (short); long-ctx tier omitted by Hermes |
| `gpt-5.6-terra` | in $2.00 / out $12.00 | in $2.00/1M = 200 cents/1M · out $12.00/1M = 1200 cents/1M | in $4.00/1M = 400 cents/1M · out $18.00/1M = 1800 cents/1M | CONFIRMED (short)                                  |
| `gpt-5.6-luna`  | in $0.20 / out $1.20  | in $0.20/1M = 20 cents/1M · out $1.20/1M = 120 cents/1M    | in $0.40/1M = 40 cents/1M · out $1.80/1M = 180 cents/1M    | CONFIRMED (short)                                  |
| `gpt-4o`        | in $2.50 / out $10.00 | in $2.50/1M = 250 cents/1M · out $10.00/1M = 1000 cents/1M | no long-ctx row                                            | CONFIRMED                                          |
| `gpt-4o-mini`   | in $0.15 / out $0.60  | in $0.15/1M = 15 cents/1M · out $0.60/1M = 60 cents/1M     | no long-ctx row                                            | CONFIRMED                                          |

**Model ids are REAL.** `https://developers.openai.com/api/docs/models` lists `gpt-5.6-sol`,
`gpt-5.6-terra`, `gpt-5.6-luna` (+ `gpt-5.6-cyber`, which Hermes missed) and states the alias
`gpt-5.6` → `gpt-5.6-sol`. `gpt-4o`/`gpt-4o-mini` are absent from that models page but priced,
un-flagged, on the pricing page — treat their lifecycle as unconfirmed.

**Claim (a) reasoning tokens** — CONFIRMED. `…/guides/reasoning`, verbatim: "While reasoning
tokens are not visible via the API, they still occupy space in the model's context window and are
billed as output tokens." Effort wording: "Lower effort favors speed and lower token usage, while
at higher effort the model thinks more completely" — i.e. effort drives token COUNT, not RATE.

**Claim (b) >272K** — CONFIRMED, but the 272K number is NOT on the pricing page. It is on the
model page `…/api/docs/models/gpt-5.6-sol`, verbatim: "Prompts with >272K input tokens are priced
at 2x input and 1.5x output for the full request." Consistent with the column arithmetic
(2x in / 1.5x out on all three 5.6 rows).

## Google — https://ai.google.dev/gemini-api/docs/pricing (page last updated 2026-08-28 UTC, retrieved 2026-08-30)

| Model                    | Input                                                                  | Output                                                                                                               | Verdict                                        |
| ------------------------ | ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| `gemini-3.7-flash`       | $0.75/1M = 75 cents/1M (→ $1.50/1M = 150 cents/1M on 2027-01-01)       | $3.75/1M = 375 cents/1M (→ $7.50/1M = 750 cents/1M on 2027-01-01)                                                    | CONFIRMED                                      |
| `gemini-3.6-flash`       | $0.75/1M = 75 cents/1M (→ $1.50/1M = 150 cents/1M on 2027-01-01)       | $3.75/1M = 375 cents/1M (→ $7.50/1M = 750 cents/1M on 2027-01-01)                                                    | CONFIRMED, incl. Hermes' $1.50/$7.50 2027 rate |
| `gemini-3.5-flash`       | $1.50/1M = 150 cents/1M                                                | $9.00/1M = 900 cents/1M                                                                                              | CONFIRMED                                      |
| `gemini-3.5-flash-lite`  | $0.30/1M = 30 cents/1M                                                 | $2.50/1M = 250 cents/1M                                                                                              | CONFIRMED                                      |
| `gemini-3.1-flash-lite`  | $0.25/1M = 25 cents/1M text/image/video; $0.50/1M = 50 cents/1M audio  | $1.50/1M = 150 cents/1M                                                                                              | CONFIRMED (audio tier omitted by Hermes)       |
| `gemini-3.1-pro-preview` | $2.00/1M = 200 cents/1M ≤200K; $4.00/1M = 400 cents/1M >200K           | $12.00/1M = 1200 cents/1M ≤200K; $18.00/1M = 1800 cents/1M >200K                                                     | CONFIRMED (>200K tier omitted by Hermes)       |
| `gemini-2.5-pro`         | $1.25/1M = 125 cents/1M ≤200K; $2.50/1M = 250 cents/1M >200K           | $10.00/1M = 1000 cents/1M ≤200K; $15.00/1M = 1500 cents/1M >200K                                                     | CONFIRMED (>200K tier omitted)                 |
| `gemini-2.5-flash`       | $0.30/1M = 30 cents/1M text/image/video; $1.00/1M = 100 cents/1M audio | $2.50/1M = 250 cents/1M                                                                                              | CONFIRMED (audio tier omitted)                 |
| `gemini-2.5-flash-lite`  | $0.10/1M = 10 cents/1M text/image/video; $0.30/1M = 30 cents/1M audio  | $0.40/1M = 40 cents/1M                                                                                               | CONFIRMED (audio tier omitted)                 |
| `gemini-omni-1.1-flash`  | $1.50/1M = 150 cents/1M                                                | $9.00/1M = 900 cents/1M text; $17.50/1M = 1750 cents/1M video ("Billing based on 5,792 tokens/second of 720p video") | CONFIRMED for text; video tier omitted         |

**Thinking tokens** — CONFIRMED. Every flash row labels its output column "Output price
(including thinking tokens)".

**Retirements** — `gemini-2.0-flash`: CONFIRMED, `https://ai.google.dev/gemini-api/docs/deprecations`
(last updated 2026-08-27 UTC) gives shutdown "June 1, 2026", replacement `gemini-3.6-flash`; the
models page lists it under "Previous models" as "(Shut down)". `gemini-1.5-flash` /
`gemini-1.5-pro`: **UNVERIFIABLE** — absent from the deprecations page, the models page, the
pricing page, and both Vertex pages tried (`docs.cloud.google.com/vertex-ai/generative-ai/docs/deprecations`,
last updated 2026-08-26 UTC, lists only the Vertex AI SDK GenAI module). They are gone, but the
claimed date **2025-09-24 is not on any first-party page I could load** — do not cite it.

## Contradiction with the existing library

`.claude/library/ai-pricing.md` (NOT edited by this run) requires "input and output rates
separately, in cents per 1M tokens", but `shared/domain/cost-of-goods.ts` today holds a single
BLENDED `tokens` rate per model and its five rows are all stale or dead:
`gpt-4o-mini: 45` (real: 15 in / 60 out), `gpt-4o: 750` (250 / 1000),
`gemini-2.0-flash: 20` (model SHUT DOWN 2026-06-01), `gemini-1.5-flash: 20` and
`gemini-1.5-pro: 350` (both retired/absent). Also unmodelled: OpenAI long-context 2x/1.5x above
272K, Gemini >200K tiers, Gemini audio-input tiers, the 2027-01-01 Gemini 3.6/3.7 doubling.
Resolving that is a separate, gated change.

## Verdict

The Hermes sheet's NUMBERS survive: 15/15 price rows CONFIRMED verbatim, all three `gpt-5.6-*`
ids real, both OpenAI billing claims true, the Gemini thinking-token claim true. What it got wrong
is COMPLETENESS, not accuracy — it presented single-tier rates for a multi-tier world
(long-context, >200K, audio, video, 2027) and it cited pages that do not carry the number it
attributed to them (the 272K threshold lives on the model page, not the pricing page). One claim,
the 1.5-series retirement date, is unverifiable first-party.
