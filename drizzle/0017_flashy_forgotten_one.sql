CREATE TABLE "ai_coach_digests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"digest" jsonb NOT NULL,
	"stats_snapshot" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"last_upd_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_upd_by" uuid
);
--> statement-breakpoint
ALTER TABLE "ai_coach_digests" ADD CONSTRAINT "ai_coach_digests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_ai_coach_user_created" ON "ai_coach_digests" USING btree ("user_id","created_at");