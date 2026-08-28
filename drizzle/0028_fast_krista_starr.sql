CREATE TABLE "exam_drafts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"mode" text NOT NULL,
	"setup" jsonb NOT NULL,
	"question_ids" jsonb NOT NULL,
	"cursor" integer DEFAULT 0 NOT NULL,
	"answers" jsonb NOT NULL,
	"mode_state" jsonb NOT NULL,
	"elapsed_seconds" integer DEFAULT 0 NOT NULL,
	"deadline_at" timestamp with time zone,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_saved_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"last_upd_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_upd_by" uuid,
	CONSTRAINT "uq_exam_draft_user_mode" UNIQUE("user_id","mode")
);
--> statement-breakpoint
ALTER TABLE "exam_drafts" ADD CONSTRAINT "exam_drafts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_exam_drafts_user" ON "exam_drafts" USING btree ("user_id");