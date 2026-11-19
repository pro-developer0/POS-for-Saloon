CREATE TABLE "product_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"batch_no" text NOT NULL,
	"expiry_date" date NOT NULL,
	"quantity" integer DEFAULT 0 NOT NULL,
	"cost_price" numeric(12, 2),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transaction_item_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"batch_id" uuid NOT NULL,
	"quantity" integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD COLUMN "batch_id" uuid;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "generic_name" text;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "strength" text;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "dosage_form" text;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "unit_label" text DEFAULT 'unit' NOT NULL;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "pack_label" text;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "units_per_pack" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "pack_price" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "purchase_items" ADD COLUMN "batch_no" text;--> statement-breakpoint
ALTER TABLE "purchase_items" ADD COLUMN "expiry_date" date;--> statement-breakpoint
ALTER TABLE "purchase_items" ADD COLUMN "units_per_line" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "transaction_items" ADD COLUMN "stock_units" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "product_batches" ADD CONSTRAINT "product_batches_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_batches" ADD CONSTRAINT "product_batches_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_item_batches" ADD CONSTRAINT "transaction_item_batches_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_item_batches" ADD CONSTRAINT "transaction_item_batches_item_id_transaction_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."transaction_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "batches_product_expiry" ON "product_batches" USING btree ("product_id","expiry_date");--> statement-breakpoint
CREATE INDEX "batches_tenant_expiry" ON "product_batches" USING btree ("tenant_id","expiry_date");--> statement-breakpoint
CREATE UNIQUE INDEX "batches_uq" ON "product_batches" USING btree ("product_id","batch_no","expiry_date");