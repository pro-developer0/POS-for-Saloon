ALTER TABLE "products" ADD COLUMN "track_stock" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "modules" jsonb;