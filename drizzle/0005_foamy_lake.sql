CREATE TABLE "cash_closes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"period_start" timestamp with time zone NOT NULL,
	"closed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"opening_float" numeric(12, 2) DEFAULT '0' NOT NULL,
	"expected_cash" numeric(12, 2) DEFAULT '0' NOT NULL,
	"counted_cash" numeric(12, 2) DEFAULT '0' NOT NULL,
	"difference" numeric(12, 2) DEFAULT '0' NOT NULL,
	"totals" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"note" text,
	"closed_by" uuid
);
--> statement-breakpoint
CREATE TABLE "coupons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"code" text NOT NULL,
	"description" text,
	"type" text DEFAULT 'percent' NOT NULL,
	"value" numeric(12, 2) NOT NULL,
	"min_subtotal" numeric(12, 2) DEFAULT '0' NOT NULL,
	"max_uses" integer,
	"used_count" integer DEFAULT 0 NOT NULL,
	"expires_on" date,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "credit_limit" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "transaction_item_batches" ADD COLUMN "returned_quantity" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "transaction_items" ADD COLUMN "return_of_item_id" uuid;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "kind" text DEFAULT 'sale' NOT NULL;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "ref_transaction_id" uuid;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "return_reason" text;--> statement-breakpoint
ALTER TABLE "cash_closes" ADD CONSTRAINT "cash_closes_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coupons" ADD CONSTRAINT "coupons_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cash_closes_tenant" ON "cash_closes" USING btree ("tenant_id","closed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "coupons_code_uq" ON "coupons" USING btree ("tenant_id","code");--> statement-breakpoint
CREATE INDEX "tx_ref" ON "transactions" USING btree ("ref_transaction_id");