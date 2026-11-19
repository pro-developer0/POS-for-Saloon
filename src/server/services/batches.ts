import { and, asc, eq, sql } from "drizzle-orm";
import type { DB } from "@/db/client";
import { inventoryMovements, notifications, productBatches, products } from "@/db/schema";
import { AppError, audit, need, needModule, type Ctx } from "../ctx";
import { hasModule } from "@/lib/verticals";
import { addDays, zonedParts } from "@/lib/time";

export const batchesOn = (ctx: Pick<Ctx, "tenant">) => hasModule(ctx.tenant, "batches");
export const todayLocal = (ctx: Pick<Ctx, "tenant">) => zonedParts(new Date(), ctx.tenant.timezone).date;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export function validateBatchInput(ctx: Pick<Ctx, "tenant">, batchNo: unknown, expiry: unknown) {
  const no = String(batchNo ?? "").trim();
  const exp = String(expiry ?? "").trim();
  if (!no || no.length > 60) throw new AppError("Batch number is required (max 60 characters).");
  if (!DATE_RE.test(exp) || isNaN(Date.parse(exp))) throw new AppError("A valid expiry date is required.");
  if (exp < todayLocal(ctx)) throw new AppError("This batch is already expired and cannot be added to stock.");
  return { batchNo: no, expiryDate: exp };
}

/**
 * Takes `units` from in-date batches, soonest expiry first (FEFO), locking the batch rows.
 * Returns null when the product has no batch rows at all (legacy / un-batched stock) so callers fall back to plain stock.
 * Expired units are never sold.
 */
export async function allocateFefo(tx: DB, ctx: Ctx, productId: string, units: number, name: string) {
  const rows = await tx.select().from(productBatches)
    .where(and(eq(productBatches.tenantId, ctx.tenantId), eq(productBatches.productId, productId), sql`${productBatches.quantity} > 0`))
    .orderBy(asc(productBatches.expiryDate), asc(productBatches.createdAt)).for("update");
  if (!rows.length) {
    const [any] = await tx.select({ id: productBatches.id }).from(productBatches).where(and(eq(productBatches.tenantId, ctx.tenantId), eq(productBatches.productId, productId))).limit(1);
    if (!any) return null; // never had batches
    throw new AppError(`No stock left for ${name}.`, "conflict");
  }
  const today = todayLocal(ctx);
  const sellable = rows.filter((r) => r.expiryDate >= today);
  const have = sellable.reduce((a, r) => a + r.quantity, 0);
  if (have < units) {
    const expired = rows.filter((r) => r.expiryDate < today).reduce((a, r) => a + r.quantity, 0);
    throw new AppError(`Not enough in-date stock for ${name}: ${have} available${expired ? `; ${expired} expired unit(s) cannot be sold` : ""}.`, "conflict");
  }
  const out: { batchId: string; qty: number }[] = [];
  let need = units;
  for (const b of sellable) {
    if (need <= 0) break;
    const take = Math.min(b.quantity, need);
    const [u] = await tx.update(productBatches).set({ quantity: sql`${productBatches.quantity} - ${take}` })
      .where(and(eq(productBatches.id, b.id), eq(productBatches.tenantId, ctx.tenantId), sql`${productBatches.quantity} >= ${take}`)).returning({ id: productBatches.id });
    if (!u) throw new AppError(`Stock for ${name} changed while selling. Please try again.`, "conflict");
    out.push({ batchId: b.id, qty: take });
    need -= take;
  }
  return out;
}

/** Adds stock to a batch (creating it if new) and keeps products.quantity in step. Records a movement. */
export async function addBatchStock(tx: DB, ctx: Pick<Ctx, "tenantId" | "userId" | "tenant">, a: {
  productId: string; batchNo: string; expiryDate: string; units: number; costPrice?: string | null;
  reason: "initial" | "purchase" | "adjustment"; refType?: string; refId?: string; note?: string;
}) {
  if (!Number.isInteger(a.units) || a.units <= 0) throw new AppError("Quantity must be a positive whole number.");
  const [b] = await tx.insert(productBatches).values({ tenantId: ctx.tenantId, productId: a.productId, batchNo: a.batchNo, expiryDate: a.expiryDate, quantity: a.units, costPrice: a.costPrice ?? null })
    .onConflictDoUpdate({ target: [productBatches.productId, productBatches.batchNo, productBatches.expiryDate], set: { quantity: sql`${productBatches.quantity} + ${a.units}` }, setWhere: eq(productBatches.tenantId, ctx.tenantId) })
    .returning({ id: productBatches.id });
  if (!b) throw new AppError("Batch could not be saved.", "conflict");
  const [p] = await tx.update(products).set({ quantity: sql`${products.quantity} + ${a.units}` }).where(and(eq(products.id, a.productId), eq(products.tenantId, ctx.tenantId))).returning({ q: products.quantity });
  if (!p) throw new AppError("Product not found", "not_found");
  await tx.insert(inventoryMovements).values({ tenantId: ctx.tenantId, productId: a.productId, delta: a.units, balanceAfter: p.q, reason: a.reason, refType: a.refType, refId: a.refId, note: a.note ?? `Batch ${a.batchNo}`, batchId: b.id, userId: ctx.userId });
  return p.q;
}

/** Removes units from one batch (damage, count correction, expiry write-off). */
export async function removeBatchStock(tx: DB, ctx: Pick<Ctx, "tenantId" | "userId">, a: { batchId: string; units: number; reason: string; note?: string }) {
  if (!Number.isInteger(a.units) || a.units <= 0) throw new AppError("Quantity must be a positive whole number.");
  const [b] = await tx.update(productBatches).set({ quantity: sql`${productBatches.quantity} - ${a.units}` })
    .where(and(eq(productBatches.id, a.batchId), eq(productBatches.tenantId, ctx.tenantId), sql`${productBatches.quantity} >= ${a.units}`)).returning({ productId: productBatches.productId, batchNo: productBatches.batchNo });
  if (!b) throw new AppError("Batch not found or it has fewer units than requested.", "conflict");
  const [p] = await tx.update(products).set({ quantity: sql`${products.quantity} - ${a.units}` }).where(and(eq(products.id, b.productId), eq(products.tenantId, ctx.tenantId))).returning({ q: products.quantity });
  await tx.insert(inventoryMovements).values({ tenantId: ctx.tenantId, productId: b.productId, delta: -a.units, balanceAfter: p.q, reason: a.reason, note: a.note ?? `Batch ${b.batchNo}`, batchId: a.batchId, userId: ctx.userId });
  return p.q;
}

/** Writes off everything left in a batch (typically expired stock). */
export async function writeOffBatch(ctx: Ctx, batchId: string, note?: string) {
  need(ctx, "inventory.manage"); needModule(ctx, "batches");
  return ctx.db.transaction(async (tx) => {
    const [b] = await tx.select().from(productBatches).where(and(eq(productBatches.id, batchId), eq(productBatches.tenantId, ctx.tenantId))).for("update");
    if (!b) throw new AppError("Batch not found", "not_found");
    if (b.quantity <= 0) throw new AppError("Nothing left in this batch.");
    await removeBatchStock(tx as unknown as DB, ctx, { batchId, units: b.quantity, reason: "expired", note: note || `Written off: batch ${b.batchNo} (expiry ${b.expiryDate})` });
    await audit({ ...ctx, db: tx as unknown as DB }, "batch.writeoff", "batch", batchId, { units: b.quantity });
    return b.quantity;
  });
}

export async function listBatches(ctx: Ctx, productId: string) {
  need(ctx, "inventory.view");
  return ctx.db.select().from(productBatches).where(and(eq(productBatches.tenantId, ctx.tenantId), eq(productBatches.productId, productId))).orderBy(asc(productBatches.expiryDate));
}

export type ExpiryRow = { batchId: string; productId: string; name: string; genericName: string | null; strength: string | null; batchNo: string; expiryDate: string; quantity: number; daysLeft: number };

/** Batches with stock that are expired or expire within `withinDays`. */
export async function expiryReport(ctx: Ctx, withinDays = 90): Promise<ExpiryRow[]> {
  need(ctx, "inventory.view");
  if (!batchesOn(ctx)) return [];
  const today = todayLocal(ctx), cutoff = addDays(today, withinDays);
  const rows = await ctx.db.select({ b: productBatches, name: products.name, generic: products.genericName, strength: products.strength })
    .from(productBatches).innerJoin(products, eq(products.id, productBatches.productId))
    .where(and(eq(productBatches.tenantId, ctx.tenantId), sql`${productBatches.quantity} > 0`, sql`${productBatches.expiryDate} <= ${cutoff}`)).orderBy(asc(productBatches.expiryDate)).limit(500);
  const t0 = Date.parse(today);
  return rows.map((r) => ({ batchId: r.b.id, productId: r.b.productId, name: r.name, genericName: r.generic, strength: r.strength, batchNo: r.b.batchNo, expiryDate: r.b.expiryDate, quantity: r.b.quantity, daysLeft: Math.round((Date.parse(r.b.expiryDate) - t0) / 864e5) }));
}

export const expirySummary = (rows: ExpiryRow[]) => ({
  expired: rows.filter((r) => r.daysLeft < 0).length,
  d30: rows.filter((r) => r.daysLeft >= 0 && r.daysLeft <= 30).length,
  d60: rows.filter((r) => r.daysLeft > 30 && r.daysLeft <= 60).length,
  d90: rows.filter((r) => r.daysLeft > 60 && r.daysLeft <= 90).length,
});

/** Creates (de-duplicated) in-app notifications for expired / soon-to-expire stock. Safe to call often. */
export async function expiryNotify(ctx: Ctx) {
  if (!batchesOn(ctx)) return;
  const rows = await expiryReport(ctx, 30);
  if (!rows.length) return;
  await ctx.db.insert(notifications).values(rows.slice(0, 100).map((r) => {
    const expired = r.daysLeft < 0;
    return { tenantId: ctx.tenantId, kind: "expiry", title: expired ? `Expired: ${r.name} (batch ${r.batchNo})` : `Expiring soon: ${r.name} (batch ${r.batchNo})`,
      body: expired ? `${r.quantity} unit(s) expired on ${r.expiryDate}. Remove them from stock.` : `${r.quantity} unit(s) expire on ${r.expiryDate} (${r.daysLeft} day(s) left).`, link: "/expiry", dedupeKey: `exp:${r.batchId}:${expired ? "expired" : "30"}` };
  })).onConflictDoNothing();
}

/** Per product: units that can still be sold (in-date) and the nearest in-date expiry. Only products with batches appear. */
export async function sellableMap(ctx: Ctx) {
  const today = todayLocal(ctx);
  const rows = await ctx.db.select({
    productId: productBatches.productId,
    sellable: sql<number>`coalesce(sum(case when ${productBatches.expiryDate} >= ${today} then ${productBatches.quantity} else 0 end),0)::int`,
    expired: sql<number>`coalesce(sum(case when ${productBatches.expiryDate} < ${today} then ${productBatches.quantity} else 0 end),0)::int`,
    nearest: sql<string | null>`min(case when ${productBatches.expiryDate} >= ${today} and ${productBatches.quantity} > 0 then ${productBatches.expiryDate} end)`,
  }).from(productBatches).where(eq(productBatches.tenantId, ctx.tenantId)).groupBy(productBatches.productId);
  return new Map(rows.map((r) => [r.productId, r]));
}

/** Batches that still hold stock, grouped by product (used by the stock-adjust form). */
export async function batchesByProduct(ctx: Ctx) {
  need(ctx, "inventory.view");
  const rows = await ctx.db.select().from(productBatches).where(and(eq(productBatches.tenantId, ctx.tenantId), sql`${productBatches.quantity} > 0`)).orderBy(asc(productBatches.expiryDate));
  const m = new Map<string, typeof rows>();
  for (const r of rows) m.set(r.productId, [...(m.get(r.productId) ?? []), r]);
  return m;
}
