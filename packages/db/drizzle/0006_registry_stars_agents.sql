CREATE TABLE "registry_stars" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"skill_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "registry_stars" ADD CONSTRAINT "registry_stars_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registry_stars" ADD CONSTRAINT "registry_stars_skill_id_skills_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."skills"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "registry_stars_user_skill_idx" ON "registry_stars" USING btree ("user_id","skill_id");--> statement-breakpoint
ALTER TABLE "registry_entries" ADD COLUMN "compatible_agents" jsonb DEFAULT '[]'::jsonb NOT NULL;
