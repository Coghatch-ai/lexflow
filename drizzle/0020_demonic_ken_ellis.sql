CREATE TABLE "coupons" (
	"code" text PRIMARY KEY NOT NULL,
	"value_credits" integer NOT NULL,
	"max_redemptions" integer DEFAULT 1 NOT NULL,
	"redeemed_count" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"last_upd_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_upd_by" uuid
);
