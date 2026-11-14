CREATE TABLE IF NOT EXISTS "client_licences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"type" text NOT NULL,
	"ref_no" text NOT NULL,
	"issuer" text,
	"start_date" date,
	"expiry_date" date,
	"document_id" uuid,
	"notes" text,
	"created_by_id" uuid,
	"updated_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "client_portal_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"portal" text NOT NULL,
	"url" text,
	"username" text NOT NULL,
	"holder_name" text,
	"email" text,
	"phone" text,
	"role" text,
	"vault_ref" text,
	"notes" text,
	"created_by_id" uuid,
	"updated_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "cin" text;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "business_type" text;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "tax_paid_by" text DEFAULT 'CLIENT' NOT NULL;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "main_activity" text;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "last_verified_on" date;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "client_licences" ADD CONSTRAINT "client_licences_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "client_licences" ADD CONSTRAINT "client_licences_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "client_licences" ADD CONSTRAINT "client_licences_updated_by_id_users_id_fk" FOREIGN KEY ("updated_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "client_portal_accounts" ADD CONSTRAINT "client_portal_accounts_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "client_portal_accounts" ADD CONSTRAINT "client_portal_accounts_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "client_portal_accounts" ADD CONSTRAINT "client_portal_accounts_updated_by_id_users_id_fk" FOREIGN KEY ("updated_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "client_licences_client_idx" ON "client_licences" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "client_licences_expiry_idx" ON "client_licences" USING btree ("expiry_date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "client_portal_accounts_client_idx" ON "client_portal_accounts" USING btree ("client_id");