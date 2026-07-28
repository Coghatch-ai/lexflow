CREATE TABLE "credit_balances" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"balance_cents" integer DEFAULT 0 NOT NULL,
	"bag_cents" numeric(12, 4) DEFAULT '0' NOT NULL,
	"reference_cents" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"last_upd_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_upd_by" uuid
);
--> statement-breakpoint
CREATE TABLE "credit_charges" (
	"ref_id" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"source" text NOT NULL,
	"raw_cents" numeric(12, 4) NOT NULL,
	"owed_cents" numeric(12, 4) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"last_upd_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_upd_by" uuid
);
--> statement-breakpoint
CREATE TABLE "credit_config" (
	"key" text PRIMARY KEY NOT NULL,
	"value_int" integer NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"last_upd_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_upd_by" uuid
);
--> statement-breakpoint
ALTER TABLE "credit_ledger" ADD COLUMN "delta_cents" integer;--> statement-breakpoint
ALTER TABLE "credit_ledger" ADD COLUMN "kind" text;--> statement-breakpoint
ALTER TABLE "credit_ledger" ADD COLUMN "source" text;--> statement-breakpoint
ALTER TABLE "credit_balances" ADD CONSTRAINT "credit_balances_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_charges" ADD CONSTRAINT "credit_charges_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_credit_charges_user" ON "credit_charges" USING btree ("user_id");--> statement-breakpoint
-- NOTE (D1 review): drizzle re-emits `coupons_kind_check` here because migration
-- 0024 was hand-authored (no drizzle snapshot), so the differ can't see the
-- constraint already exists on the live DB. Applying it again would fail with a
-- duplicate-constraint error. It is already live via 0024, so the ADD is DROPPED
-- from this migration. The 0025 snapshot still records it (correct end-state).
ALTER TABLE "credit_ledger" ADD CONSTRAINT "credit_ledger_kind_check" CHECK ("credit_ledger"."kind" IS NULL OR "credit_ledger"."kind" IN ('grant', 'purchase', 'refund', 'consumption', 'adjustment', 'expiry'));