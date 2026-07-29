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
import { costFor, type Usage } from "../../shared/domain/cost-of-goods";

// Prod default model (CLAUDE.md: production runs OpenAI gpt-4o-mini). A door with
// no per-task model override meters against this — kept in sync with the relay's
// live selection. costFor tolerates a stale id (unknown → 0), the guard test keeps
// it live.
export const PROD_DEFAULT_MODEL = "gpt-4o-mini";

/** Resolve the model a door metered against: its per-task override, else prod default. */
export function resolveMeteringModel(override?: string): string {
  return override !== undefined && override.length > 0 ? override : PROD_DEFAULT_MODEL;
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
  /** Idempotency identity shared by the marker (PK) AND charge() (`grade:<jobId>` …). */
  readonly refId: string;
  readonly model: string;
  readonly usage: Usage;
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
  const { tx, userId, jobId, targetId, source, refId, model, usage } = params;
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
  const rawCents = costFor(model, usage);
  await charge({ scope: { userId }, source, rawCents, refId, delivered: true, tx });
  return "first";
}
