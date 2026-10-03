DROP TABLE "sessions" CASCADE;--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "password_hash";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "role";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "status";--> statement-breakpoint
DROP TYPE "public"."user_role";--> statement-breakpoint
DROP TYPE "public"."user_status";