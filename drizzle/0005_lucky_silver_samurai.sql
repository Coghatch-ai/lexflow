ALTER TABLE "oab_questions" ALTER COLUMN "legal_basis" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "oab_questions" ALTER COLUMN "legislation_link" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "oab_questions" ALTER COLUMN "legislation_title" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "oab_questions" ALTER COLUMN "difficulty" SET DEFAULT 'medium';