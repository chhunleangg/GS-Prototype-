ALTER TABLE "shipments" ADD COLUMN IF NOT EXISTS "bl_date" date;--> statement-breakpoint
ALTER TABLE "shipments" ADD COLUMN IF NOT EXISTS "incoterm" text;--> statement-breakpoint
ALTER TABLE "shipments" ADD COLUMN IF NOT EXISTS "currency" text;--> statement-breakpoint
ALTER TABLE "shipments" ADD COLUMN IF NOT EXISTS "exchange_rate" numeric(14, 4);