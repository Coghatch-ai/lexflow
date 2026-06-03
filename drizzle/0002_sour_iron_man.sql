CREATE TABLE "spaced_repetition_config" (
	"id" text PRIMARY KEY DEFAULT 'default' NOT NULL,
	"default_ease_factor" numeric(4, 2) DEFAULT '2.50' NOT NULL,
	"min_ease_factor" numeric(4, 2) DEFAULT '1.30' NOT NULL,
	"ease_factor_correct_bonus" numeric(4, 2) DEFAULT '0.10' NOT NULL,
	"ease_factor_wrong_penalty" numeric(4, 2) DEFAULT '0.20' NOT NULL,
	"initial_interval" integer DEFAULT 1 NOT NULL,
	"second_interval" integer DEFAULT 6 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"last_upd_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_upd_by" uuid
);
--> statement-breakpoint
CREATE TABLE "user_question_states" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"question_id" text NOT NULL,
	"interval" integer DEFAULT 1 NOT NULL,
	"repetitions" integer DEFAULT 0 NOT NULL,
	"ease_factor" numeric(4, 2) DEFAULT '2.50' NOT NULL,
	"next_review_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_correct" boolean,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"last_upd_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_upd_by" uuid,
	CONSTRAINT "uq_user_question_state" UNIQUE("user_id","question_id")
);
--> statement-breakpoint
ALTER TABLE "user_question_states" ADD CONSTRAINT "user_question_states_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_question_states" ADD CONSTRAINT "user_question_states_question_id_oab_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."oab_questions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_uqs_user" ON "user_question_states" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_uqs_next_review" ON "user_question_states" USING btree ("user_id","next_review_at");