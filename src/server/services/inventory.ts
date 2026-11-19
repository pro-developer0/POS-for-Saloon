import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { products, inventoryMovements, suppliers, purchases, purchaseItems, expenses, productBatches } from "@/db/schema";
import type { DB } from "@/db/client";
import { AppError, audit, need, type Ctx } from "../ctx";
import { addBatchStock, batchesOn, removeBatchStock, validateBatchInput } from "./batches";
import { fromCents, toCents } from "@/lib/money";

const money = z.coerce.number().min(0).max(10_000_000).transform((n) => n.toFixed(2));
const emptyToNull = (v: unknown) => (v === "" ? null : v);

export const productSchema = z.object({
  name: z.string().trim().min(1).max(150),
  sku: z.preprocess(emptyToNull, z.string().trim().max(60).nullable().optional()),
  barcode: z.preprocess(emptyToNull, z.string().trim().max(60).nullable().optional()),
  category: z.preprocess(emptyToNull, z.string().trim().max(60).nullable().optional()),
  description: z.preprocess(emptyToNull, z.string().max(1000).nullable().optional()),
  costPrice: money, sellPrice: money,
  minStock: z.coerce.number().int().min(0).default(5),
  supplierId: z.preprocess(emptyToNull, z.string().uuid().nullable().optional()),
  taxable: z.boolean().default(true), active: z.boolean().default(true), trackStock: z.boolean().default(true),
  initialQuantity: z.coerce.number().int().min(0).default(0),
  // pharmacy / pack selling
  genericName: z.preprocess(emptyToNull, z.string().trim().max(150).nullable().optional()),
  strength: z.preprocess(emptyToNull, z.string().trim().max(60).nullable().optional()),
  dosageForm: z.preprocess(emptyToNull, z.string().trim().max(60).nullable().optional()),
  unitLabel: z.preprocess((v) => (v === "" ? undefined : v), z.string().trim().max(20).default("unit")),
  packLabel: z.preprocess(emptyToNull, z.string().trim().max(20).nullable().optional()),
  unitsPerPack: z.preprocess((v) => (v === "" ? undefined : v), z.coerce.number().int().min(1).max(100000).default(1)),
  packPrice: z.preprocess(emptyToNull, z.coerce.number().min(0).max(10_000_000).transform((n) => n.toFixed(2)).nullable().optional()),
  // opening stock batch (required when the business uses batches and opening quantity > 0)
  batchNo: z.preprocess(emptyToNull, z.string().trim().max(60).nullable().optional()),
  openingExpiry: z.preprocess(emptyToNull, z.string().nullable().optional()),
});

export async function listProducts(ctx: Ctx, o: { q?: string; lowOnly?: boolean } = {}) {
  need(ctx, "inventory.view");
  const rows = await ctx.db.select({ p: products, supplierName: suppliers.name }).from(products)
    .leftJoin(suppliers, eq(suppliers.id, products.supplierId)).where(eq(products.tenantId, ctx.tenantId)).orderBy(asc(products.name));
  return rows.filter((r) => (!o.q || r.p.name.toLowerCase().includes(o.q.toLowerCase()) || (r.p.sku ?? "").toLowerCase().includes(o.q.toLowerCase()) || (r.p.barcode ?? "") === o.q) && (!o.lowOnly || (r.p.trackStock && r.p.quantity <= r.p.minStock)));
}

async function assertSupplier(ctx: Ctx, id?: string | null) {
  if (!id) return;
  const [s] = await ctx.db.select({ id: suppliers.id }).from(suppliers).where(and(eq(suppliers.id, id), eq(suppliers.tenantId, ctx.tenantId)));
  if (!s) throw new AppError("Invalid supplier");
}

export async function saveProduct(ctx: Ctx, raw: unknown, id?: string) {
  need(ctx, "inventory.manage");
  const { initialQuantity, batchNo, openingExpiry, ...v } = productSchema.parse(raw);
  if (v.unitsPerPack > 1 && !v.packLabel) v.packLabel = "pack";
  await assertSupplier(ctx, v.supplierId);
  if (id) {
    const r = await ctx.db.update(products).set(v as never).where(and(eq(products.id, id), eq(products.tenantId, ctx.tenantId))).returning({ id: products.id });
    if (!r.length) throw new AppError("Product not found", "not_found");
    return id;
  }
  const batched = batchesOn(ctx) && v.trackStock && initialQuantity > 0;
  const opening = batched ? validateBatchInput(ctx, batchNo, openingExpiry) : null;
  return ctx.db.transaction(async (tx) => {
    const [p] = await tx.insert(products).values({ ...v, tenantId: ctx.tenantId, quantity: batched ? 0 : initialQuantity } as never).returning();
    if (opening) { await addBatchStock(tx as unknown as DB, ctx, { productId: p.id, batchNo: opening.batchNo, expiryDate: opening.expiryDate, units: initialQuantity, costPrice: v.costPrice, reason: "initial" }); return p.id; }
    if (initialQuantity > 0) await tx.insert(inventoryMovements).values({ tenantId: ctx.tenantId, productId: p.id, delta: initialQuantity, balanceAfter: initialQuantity, reason: "initial", userId: ctx.userId });
    return p.id;
  });
}

/** Manual stock change. Every change writes an immutable movement row. Batch businesses must say which batch. */
export async function adjustStock(ctx: Ctx, productId: string, delta: number, reason: "adjustment" | "purchase" | "damage", note?: string, opts: { batchId?: string; batchNo?: string; expiryDate?: string } = {}) {
  need(ctx, "inventory.manage");
  if (!Number.isInteger(delta) || delta === 0) throw new AppError("Quantity change must be a non-zero whole number");
  return ctx.db.transaction(async (tx) => {
    const d = tx as unknown as DB;
    const [prod] = await tx.select().from(products).where(and(eq(products.id, productId), eq(products.tenantId, ctx.tenantId))).for("update");
    if (!prod) throw new AppError("Product not found", "not_found");
    if (batchesOn(ctx) && prod.trackStock) {
      const [any] = await tx.select({ id: productBatches.id }).from(productBatches).where(and(eq(productBatches.productId, productId), eq(productBatches.tenantId, ctx.tenantId))).limit(1);
      if (delta > 0) {
        if (opts.batchId) {
          const [b] = await tx.select().from(productBatches).where(and(eq(productBatches.id, opts.batchId), eq(productBatches.productId, productId), eq(productBatches.tenantId, ctx.tenantId)));
          if (!b) throw new AppError("Batch not found", "not_found");
          return addBatchStock(d, ctx, { productId, batchNo: b.batchNo, expiryDate: b.expiryDate, units: delta, reason: "adjustment", note });
        }
        const nb = validateBatchInput(ctx, opts.batchNo, opts.expiryDate);
        return addBatchStock(d, ctx, { productId, batchNo: nb.batchNo, expiryDate: nb.expiryDate, units: delta, reason: reason === "purchase" ? "purchase" : "adjustment", note });
      }
      if (any) {
        if (!opts.batchId) throw new AppError("Choose which batch to remove stock from.");
        return removeBatchStock(d, ctx, { batchId: opts.batchId, units: -delta, reason, note });
      }
    }
    const [p] = await tx.update(products).set({ quantity: sql`${products.quantity} + ${delta}` })
      .where(and(eq(products.id, productId), eq(products.tenantId, ctx.tenantId), sql`${products.quantity} + ${delta} >= 0`)).returning({ q: products.quantity });
    if (!p) throw new AppError("Stock cannot go below zero", "conflict");
    await tx.insert(inventoryMovements).values({ tenantId: ctx.tenantId, productId, delta, balanceAfter: p.q, reason, note, userId: ctx.userId });
    return p.q;
  });
}

export async function stockHistory(ctx: Ctx, productId: string) {
  need(ctx, "inventory.view");
  return ctx.db.select().from(inventoryMovements).where(and(eq(inventoryMovements.productId, productId), eq(inventoryMovements.tenantId, ctx.tenantId))).orderBy(desc(inventoryMovements.createdAt)).limit(200);
}

export async function stockValuation(ctx: Ctx) {
  need(ctx, "inventory.view");
  const rows = await ctx.db.select({ q: products.quantity, c: products.costPrice, s: products.sellPrice }).from(products).where(and(eq(products.tenantId, ctx.tenantId), eq(products.active, true), eq(products.trackStock, true)));
  return { cost: fromCents(rows.reduce((a, r) => a + r.q * toCents(r.c), 0)), retail: fromCents(rows.reduce((a, r) => a + r.q * toCents(r.s), 0)) };
}

// ---------- Suppliers ----------
export const supplierSchema = z.object({
  name: z.string().trim().min(1).max(150),
  contactName: z.preprocess(emptyToNull, z.string().max(100).nullable().optional()),
  phone: z.preprocess(emptyToNull, z.string().max(40).nullable().optional()),
  email: z.preprocess(emptyToNull, z.string().email().nullable().optional()),
  address: z.preprocess(emptyToNull, z.string().max(300).nullable().optional()),
  notes: z.preprocess(emptyToNull, z.string().max(1000).nullable().optional()),
});
export async function listSuppliers(ctx: Ctx) {
  need(ctx, "inventory.view");
  return ctx.db.select().from(suppliers).where(and(eq(suppliers.tenantId, ctx.tenantId), eq(suppliers.archived, false))).orderBy(asc(suppliers.name));
}
export async function saveSupplier(ctx: Ctx, raw: unknown, id?: string) {
  need(ctx, "suppliers.manage");
  const v = supplierSchema.parse(raw);
  if (id) {
    const r = await ctx.db.update(suppliers).set(v as never).where(and(eq(suppliers.id, id), eq(suppliers.tenantId, ctx.tenantId))).returning({ id: suppliers.id });
    if (!r.length) throw new AppError("Supplier not found", "not_found");
    return id;
  }
  const [s] = await ctx.db.insert(suppliers).values({ ...v, tenantId: ctx.tenantId } as never).returning();
  return s.id;
}

// ---------- Purchases ----------
export const purchaseSchema = z.object({
  supplierId: z.string().uuid(), reference: z.string().max(60).optional().nullable(), notes: z.string().max(500).optional().nullable(),
  items: z.array(z.object({
    productId: z.string().uuid(), quantity: z.coerce.number().int().min(1).max(100000), unitCost: money, // quantity & cost are per ordered unit (a pack if packs = true)
    packs: z.boolean().default(false),
    batchNo: z.preprocess(emptyToNull, z.string().trim().max(60).nullable().optional()), expiryDate: z.preprocess(emptyToNull, z.string().nullable().optional()),
  })).min(1),
});
export async function createPurchase(ctx: Ctx, raw: unknown) {
  need(ctx, "suppliers.manage");
  const v = purchaseSchema.parse(raw);
  await assertSupplier(ctx, v.supplierId);
  const owned = await ctx.db.select({ id: products.id, unitsPerPack: products.unitsPerPack, trackStock: products.trackStock }).from(products).where(and(eq(products.tenantId, ctx.tenantId), inArray(products.id, v.items.map((i) => i.productId))));
  if (owned.length !== new Set(v.items.map((i) => i.productId)).size) throw new AppError("Invalid product in purchase");
  const pm = new Map(owned.map((o) => [o.id, o]));
  const lines = v.items.map((i) => {
    const prod = pm.get(i.productId)!;
    if (i.packs && prod.unitsPerPack <= 1) throw new AppError("That product has no pack size set.");
    const batch = batchesOn(ctx) && prod.trackStock ? validateBatchInput(ctx, i.batchNo, i.expiryDate) : null;
    return { ...i, unitsPerLine: i.packs ? prod.unitsPerPack : 1, batchNo: batch?.batchNo ?? null, expiryDate: batch?.expiryDate ?? null };
  });
  const total = v.items.reduce((s, i) => s + i.quantity * toCents(i.unitCost), 0);
  return ctx.db.transaction(async (tx) => {
    const [p] = await tx.insert(purchases).values({ tenantId: ctx.tenantId, supplierId: v.supplierId, reference: v.reference ?? null, notes: v.notes ?? null, total: fromCents(total) }).returning();
    await tx.insert(purchaseItems).values(lines.map((i) => ({ tenantId: ctx.tenantId, purchaseId: p.id, productId: i.productId, quantity: i.quantity, unitCost: i.unitCost, unitsPerLine: i.unitsPerLine, batchNo: i.batchNo, expiryDate: i.expiryDate })));
    return p.id;
  });
}

/** Receiving is idempotent: only an 'ordered' purchase can be received, once. */
export async function receivePurchase(ctx: Ctx, purchaseId: string) {
  need(ctx, "suppliers.manage");
  return ctx.db.transaction(async (tx) => {
    const [p] = await tx.update(purchases).set({ status: "received", receivedAt: new Date() })
      .where(and(eq(purchases.id, purchaseId), eq(purchases.tenantId, ctx.tenantId), eq(purchases.status, "ordered"))).returning();
    if (!p) throw new AppError("Purchase not found or already received/cancelled", "conflict");
    const items = await tx.select().from(purchaseItems).where(and(eq(purchaseItems.purchaseId, purchaseId), eq(purchaseItems.tenantId, ctx.tenantId)));
    for (const i of items) {
      const units = i.quantity * i.unitsPerLine;
      const perUnit = fromCents(Math.round(toCents(i.unitCost) / i.unitsPerLine)); // cost per base unit
      if (i.batchNo && i.expiryDate && batchesOn(ctx)) {
        const b = validateBatchInput(ctx, i.batchNo, i.expiryDate); // refuses a batch that expired while the order was open
        await addBatchStock(tx as unknown as DB, ctx, { productId: i.productId, batchNo: b.batchNo, expiryDate: b.expiryDate, units, costPrice: perUnit, reason: "purchase", refType: "purchase", refId: purchaseId });
        await tx.update(products).set({ costPrice: perUnit }).where(and(eq(products.id, i.productId), eq(products.tenantId, ctx.tenantId)));
        continue;
      }
      const [u] = await tx.update(products).set({ quantity: sql`${products.quantity} + ${units}`, costPrice: perUnit }).where(and(eq(products.id, i.productId), eq(products.tenantId, ctx.tenantId))).returning({ q: products.quantity });
      await tx.insert(inventoryMovements).values({ tenantId: ctx.tenantId, productId: i.productId, delta: units, balanceAfter: u.q, reason: "purchase", refType: "purchase", refId: purchaseId, userId: ctx.userId });
    }
    await audit({ ...ctx, db: tx as unknown as Ctx["db"] }, "purchase.receive", "purchase", purchaseId);
  });
}
export async function cancelPurchase(ctx: Ctx, id: string) {
  need(ctx, "suppliers.manage");
  const r = await ctx.db.update(purchases).set({ status: "cancelled" }).where(and(eq(purchases.id, id), eq(purchases.tenantId, ctx.tenantId), eq(purchases.status, "ordered"))).returning({ id: purchases.id });
  if (!r.length) throw new AppError("Only open purchases can be cancelled", "conflict");
}
export async function listPurchases(ctx: Ctx) {
  need(ctx, "inventory.view");
  return ctx.db.select({ p: purchases, supplierName: suppliers.name }).from(purchases).leftJoin(suppliers, eq(suppliers.id, purchases.supplierId))
    .where(eq(purchases.tenantId, ctx.tenantId)).orderBy(desc(purchases.orderedAt)).limit(200);
}

// ---------- Expenses ----------
export const expenseSchema = z.object({
  name: z.string().trim().min(1).max(150), category: z.string().trim().min(1).max(60).default("General"),
  amount: money.refine((a) => toCents(a) > 0, "Amount must be positive"),
  spentOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  paymentMethod: z.string().max(30).default("cash"),
  supplierId: z.preprocess(emptyToNull, z.string().uuid().nullable().optional()),
  description: z.preprocess(emptyToNull, z.string().max(1000).nullable().optional()),
  receiptUrl: z.preprocess(emptyToNull, z.string().max(500).nullable().optional()),
});
export async function saveExpense(ctx: Ctx, raw: unknown, id?: string) {
  need(ctx, "expenses.manage");
  const v = expenseSchema.parse(raw);
  await assertSupplier(ctx, v.supplierId);
  if (id) {
    const r = await ctx.db.update(expenses).set(v as never).where(and(eq(expenses.id, id), eq(expenses.tenantId, ctx.tenantId))).returning({ id: expenses.id });
    if (!r.length) throw new AppError("Expense not found", "not_found");
    return id;
  }
  const [e] = await ctx.db.insert(expenses).values({ ...v, tenantId: ctx.tenantId } as never).returning();
  await audit(ctx, "expense.create", "expense", e.id);
  return e.id;
}
export async function deleteExpense(ctx: Ctx, id: string) {
  need(ctx, "expenses.manage");
  await ctx.db.delete(expenses).where(and(eq(expenses.id, id), eq(expenses.tenantId, ctx.tenantId)));
  await audit(ctx, "expense.delete", "expense", id);
}
export async function listExpenses(ctx: Ctx, fromDate: string, toDate: string) {
  need(ctx, "expenses.view");
  return ctx.db.select().from(expenses).where(and(eq(expenses.tenantId, ctx.tenantId), sql`${expenses.spentOn} >= ${fromDate} and ${expenses.spentOn} < ${toDate}`)).orderBy(desc(expenses.spentOn));
}
