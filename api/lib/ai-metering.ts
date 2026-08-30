// api/lib/ai-metering.ts
//
// The DELIVERED-ONLY metering door for the AI call sites (D4, epic #50) — now
// AUTHORITATIVE. Each AI surface (grade / explanation / tutor / coach / admin
// generateExplanation) settles its spend AFTER the relay result is re-read
// server-side (delivery is authoritative here, never client-asserted).
//
// ATOMIC CONSUME+CHARGE (Codex #61, all 5 doors): every persisted-AI-output door now
// routes through consumeAndCharge() below. The door opens ONE db.transaction, persists
// its target write on that tx, and calls consumeAndCharge(tx=…) — which claims a
// single-use ai_job_consumption marker BOUND to the target AND runs charge(tx=…) in
// that same transaction. So the target write, the consume marker, and the ledger +
// balance write all commit or roll back as ONE unit: a persisted AI output can never
// outlive its charge, and one job can back at most one target (a replay onto a
// DIFFERENT target is rejected; onto the SAME target it is an idempotent no-op).
//
// The old split-persist + best-effort background-retry settle path is REMOVED: no door
// persists AI output before charging any more, so the delivered-but-unsettled window it
// guarded against no longer exists.

import { sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { charge, type CreditTx } from "./credit-charge";
import { assertExternalRefId } from "../../shared/domain/credit-reserved";
import { costFor, hasCostRate, type Usage } from "../../shared/domain/cost-of-goods";

// ── parseAiResult — the ONE place a relay/stream result becomes billable facts ─
//
// #98: the doors used to meter a HARDCODED token count against a GLOBAL default
// model. Both are gone. The model and the token counts now come from the result
// the sender wrote server-side (never from the tRPC input — a client-chosen
// model would be a free-call lever now that an unpriceable call costs 0).
//
// PRICING NEVER FAILS THE USER'S ACTION. Credit is admitted at the door
// (`admit`, balance > 0) BEFORE the call; charging happens on the way back. So a
// result we cannot price is NOT a delivery failure: it is delivered, persisted,
// and charged 0 — visibly (`:unmetered` source + console.error). The ONE
// condition that still fails is missing/empty TEXT: nothing was delivered.
// NEVER estimate a token count to fill the gap.

/** Why a delivered result could not be priced. Terminal for that refId. */
export type UnpricedReason = "usage-missing" | "usage-invalid" | "model-missing" | "no-rate-row";

/** The billable facts of one delivered AI call — a TOTAL discriminated union. */
export type AiMetering =
  | { readonly kind: "priced"; readonly model: string; readonly usage: Usage }
  | { readonly kind: "unpriced"; readonly model: string | null; readonly reason: UnpricedReason };

/** A parsed relay/stream result: the delivered text plus its metering facts. */
export type ParsedAiResult = { readonly text: string } & AiMetering;

function tokenCount(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

/**
 * Parse (never cast — the backend is max-strict) a relay/stream result payload
 * into the delivered text + the facts a charge is computed from.
 *
 * THROWS only for a missing/empty `text` (BAD_GATEWAY — nothing was delivered,
 * exactly what the doors already do when their response parser returns null).
 * Every metering problem is a `kind: "unpriced"` REFUSAL TO PRICE, never a
 * refusal to serve: `usage` absent → "usage-missing"; a non-finite/negative
 * counter or a zero total → "usage-invalid"; `model` absent/empty →
 * "model-missing"; a model with no rate row → "no-rate-row".
 */
export function parseAiResult(data: unknown): ParsedAiResult {
  const record = typeof data === "object" && data !== null ? (data as Record<string, unknown>) : {};
  const rawText = record["text"];
  const text = typeof rawText === "string" ? rawText : "";
  if (text.length === 0) {
    throw new TRPCError({ code: "BAD_GATEWAY", message: "A IA não retornou uma resposta" });
  }

  const rawModel = record["model"];
  const model = typeof rawModel === "string" && rawModel.length > 0 ? rawModel : null;
  const rawUsage = record["usage"];

  if (typeof rawUsage !== "object" || rawUsage === null) {
    return { kind: "unpriced", text, model, reason: "usage-missing" };
  }
  const usageRecord = rawUsage as Record<string, unknown>;
  const inputTokens = tokenCount(usageRecord["inputTokens"]);
  const outputTokens = tokenCount(usageRecord["outputTokens"]);
  if (inputTokens === null || outputTokens === null || inputTokens + outputTokens === 0) {
    return { kind: "unpriced", text, model, reason: "usage-invalid" };
  }
  if (model === null) {
    return { kind: "unpriced", text, model: null, reason: "model-missing" };
  }
  if (!hasCostRate(model)) {
    return { kind: "unpriced", text, model, reason: "no-rate-row" };
  }
  return { kind: "priced", text, model, usage: { inputTokens, outputTokens } };
}

/** Project a parsed result down to just its billable facts (drops the text), so
 *  what reaches consumeAndCharge is exactly what a charge is computed from. */
export function meteringOf(parsed: ParsedAiResult): AiMetering {
  return parsed.kind === "priced"
    ? { kind: "priced", model: parsed.model, usage: parsed.usage }
    : { kind: "unpriced", model: parsed.model, reason: parsed.reason };
}

// ── Atomic consume+charge (Codex #61 round 3) ─────────────────────────────────
//
// Closes two billing-integrity holes at once, both flagged HIGH:
//  (1) REPLAY ACROSS TARGETS: a done jobId could be replayed with a different
//      answer/question to persist AI output onto MANY records while charge()'s
//      refId-idempotency blocked the extra charges → one paid job backing many
//      outputs. Fixed by a DURABLE single-use marker (ai_job_consumption) keyed by
//      the charge refId and BOUND to its one target: a second consume of the same
//      jobId onto a DIFFERENT target is REJECTED; onto the SAME target it is an
//      idempotent replay (persist + charge already committed once).
//  (2) SPLIT PERSIST/SETTLE: the old path wrote the AI fields, THEN best-effort
//      settled (a background retry on failure) → a crash before the retry left output
//      persisted with no durable charge. Fixed by charging INSIDE the caller's tx
//      (charge accepts params.tx), so the AI-field UPDATE/INSERT, the consume marker,
//      and the charge() ledger+balance write all commit or roll back as ONE unit.
//
// The caller opens ONE db.transaction, persists the AI fields on `tx`, then calls
// this with that same `tx`. On "first" it has claimed the marker AND charged; on
// "replay" the marker already existed for the SAME target (idempotent no-op — the
// prior tx already persisted+charged). A different-target replay THROWS (CONFLICT)
// which rolls the caller's tx back, so nothing is persisted on a rejected replay.

export interface ConsumeAndChargeParams {
  /** The caller's open transaction — persist + marker + charge share this ONE tx. */
  readonly tx: CreditTx;
  readonly userId: string;
  /** The relay jobId being consumed (stored on the marker for audit/forensics). */
  readonly jobId: string;
  /** The record the AI output is persisted onto (answerId / questionId). The marker
   *  is BOUND to this — a replay of the same job onto a different target is rejected. */
  readonly targetId: string;
  readonly source: string;
  /** Idempotency identity shared by the marker (PK) AND charge() (`grade:<jobId>` …).
   *  The `:unmetered` suffix goes on `source` ONLY — never here, so the
   *  idempotency identity is the same whether the call priced or not. */
  readonly refId: string;
  /** The billable facts from parseAiResult — REAL model + REAL tokens, or the
   *  reason they are unavailable. Never a default, never an estimate. */
  readonly metering: AiMetering;
}

/**
 * Claim the single-use job-consumption marker and charge, BOTH inside the caller's
 * transaction. Returns "first" when this call claimed the marker and charged (the
 * caller's persist is the one real persist), or "replay" when the same jobId was
 * already consumed onto the SAME target (idempotent — persist+charge already done).
 * THROWS a CONFLICT TRPCError when the same jobId is replayed onto a DIFFERENT
 * target (rolls the caller's tx back → nothing persisted). NEVER swallows a charge
 * failure: a charge() throw propagates and rolls the whole unit back, so persisted
 * AI output can never outlive its charge (the split-settle hole is closed).
 */
export async function consumeAndCharge(
  params: ConsumeAndChargeParams,
): Promise<"first" | "replay"> {
  const { tx, userId, jobId, targetId, source, refId, metering } = params;
  assertExternalRefId(refId, `consumeAndCharge(${source})`);

  // Single-use claim: INSERT the marker keyed by refId. An empty RETURNING means the
  // marker already exists (this jobId was consumed before) → inspect its bound target.
  const claim = await tx.execute(sql`
    INSERT INTO ai_job_consumption (ref_id, user_id, job_id, target_id, source, created_by, last_upd_by)
    VALUES (
      ${refId},
      ${userId}::uuid,
      ${jobId},
      ${targetId},
      ${source},
      ${userId}::uuid,
      ${userId}::uuid
    )
    ON CONFLICT (ref_id) DO NOTHING
    RETURNING ref_id
  `);

  if ((claim.rows as unknown[]).length === 0) {
    // Already consumed. Read the bound target: SAME target → idempotent replay
    // (persist+charge already committed once); DIFFERENT target → REJECT the replay.
    const existing = await tx.execute(sql`
      SELECT target_id FROM ai_job_consumption
      WHERE ref_id = ${refId} AND user_id = ${userId}::uuid
    `);
    const rows = existing.rows as Array<{ target_id: string }>;
    const boundTarget = rows[0]?.target_id;
    if (boundTarget !== targetId) {
      throw new TRPCError({
        code: "CONFLICT",
        message: "Esta avaliação de IA já foi consumida por outro registro",
      });
    }
    return "replay";
  }

  // First consume: charge INSIDE the caller's tx so persist + marker + charge commit
  // together. A charge() failure THROWS here → the whole tx rolls back (marker +
  // persist undone), so nothing is delivered-but-unsettled. Idempotent by refId.
  //
  // UNPRICED (#98): a delivered result we could not price is charged 0 under a
  // `<source>:unmetered` source — NOT refused. Two visibility signals, both
  // AFTER the marker claim so a replay produces neither a second row nor a
  // second log line: (1) the console.error below, greppable by its stable tag;
  // (2) the credit_charges row charge() writes even at rawCents 0, queryable as
  // `source LIKE '%:unmetered'`. Zero cost is deliberate and LOUD — it is not
  // the price, it is the absence of one. `mult.<source>` never matches the
  // suffixed source, so the multiplier is 1× and 0 × 1 = 0 either way.
  const rawCents = metering.kind === "priced" ? costFor(metering.model, metering.usage) : 0;
  const chargeSource = metering.kind === "priced" ? source : `${source}:unmetered`;
  if (metering.kind === "unpriced") {
    console.error("[credits] ai usage indisponível — cobrado 0", {
      userId,
      source: chargeSource,
      refId,
      jobId,
      targetId,
      model: metering.model,
      reason: metering.reason,
    });
  }
  await charge({
    scope: { userId },
    source: chargeSource,
    rawCents,
    refId,
    delivered: true,
    tx,
  });
  return "first";
}
