ALTER TYPE "public"."build_status" ADD VALUE 'cancelled';--> statement-breakpoint
ALTER TABLE "builds" ADD COLUMN "info" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "builds" ADD COLUMN "options" jsonb DEFAULT '{}'::jsonb NOT NULL;