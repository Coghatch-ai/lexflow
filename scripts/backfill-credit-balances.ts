// scripts/backfill-credit-balances.ts
//
// D1 LIVE MIGRATION (epic #50) — backfill + two-rail merge + invariant gate.
// ARTIFACT ONLY in this slice: the snapshot dry-run + prod apply is a human/
// deploy-gated step the owner owns. Never run this against prod from a laptop.
//
// WHAT IT DOES (in ONE transaction, fail-closed):
//   (0) LOCK    — `LOCK TABLE credit_ledger, allowance_ledger IN SHARE ROW
//       EXCLUSIVE MODE` at the very START of the tx, BEFORE the snapshot read.
//       This is the strongest mode that still allows concurrent SELECTs but blocks
//       concurrent INSERT/UPDATE/DELETE, so no legacy writer can slip a row in
//       between the read and the write+validate. The snapshot the plan is built
//       from is therefore the exact same set it writes + validates against.
//   (0b) PREFLIGHT — abort if any pre-existing credit_ledger.ref_id already squats
//       a RESERVED internal prefix (`charge:` / `legacy_allowance:`); such a row
//       would collide with an internal insert (ON CONFLICT DO NOTHING) and silently
//       drop a migrated row.
//   (a) MERGE  — rewrite legacy credit_ledger + allowance_ledger rows into the
//       unified canonical credit_ledger (delta_cents + kind + source), using the
//       source map in shared/domain/credit-backfill.ts (mergeLegacyLedgers).
//       Credit-rail rows are UPDATEd by PRIMARY KEY (id), never by the nullable
//       ref_id, so a NULL-ref_id credit row is still materialized (it is counted in
//       the balance, so it MUST be written).
//   (b) BACKFILL — materialize credit_balances.balance_cents per user from the
//       merged SUM(delta_cents) (upsert, one row per user with ledger activity).
//   (c) VALIDATE — assert per-user balance_cents == SUM(merged delta_cents) for
//       EVERY user AND that NO legacy credit_ledger row was left with a NULL
//       canonical delta_cents (i.e. nothing slipped in / went unmaterialized). Any
//       mismatch → ROLLBACK, write nothing.
//
// LOCKING MODEL: this migration runs as a BRIEF EXCLUSIVE step. The SHARE ROW
// EXCLUSIVE lock is held for the whole read→write→validate tx, so concurrent
// legacy writers block (not error) until it commits/rolls back. It aligns with the
// human snapshot-dry-run + maintenance-window gate (task t70): apply during a short
// window where a moment of blocked legacy writes is acceptable.
//
// USAGE:
//   pnpm tsx scripts/backfill-credit-balances.ts             # DRY-RUN (default): plan + validate, ROLLBACK
//   pnpm tsx scripts/backfill-credit-balances.ts --apply     # APPLY: commit inside one tx (human/deploy-gated)
//   pnpm tsx scripts/backfill-credit-balances.ts --json      # machine-readable plan + validation report
//
// The migration DDL (new tables + additive credit_ledger columns) is applied
// FIRST by the generated drizzle migration (db:generate → review → db:migrate);
// this script only fills DATA. It is idempotent: re-running recomputes the merge
// from the still-intact legacy delta/action columns (never dropped in D1).
//
// ─── ROLLBACK PLAN ──────────────────────────────────────────────────────────
// This migration is REVERSIBLE because it is purely ADDITIVE in D1:
//   1. The legacy columns credit_ledger.delta / .action and the whole
//      allowance_ledger table are LEFT INTACT — nothing is dropped in D1. The
//      unified engine writes only the NEW columns (delta_cents/kind/source) +
//      credit_balances/credit_charges. So the old rails still fully derive the
//      old balances at any time.
//   2. To roll back DATA: truncate credit_balances + credit_charges and NULL the
//      credit_ledger.delta_cents/kind/source columns:
//        BEGIN;
//          TRUNCATE credit_balances, credit_charges;
//          UPDATE credit_ledger SET delta_cents = NULL, kind = NULL, source = NULL;
//        COMMIT;
//      The legacy SUM(delta)/action logic is untouched → instant return to pre-D1.
//   3. To roll back SCHEMA: drop credit_balances, credit_charges, credit_config
//      and the three additive credit_ledger columns (a down-migration). Safe
//      because D1 ships the engine DORMANT — no live call site reads/writes them.
//   4. The apply runs in ONE transaction with the invariant gate BEFORE COMMIT;
//      a gate failure ROLLBACKs automatically, leaving prod exactly as found.
// The owner runs the dry-run on a prod-DB SNAPSHOT first (task t70) and only then
// applies. This script never applies unless explicitly passed --apply.

import "dotenv/config";
import { db } from "../api/db/client";
import { sql } from "drizzle-orm";
import {
  mergeLegacyLedgers,
  deriveBalances,
  validateInvariant,
  findReservedPrefixRefIds,
  type LegacyLedgerRow,
  type MergedLedgerRow,
} from "../shared/domain/credit-backfill";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

interface RawLegacyRow {
  rail: "credit" | "allowance";
  id: string;
  user_id: string;
  delta: number;
  action: string;
  ref_id: string | null;
}

/**
 * Read BOTH rails INSIDE the already-locked transaction. Because the caller has
 * taken SHARE ROW EXCLUSIVE on credit_ledger + allowance_ledger before calling
 * this, the snapshot returned here cannot change under the rest of the tx.
 */
async function loadLegacyRows(tx: Tx): Promise<LegacyLedgerRow[]> {
  // Carry each source row's own PK (id): allowance rows get a deterministic
  // `legacy_allowance:<id>` INSERT ref_id; credit rows are UPDATEd BY id (not the
  // nullable ref_id) in the unified ledger (mapLegacyRow / runWritePlan).
  const result = await tx.execute(sql`
    SELECT 'credit'::text AS rail, id::text AS id, user_id, delta, action, ref_id FROM credit_ledger
    UNION ALL
    SELECT 'allowance'::text AS rail, id::text AS id, user_id, delta, action, ref_id FROM allowance_ledger
  `);
  const rows = result.rows as unknown as RawLegacyRow[];
  return rows.map((r) => ({
    rail: r.rail,
    id: r.id,
    userId: r.user_id,
    delta: Number(r.delta),
    action: r.action,
    refId: r.ref_id,
  }));
}

/**
 * (0) Lock both legacy rails for the whole tx. SHARE ROW EXCLUSIVE is the
 * strongest mode that still permits concurrent SELECT but blocks any concurrent
 * INSERT/UPDATE/DELETE, so the snapshot loadLegacyRows() takes next is frozen for
 * the read→write→validate window. Must run FIRST, before any read.
 */
async function lockLegacyRails(tx: Tx): Promise<void> {
  await tx.execute(sql`LOCK TABLE credit_ledger, allowance_ledger IN SHARE ROW EXCLUSIVE MODE`);
}

/**
 * (0b) Preflight: abort if any pre-existing credit_ledger.ref_id already squats a
 * reserved internal prefix. Such a row would collide with an internal insert (ON
 * CONFLICT DO NOTHING) and silently drop a migrated allowance row. Throws → the
 * caller's tx ROLLBACKs; the whole migration writes nothing.
 */
async function preflightReservedPrefixes(tx: Tx): Promise<void> {
  const existing = await tx.execute(sql`
    SELECT DISTINCT ref_id FROM credit_ledger WHERE ref_id IS NOT NULL
  `);
  const refIds = (existing.rows as Array<{ ref_id: string | null }>).map((r) => r.ref_id);
  const offenders = findReservedPrefixRefIds(refIds);
  if (offenders.length > 0) {
    throw new Error(
      `PREFLIGHT FAILED — ${String(offenders.length)} pre-existing credit_ledger.ref_id(s) use a reserved ` +
        `internal prefix (charge:/legacy_allowance:); e.g. ${offenders.slice(0, 5).join(", ")}. ` +
        "Reserved prefixes are internal to the money core — resolve these rows before backfilling.",
    );
  }
}

/**
 * The ONE SQL write plan — run identically by BOTH the dry-run (inside a tx that
 * always ROLLBACKs) and --apply (inside a tx that commits). This guarantees the
 * dry-run validates the invariant against the rows a real apply WOULD write, not
 * just the in-model merge. Steps: (a) MERGE — UPDATE existing credit_ledger rows
 * in place by ref_id for the credit rail, INSERT canonical rows for the allowance
 * rail (namespaced `legacy_allowance:<id>` ref_id, ON CONFLICT DO NOTHING so it is
 * idempotent/re-runnable); (b) BACKFILL — upsert credit_balances from the merged
 * per-user sums; (c) VALIDATE — assert per-user balance_cents == SUM(delta_cents)
 * of the ACTUALLY-WRITTEN unified credit_ledger, else throw → ROLLBACK.
 */
async function runWritePlan(
  tx: Tx,
  merged: MergedLedgerRow[],
  materialized: Map<string, number>,
): Promise<void> {
  // (a) MERGE.
  for (const row of merged) {
    if (row.writeMode === "update") {
      // UPDATE by PRIMARY KEY (id), NOT the nullable ref_id: a credit_ledger row is
      // allowed a NULL ref_id yet still counts toward the balance, so keying on
      // ref_id would skip it and produce a post-write mismatch. sourceId is always
      // present for a credit-rail update (loadLegacyRows selects id).
      if (row.sourceId === null) {
        throw new Error(
          "credit-rail merged row is missing its source PK (id) — cannot target UPDATE",
        );
      }
      await tx.execute(sql`
        UPDATE credit_ledger
        SET delta_cents = ${row.deltaCents}, kind = ${row.kind}, source = ${row.source}
        WHERE id = ${row.sourceId}::uuid
      `);
    } else {
      // INSERT a canonical unified row for an allowance_ledger entry. delta mirrors
      // delta_cents (unit == cent at D1). Idempotent by the namespaced ref_id.
      await tx.execute(sql`
        INSERT INTO credit_ledger (user_id, delta, action, delta_cents, kind, source, ref_id, created_by, last_upd_by)
        VALUES (
          ${row.userId}::uuid,
          ${row.deltaCents},
          ${row.kind},
          ${row.deltaCents},
          ${row.kind},
          ${row.source},
          ${row.ledgerRefId},
          ${row.userId}::uuid,
          ${row.userId}::uuid
        )
        ON CONFLICT (ref_id) DO NOTHING
      `);
    }
  }
  // (b) BACKFILL: upsert credit_balances from the merged per-user sums.
  for (const [userId, balanceCents] of materialized) {
    await tx.execute(sql`
      INSERT INTO credit_balances (user_id, balance_cents, bag_cents, reference_cents, created_by, last_upd_by)
      VALUES (${userId}::uuid, ${balanceCents}, '0'::numeric, ${Math.max(balanceCents, 0)}, ${userId}::uuid, ${userId}::uuid)
      ON CONFLICT (user_id) DO UPDATE SET
        balance_cents = ${balanceCents},
        reference_cents = ${Math.max(balanceCents, 0)},
        last_upd_at = now()
    `);
  }
  // (c) VALIDATE post-write from the DB itself; mismatch → throw → ROLLBACK.
  const check = await tx.execute(sql`
    SELECT b.user_id
    FROM credit_balances b
    LEFT JOIN (
      SELECT user_id, coalesce(sum(delta_cents), 0)::int AS s
      FROM credit_ledger GROUP BY user_id
    ) l ON l.user_id = b.user_id
    WHERE b.balance_cents <> coalesce(l.s, 0)
  `);
  if ((check.rows as unknown[]).length > 0) {
    throw new Error("post-write invariant mismatch — rolling back, prod unchanged");
  }
  // (c2) DETECT LEFTOVER unmaterialized legacy rows: any credit_ledger row still
  // carrying a NULL canonical delta_cents after the plan ran means a row slipped in
  // (a legacy writer beat the lock — should be impossible with the SHARE ROW
  // EXCLUSIVE lock) or was not materialized by the plan. Under the lock this MUST
  // be zero; a non-zero count means money would be counted by the old rail but not
  // the new one, so fail the gate. (The sum-check above uses coalesce(sum) and so
  // would NOT catch a NULL row on its own.)
  const nullCanonical = await tx.execute(sql`
    SELECT count(*)::int AS n FROM credit_ledger WHERE delta_cents IS NULL
  `);
  const nullRows = (nullCanonical.rows as Array<{ n: number }>)[0]?.n ?? 0;
  if (nullRows > 0) {
    throw new Error(
      `post-write check: ${String(nullRows)} credit_ledger row(s) still have NULL delta_cents ` +
        "(unmaterialized / slipped in past the lock) — rolling back, prod unchanged",
    );
  }
}

/** Sentinel used to ROLLBACK the dry-run tx after the write plan validated. */
const DRY_RUN_ROLLBACK = "__dry_run_rollback__";

interface PlanReport {
  legacyRows: number;
  mergedRows: number;
  users: number;
  mode: "apply" | "dry-run";
}

/**
 * The ENTIRE migration pipeline inside ONE locked transaction:
 *   lock rails → preflight reserved prefixes → snapshot read → merge → in-model
 *   invariant check → write plan (which post-write validates from the DB) →
 *   commit (apply) OR rollback via the DRY_RUN_ROLLBACK sentinel (dry-run).
 * Read + merge + write + validate all see the SAME locked snapshot, so a
 * concurrent legacy writer cannot slip a row past the plan (r2 finding #1).
 * Returns the plan report; throws to abort (tx ROLLBACKs, nothing committed).
 */
async function runMigrationTx(tx: Tx, apply: boolean): Promise<PlanReport> {
  await lockLegacyRails(tx); // (0) FIRST — freeze both rails for the whole tx.
  await preflightReservedPrefixes(tx); // (0b) reserved-prefix squatters → abort.

  const legacy = await loadLegacyRows(tx); // snapshot under the lock.
  const merged = mergeLegacyLedgers(legacy);
  const materialized = deriveBalances(merged); // target balance_cents per user.

  // In-model invariant BEFORE any write — mismatch → throw → ROLLBACK, no writes.
  const mismatches = validateInvariant(materialized, merged);
  if (mismatches.length > 0) {
    console.error(
      `INVARIANT FAILED — ${String(mismatches.length)} user(s) mismatch. Aborting, no writes.`,
    );
    console.error(JSON.stringify(mismatches.slice(0, 20), null, 2));
    throw new Error("in-model invariant mismatch — rolling back, prod unchanged");
  }

  // Write plan; it post-write validates against the ACTUALLY-written rows + the
  // no-NULL-canonical check, throwing → ROLLBACK on any drift.
  await runWritePlan(tx, merged, materialized);

  const report: PlanReport = {
    legacyRows: legacy.length,
    mergedRows: merged.length,
    users: materialized.size,
    mode: apply ? "apply" : "dry-run",
  };

  if (!apply) {
    // DRY-RUN: the plan applied + validated against real written rows; discard it.
    throw new PlanValidated(report);
  }
  return report;
}

/** Carries the validated dry-run report out through the ROLLBACK throw. */
class PlanValidated extends Error {
  constructor(readonly report: PlanReport) {
    super(DRY_RUN_ROLLBACK);
    this.name = "PlanValidated";
  }
}

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  const asJson = process.argv.includes("--json");

  let report: PlanReport;
  try {
    report = await db.transaction((tx) => runMigrationTx(tx, apply));
  } catch (err) {
    // A dry-run always exits its tx via PlanValidated (the plan validated, then we
    // roll back so nothing is written). Any OTHER throw = a real gate failure.
    if (err instanceof PlanValidated) {
      report = err.report;
    } else {
      console.error(err instanceof Error ? err.message : err);
      process.exit(1);
    }
  }

  if (asJson) {
    console.warn(JSON.stringify(report, null, 2));
  } else {
    console.warn(
      `Backfill plan: ${String(report.legacyRows)} legacy rows → ${String(report.mergedRows)} merged rows, ` +
        `${String(report.users)} users, invariant OK (0 mismatches). Mode: ${report.mode}.`,
    );
  }

  if (!apply) {
    console.warn(
      "DRY-RUN: rails locked, reserved-prefix preflight OK, write plan applied + invariant validated against " +
        "actually-written rows, then ROLLED BACK. No writes performed. Re-run with --apply (human/deploy-gated).",
    );
  } else {
    console.warn(
      "APPLIED: credit_balances backfilled + ledger merged, invariant holds. Migration gate PASS.",
    );
  }
  process.exit(0);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
