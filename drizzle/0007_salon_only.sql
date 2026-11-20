ALTER TABLE "product_batches" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "transaction_item_batches" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "product_batches" CASCADE;--> statement-breakpoint
DROP TABLE "transaction_item_batches" CASCADE;--> statement-breakpoint
ALTER TABLE "tenants" ALTER COLUMN "brand_color" SET DEFAULT '#8b5cf6';--> statement-breakpoint
ALTER TABLE "inventory_movements" DROP COLUMN "batch_id";--> statement-breakpoint
ALTER TABLE "products" DROP COLUMN "generic_name";--> statement-breakpoint
ALTER TABLE "products" DROP COLUMN "strength";--> statement-breakpoint
ALTER TABLE "products" DROP COLUMN "dosage_form";--> statement-breakpoint
ALTER TABLE "products" DROP COLUMN "unit_label";--> statement-breakpoint
ALTER TABLE "products" DROP COLUMN "pack_label";--> statement-breakpoint
ALTER TABLE "products" DROP COLUMN "units_per_pack";--> statement-breakpoint
ALTER TABLE "products" DROP COLUMN "pack_price";--> statement-breakpoint
ALTER TABLE "products" DROP COLUMN "track_stock";--> statement-breakpoint
ALTER TABLE "purchase_items" DROP COLUMN "batch_no";--> statement-breakpoint
ALTER TABLE "purchase_items" DROP COLUMN "expiry_date";--> statement-breakpoint
ALTER TABLE "purchase_items" DROP COLUMN "units_per_line";--> statement-breakpoint
ALTER TABLE "transaction_items" DROP COLUMN "stock_units";