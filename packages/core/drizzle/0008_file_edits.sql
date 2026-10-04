CREATE TABLE "file_edits" (
	"project_id" uuid NOT NULL,
	"path" text NOT NULL,
	"user_id" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "file_edits_project_id_path_user_id_pk" PRIMARY KEY("project_id","path","user_id")
);
--> statement-breakpoint
ALTER TABLE "file_edits" ADD CONSTRAINT "file_edits_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_edits" ADD CONSTRAINT "file_edits_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;