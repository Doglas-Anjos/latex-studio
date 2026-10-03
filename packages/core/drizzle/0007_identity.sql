-- Accounts from the password login cannot be mapped to a FasorX identity and would collide on
-- email with the account created at first visit; nothing was deployed before this, so drop them.
DELETE FROM "users";--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "issuer" text NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "subject" text NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "users_issuer_subject_idx" ON "users" USING btree ("issuer","subject");
