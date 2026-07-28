// api/lib/ai-metering.ts
//
// D3 (epic #50) — the DELIVERED-ONLY metering door for the AI call sites, wired
// in SHADOW. Each AI surface (grade / explanation / tutor / coach / admin
// generateExplanation) does two things through this module:
//
//   1. admissionRead(userId) — reads the unified balance at admission. In SHADOW
//      it NEVER denies (observe-only); it only surfaces the figure for the
//      reconcile metric. The OLD debit-at-admission rail (allowance.ts / credits.ts)
//      stays authoritative and is UNCHANGED — this read is additive.
//
//   2. settleDelivered({...}) — called AFTER the relay result is known (the door's
//      finalize/settle proc re-reads the S3 result server-side). It computes the
//      cost-of-goods (costFor(model,usage)) and calls the money core charge() with
//      delivered=<real S3 delivery flag> and dryRun=<shadow>. In SHADOW charge()
//      writes NOTHING; delivered:false is a total no-op. It then emits ONE
//      reconciliation metric (would-charge vs the old debit) per source/model/action
//      so parity can be judged from real post-deploy traffic — the gate before D4's
//      enforce flip.
//
// SAFE CUTOVER BOUNDARY (Codex, exact order): (1) old system authoritative;
// (2) this settleDelivered() observes delivered results, writes nothing (shadow);
// (3) reconcile would-charge vs old debit. Steps 4 (flip authoritative) + 5
// (remove old debit) are D4 — NOT here. Nothing in this file is authoritative.

import { sql } from "drizzle-orm";
import { db } from "../db/client";
import { charge, type ChargeResult } from "./credit-charge";
import { assertExternalRefId } from "../../shared/domain/credit-reserved";
import { costFor, type Usage } from "../../shared/domain/cost-of-goods";
import { isOff, isShadow } from "./credits-mode";

// Prod default model (CLAUDE.md: production runs OpenAI gpt-4o-mini). A door with
// no per-task model override meters against this — kept in sync with the relay's
// live selection. costFor tolerates a stale id (unknown → 0), the guard test keeps
// it live.
export const PROD_DEFAULT_MODEL = "gpt-4o-mini";

/** Resolve the model a door metered against: its per-task override, else prod default. */
export function resolveMeteringModel(override?: string): string {
  return override !== undefined && override.length > 0 ? override : PROD_DEFAULT_MODEL;
}

/**
 * Read the unified materialized balance for a user (cents). Observe-only in D3 —
 * NEVER denies AND NEVER throws into the request path. The new money path is not
 * authoritative this slice, so a degraded/missing credit_balances read must not be
 * able to block enqueueing live work (shadow behaviour-neutrality — Codex F3). The
 * query is wrapped strictly best-effort: on ANY failure it logs (warn) and returns
 * a neutral 0 so the OLD authoritative rail runs unchanged. (Enforce-mode admission
 * denial is D4; in D3/shadow this can never deny or throw.)
 * Returns 0 when no balance row exists yet (first-write user) or on read failure.
 */
export async function admissionRead(userId: string): Promise<number> {
  try {
    const [row] = await db
      .select({ balance: sql<number>`coalesce(balance_cents, 0)` })
      .from(sql`credit_balances`)
      .where(sql`user_id = ${userId}::uuid`)
      .limit(1);
    return row ? Number(row.balance) : 0;
  } catch (err) {
    // Shadow observe must be behaviour-neutral — never propagate into the old path.
    console.warn("[credits] shadow admissionRead failed (neutral 0)", { userId, err });
    return 0;
  }
}

export interface SettleParams {
  readonly userId: string;
  /** Per-door source (grade | explanation | tutor | coach) — attribution + mult. */
  readonly source: string;
  /** Sub-prefixed, user-unique idempotency key (e.g. `grade:<jobId>`). Must NOT
   *  use a reserved money-core prefix — asserted before charge(). */
  readonly refId: string;
  /** Model the delivered work actually ran on (per-task override or prod default). */
  readonly model: string;
  /** Delivered work measured — drives costFor() → charge()'s rawCents. */
  readonly usage: Usage;
  /** Real delivery flag from the relay result (status:done). false → total no-op. */
  readonly delivered: boolean;
  /** The old rail's debit for this same action (units→cents 1:1) — reconcile RHS. */
  readonly oldDebitCents: number;
  /** Action label for the reconcile metric (e.g. "grade", "tutorAsk"). */
  readonly action: string;
}

/**
 * D3 delivered-only settle for one AI door. Computes cost-of-goods, runs the money
 * core charge() (dryRun in shadow, no-op when undelivered), and emits the reconcile
 * metric. Returns the ChargeResult for the caller/tests. In OFF mode the whole door
 * is skipped.
 *
 * Charge-failure handling is MODE-DEPENDENT (Codex F4 — no baked-in fail-open):
 *   - SHADOW: a charge() throw is logged (warn, charge-LOST) + swallowed (returns
 *     null). A shadow charge is not authoritative, so it must never break a
 *     delivered user action.
 *   - ENFORCE (D4): a charge() throw MUST propagate — billing cannot silently skip
 *     on delivered output (fail-CLOSED). It is re-thrown so settlement can't deliver
 *     unbilled work. D4 gets correct enforce behaviour with no further change here.
 */
export async function settleDelivered(params: SettleParams): Promise<ChargeResult | null> {
  if (isOff()) return null;
  const { userId, source, refId, model, usage, delivered, oldDebitCents, action } = params;
  // refId is caller-supplied (a door prefix) → must respect the reserved-prefix
  // rules exactly like grant()/refund() do. Fail loud on a bad key (never at runtime
  // in prod — this is a programming error caught by the door's own test/CI).
  assertExternalRefId(refId, `settleDelivered(${source})`);

  const rawCents = costFor(model, usage);
  const shadow = isShadow();

  let result: ChargeResult;
  try {
    result = await charge({
      scope: { userId },
      source,
      rawCents,
      refId,
      delivered,
      dryRun: shadow,
    });
  } catch (err) {
    if (!shadow) {
      // ENFORCE: fail-CLOSED. A charge failure on delivered output must NOT be
      // silently swallowed — propagate so settlement can't skip billing (D4).
      console.error("[credits] enforce settle charge failed — propagating", {
        source,
        action,
        refId,
        err,
      });
      throw err;
    }
    // SHADOW: charge is not authoritative — log the lost shadow charge + swallow so a
    // delivered request is never broken by the observe path.
    console.warn("[credits] shadow settle charge LOST", { source, action, refId, err });
    return null;
  }

  emitReconcileMetric({
    source,
    model,
    action,
    delivered,
    shadow,
    rawCents,
    wouldChargeCents: result.flushCents,
    owedCents: result.owedCents,
    oldDebitCents,
    outcome: result.outcome,
  });
  return result;
}

export interface ReconcileMetric {
  readonly source: string;
  readonly model: string;
  readonly action: string;
  readonly delivered: boolean;
  readonly shadow: boolean;
  readonly rawCents: number;
  /** Whole cents the new engine WOULD move this call (the shadow flush). */
  readonly wouldChargeCents: number;
  /** Fractional owed (raw × multiplier) — sub-cent audit. */
  readonly owedCents: number;
  /** The old debit-at-admission rail's charge for this same action (cents). */
  readonly oldDebitCents: number;
  readonly outcome: ChargeResult["outcome"];
}

/**
 * Emit ONE structured reconciliation record per settled AI action: the new
 * engine's would-charge vs the old debit, tagged by source/model/action. This is
 * the parity signal judged from real post-deploy traffic — the gate before D4's
 * enforce flip. Uses console.warn (NOT console.log — banned; warn/error only) so
 * it lands in CloudWatch as a structured line greppable by `metric=credits-reconcile`.
 */
export function emitReconcileMetric(m: ReconcileMetric): void {
  console.warn(
    JSON.stringify({
      metric: "credits-reconcile",
      source: m.source,
      model: m.model,
      action: m.action,
      delivered: m.delivered,
      shadow: m.shadow,
      rawCents: m.rawCents,
      wouldChargeCents: m.wouldChargeCents,
      owedCents: m.owedCents,
      oldDebitCents: m.oldDebitCents,
      deltaCents: m.wouldChargeCents - m.oldDebitCents,
      outcome: m.outcome,
    }),
  );
}
