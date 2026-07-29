CREATE TABLE "ai_job_consumption" (
	"ref_id" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"job_id" text NOT NULL,
	"target_id" text NOT NULL,
	"source" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"last_upd_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_upd_by" uuid
);
--> statement-breakpoint
ALTER TABLE "ai_job_consumption" ADD CONSTRAINT "ai_job_consumption_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_ai_job_consumption_user" ON "ai_job_consumption" USING btree ("user_id");