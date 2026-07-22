ALTER TABLE "ai_usage_daily" DROP CONSTRAINT "uq_ai_usage_user_day";--> statement-breakpoint
ALTER TABLE "ai_usage_daily" ADD COLUMN "kind" text DEFAULT 'tutor' NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_usage_daily" ADD CONSTRAINT "uq_ai_usage_user_day_kind" UNIQUE("user_id","day","kind");