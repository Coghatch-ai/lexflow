CREATE TABLE "oab_discursive_questions" (
	"id" text PRIMARY KEY NOT NULL,
	"exam_label" text NOT NULL,
	"exam_board" text NOT NULL,
	"year" integer NOT NULL,
	"phase" text DEFAULT '2nd' NOT NULL,
	"area" text NOT NULL,
	"question_type" text NOT NULL,
	"order_index" integer NOT NULL,
	"statement" text NOT NULL,
	"model_answer" text,
	"max_points" real NOT NULL,
	"max_lines" integer,
	"legal_basis" text,
	"topic" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"last_upd_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_upd_by" uuid
);
--> statement-breakpoint
CREATE INDEX "idx_oab_disc_area" ON "oab_discursive_questions" USING btree ("area");--> statement-breakpoint
CREATE INDEX "idx_oab_disc_exam" ON "oab_discursive_questions" USING btree ("exam_label");--> statement-breakpoint
CREATE INDEX "idx_oab_disc_year" ON "oab_discursive_questions" USING btree ("year");