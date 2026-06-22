CREATE TABLE "discursive_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"exam_label" text NOT NULL,
	"area" text NOT NULL,
	"year" integer NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"total_self_score" real,
	"max_total_points" real DEFAULT 10 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"last_upd_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_upd_by" uuid
);
--> statement-breakpoint
CREATE TABLE "user_discursive_answers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"question_id" text NOT NULL,
	"session_id" uuid,
	"answer_text" text NOT NULL,
	"self_score" real,
	"time_spent" integer NOT NULL,
	"ai_score" real,
	"ai_feedback" text,
	"ai_graded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"last_upd_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_upd_by" uuid
);
--> statement-breakpoint
ALTER TABLE "discursive_sessions" ADD CONSTRAINT "discursive_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_discursive_answers" ADD CONSTRAINT "user_discursive_answers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_discursive_answers" ADD CONSTRAINT "user_discursive_answers_question_id_oab_discursive_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."oab_discursive_questions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_discursive_answers" ADD CONSTRAINT "user_discursive_answers_session_id_discursive_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."discursive_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_discursive_sessions_user" ON "discursive_sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_user_disc_answers_user" ON "user_discursive_answers" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_user_disc_answers_question" ON "user_discursive_answers" USING btree ("question_id");--> statement-breakpoint
CREATE INDEX "idx_user_disc_answers_session" ON "user_discursive_answers" USING btree ("session_id");