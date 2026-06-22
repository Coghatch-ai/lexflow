CREATE TABLE "oab_discursive_imports" (
	"id" text PRIMARY KEY NOT NULL,
	"exam_label" text NOT NULL,
	"exam_board" text NOT NULL,
	"year" integer NOT NULL,
	"phase" text DEFAULT '2nd' NOT NULL,
	"area" text NOT NULL,
	"item_count" integer DEFAULT 0 NOT NULL,
	"model_answer_count" integer DEFAULT 0 NOT NULL,
	"prova_url" text,
	"padrao_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"last_upd_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_upd_by" uuid
);
--> statement-breakpoint
CREATE INDEX "idx_oab_disc_imp_area" ON "oab_discursive_imports" USING btree ("area");--> statement-breakpoint
CREATE INDEX "idx_oab_disc_imp_exam" ON "oab_discursive_imports" USING btree ("exam_label");