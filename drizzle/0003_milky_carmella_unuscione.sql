ALTER TABLE "tenants" ALTER COLUMN "status" SET DEFAULT 'active';
--> statement-breakpoint
UPDATE "tenants" SET "status" = 'active' WHERE "status" = 'trial';
