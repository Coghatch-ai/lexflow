CREATE TABLE "list_of_values" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" text NOT NULL,
	"code" text NOT NULL,
	"value" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"last_upd_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_upd_by" uuid,
	CONSTRAINT "uq_lov_type_code" UNIQUE("type","code")
);
--> statement-breakpoint
CREATE INDEX "idx_lov_type" ON "list_of_values" USING btree ("type");