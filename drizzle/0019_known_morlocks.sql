CREATE TABLE "credit_ledger" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"delta" integer NOT NULL,
	"action" text NOT NULL,
	"ref_id" text,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"last_upd_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_upd_by" uuid,
	CONSTRAINT "credit_ledger_ref_id_unique" UNIQUE("ref_id")
);
--> statement-breakpoint
ALTER TABLE "credit_ledger" ADD CONSTRAINT "credit_ledger_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_credit_ledger_user_created" ON "credit_ledger" USING btree ("user_id","created_at");