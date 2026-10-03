CREATE TYPE "public"."build_status" AS ENUM('queued', 'running', 'succeeded', 'failed', 'timeout');--> statement-breakpoint
CREATE TABLE "builds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"requested_by" uuid,
	"status" "build_status" DEFAULT 'queued' NOT NULL,
	"engine" "project_engine" NOT NULL,
	"main_file" text NOT NULL,
	"commit_sha" text,
	"exit_code" integer,
	"errors" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"warnings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "yjs_docs" (
	"project_id" uuid NOT NULL,
	"path" text NOT NULL,
	"state" "bytea" NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "yjs_docs_project_id_path_pk" PRIMARY KEY("project_id","path")
);
--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "dirty_since" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "builds" ADD CONSTRAINT "builds_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "builds" ADD CONSTRAINT "builds_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "yjs_docs" ADD CONSTRAINT "yjs_docs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "builds_project_id_created_at_idx" ON "builds" USING btree ("project_id","created_at");