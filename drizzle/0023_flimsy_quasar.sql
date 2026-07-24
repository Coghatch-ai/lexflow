CREATE TABLE "pricing_config" (
	"key" text PRIMARY KEY NOT NULL,
	"numeric_value" numeric(18, 4),
	"text_value" text,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"last_upd_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_upd_by" uuid
);
--> statement-breakpoint
ALTER TABLE "coupons" ALTER COLUMN "value_credits" SET DEFAULT 0;--> statement-breakpoint
ALTER TABLE "coupons" ADD COLUMN "kind" text DEFAULT 'credits' NOT NULL;--> statement-breakpoint
ALTER TABLE "coupons" ADD COLUMN "value_units" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "coupons" ADD COLUMN "value_period_months" integer DEFAULT 0 NOT NULL;