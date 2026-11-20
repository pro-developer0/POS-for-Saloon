import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import type { DB } from "@/db/client";
import { commissions, customers, invoices, inventoryMovements, payments, products, services, staff, tenants, transactionItems, transactions } from "@/db/schema";
import { AppError, audit, need, type Ctx } from "../ctx";
import { fromCents, pctOf, toCents } from "@/lib/money";
import { saleBalances } from "./ledger";

/**
 * Returns / refunds are CREDIT NOTES: new transactions (kind = 'return') with negative amounts that point at the sale.
 * The original sale is never edited, so history stays auditable, and every report (sales, tax, items, commissions,
 * payments) nets returns out automatically because it simply sums the negatives.
 */
export const returnSchema = z.object({
  saleId: z.string().uuid(),
  idempotencyKey: z.string().min(8).max(100),
  reason: z.string().trim().min(3, "Please give a reason for the return").max(300),
  refundMethod: z.string().trim().max(30).optional().nullable(),
  lines: z.array(z.object({ itemId: z.string().uuid(), quantity: z.coerce.number().int().min(1).max(9999), restock: z.boolean().default(true) }))
    .min(1, "Choose at least one item to return").max(100),
});

export async function returnableLines(ctx: Ctx, saleId: string) {
  need(ctx, "invoices.view");
  const items = await ctx.db.select().from(transactionItems).where(and(eq(transactionItems.transactionId, saleId), eq(transactionItems.tenantId, ctx.tenantId)));
  if (!items.length) return [];
  const prev = await ctx.db.select({ id: transactionItems.returnOfItemId, q: sql<number>`coalesce(sum(${transactionItems.quantity}),0)::int` }).from(transactionItems)
    .where(and(eq(transactionItems.tenantId, ctx.tenantId), inArray(transactionItems.returnOfItemId, items.map((i) => i.id)))).groupBy(transactionItems.returnOfItemId);
  const pm = new Map(prev.map((p) => [p.id, -p.q]));
  return items.map((item) => ({ item, returned: pm.get(item.id) ?? 0, returnable: item.quantity - (pm.get(item.id) ?? 0) }));
}

export async function listCreditNotes(ctx: Ctx, saleId: string) {
  need(ctx, "invoices.view");
  return ctx.db.select({ t: transactions, number: invoices.number }).from(transactions).innerJoin(invoices, eq(invoices.transactionId, transactions.id))
    .where(and(eq(transactions.tenantId, ctx.tenantId), eq(transactions.refTransactionId, saleId), eq(transactions.kind, "return"))).orderBy(asc(transactions.createdAt));
}

export type ReturnResult = { transactionId: string; number: string; refund: string; cashRefund: string; debtReduced: string; duplicate?: boolean };

export async function createReturn(ctx: Ctx, raw: unknown): Promise<ReturnResult> {
  need(ctx, "sales.refund");
  const v = returnSchema.parse(raw);
  if (new Set(v.lines.map((l) => l.itemId)).size !== v.lines.length) throw new AppError("Each item can appear only once.");

  const existing = async () => {
    const [dup] = await ctx.db.select().from(transactions).where(and(eq(transactions.tenantId, ctx.tenantId), eq(transactions.idempotencyKey, v.idempotencyKey)));
    if (!dup) return null;
    const [inv] = await ctx.db.select().from(invoices).where(eq(invoices.transactionId, dup.id));
    const total = toCents(dup.total) * -1, cash = toCents(dup.paid) * -1;
    return { transactionId: dup.id, number: inv?.number ?? "", refund: fromCents(total), cashRefund: fromCents(cash), debtReduced: fromCents(total - cash), duplicate: true } as ReturnResult;
  };
  const dup = await existing();
  if (dup) return dup;

  try {
    return await ctx.db.transaction(async (tx) => {
      const d = tx as unknown as DB;
      const t = ctx.tenant;
      const [sale] = await tx.select().from(transactions).where(and(eq(transactions.id, v.saleId), eq(transactions.tenantId, ctx.tenantId), eq(transactions.kind, "sale"))).for("update");
      if (!sale) throw new AppError("Sale not found", "not_found");
      if (sale.status === "cancelled") throw new AppError("This sale was voided and cannot be returned.");

      const lines = await returnableLines({ ...ctx, db: d }, sale.id);
      const byId = new Map(lines.map((l) => [l.item.id, l]));

      type NoteLine = { item: (typeof lines)[number]["item"]; q: number; gross: number; disc: number; tax: number; amount: number; units: number };
      const note: NoteLine[] = v.lines.map((l) => {
        const row = byId.get(l.itemId);
        if (!row) throw new AppError("That item does not belong to this sale.", "not_found");
        if (l.quantity > row.returnable) throw new AppError(row.returnable <= 0 ? `"${row.item.name}" has already been fully returned.` : `Only ${row.returnable} of "${row.item.name}" can still be returned.`);
        const item = row.item, n = item.quantity, k0 = row.returned, k1 = row.returned + l.quantity;
        // cumulative rounding keeps repeated partial returns summing exactly to the original line
        const cum = (cents: number, k: number) => Math.round((cents * k) / n);
        const disc = cum(toCents(item.discount), k1) - cum(toCents(item.discount), k0);
        const tax = cum(toCents(item.tax), k1) - cum(toCents(item.tax), k0);
        const gross = toCents(item.unitPrice) * l.quantity;
        return { item, q: l.quantity, gross, disc, tax, amount: gross - disc + tax, units: l.restock && item.kind === "product" ? l.quantity : 0 };
      });
      const R = note.reduce((s, l) => s + l.amount, 0), G = note.reduce((s, l) => s + l.gross, 0), DISC = note.reduce((s, l) => s + l.disc, 0), TAX = note.reduce((s, l) => s + l.tax, 0);
      if (R <= 0) throw new AppError("Nothing to refund.");

      // Money: first cancel what the customer still owes on this sale, pay back cash only for the rest.
      const D = (await saleBalances(d, ctx.tenantId, [sale.id])).get(sale.id) ?? 0;
      const debtReduced = Math.min(R, Math.max(0, D));
      const cash = R - debtReduced;
      if (cash > 0) {
        if (!v.refundMethod) throw new AppError("Choose how the refund is paid.");
        if (!t.paymentMethods.includes(v.refundMethod)) throw new AppError(`Payment method "${v.refundMethod}" is not enabled.`);
        const [np] = await tx.select({ p: sql<string>`coalesce(sum(${transactions.paid}),0)` }).from(transactions).where(and(eq(transactions.tenantId, ctx.tenantId), eq(transactions.refTransactionId, sale.id), eq(transactions.kind, "return")));
        if (cash > toCents(sale.paid) + toCents(np.p)) throw new AppError("The refund is larger than the amount actually paid on this sale.", "conflict");
      }

      const [tn] = await tx.update(tenants).set({ invoiceCounter: sql`${tenants.invoiceCounter} + 1` }).where(eq(tenants.id, ctx.tenantId)).returning({ n: tenants.invoiceCounter });
      const number = `CN-${String(tn.n).padStart(5, "0")}`;
      const [cn] = await tx.insert(transactions).values({
        tenantId: ctx.tenantId, customerId: sale.customerId, staffId: sale.staffId, idempotencyKey: v.idempotencyKey,
        subtotal: fromCents(-G), discount: fromCents(-DISC), tax: fromCents(-TAX), total: fromCents(-R), paid: fromCents(-cash),
        status: "paid", kind: "return", refTransactionId: sale.id, returnReason: v.reason, createdBy: ctx.userId,
      }).returning();
      await tx.insert(invoices).values({ tenantId: ctx.tenantId, transactionId: cn.id, number });
      await tx.insert(transactionItems).values(note.map((l) => ({
        tenantId: ctx.tenantId, transactionId: cn.id, kind: l.item.kind, serviceId: l.item.serviceId, productId: l.item.productId, staffId: l.item.staffId,
        name: l.item.name, quantity: -l.q, unitPrice: l.item.unitPrice,
        discount: fromCents(-l.disc), tax: fromCents(-l.tax), lineTotal: fromCents(-l.amount), returnOfItemId: l.item.id,
      })));
      if (cash > 0) await tx.insert(payments).values({ tenantId: ctx.tenantId, transactionId: cn.id, method: v.refundMethod!, amount: fromCents(-cash), note: `Refund: ${v.reason}`, createdBy: ctx.userId });

      // Put stock back for restocked product lines.
      for (const l of note.filter((x) => x.units > 0 && x.item.productId)) {
        const [p] = await tx.update(products).set({ quantity: sql`${products.quantity} + ${l.units}` })
          .where(and(eq(products.id, l.item.productId!), eq(products.tenantId, ctx.tenantId))).returning({ q: products.quantity });
        if (!p) continue;
        await tx.insert(inventoryMovements).values({ tenantId: ctx.tenantId, productId: l.item.productId!, delta: l.units, balanceAfter: p.q, reason: "return", refType: "transaction", refId: cn.id, userId: ctx.userId });
      }

      // Take back commission earned on returned service lines.
      for (const l of note.filter((x) => x.item.kind === "service" && x.item.staffId && x.item.serviceId)) {
        const [svc] = await tx.select({ pct: services.commissionPct }).from(services).where(eq(services.id, l.item.serviceId!));
        const [st] = await tx.select({ pct: staff.commissionPct }).from(staff).where(eq(staff.id, l.item.staffId!));
        const pct = Number(svc?.pct) > 0 ? svc!.pct : st?.pct ?? "0";
        const c = pctOf(l.amount - l.tax, pct);
        if (c > 0) await tx.insert(commissions).values({ tenantId: ctx.tenantId, staffId: l.item.staffId!, transactionId: cn.id, amount: fromCents(-c) });
      }

      if (sale.customerId) {
        const pts = Math.floor(R / 1000) * t.loyaltyPointsPerUnit;
        if (pts > 0) await tx.update(customers).set({ loyaltyPoints: sql`greatest(0, ${customers.loyaltyPoints} - ${pts})` }).where(and(eq(customers.id, sale.customerId), eq(customers.tenantId, ctx.tenantId)));
      }
      const eff = D - debtReduced;
      await tx.update(transactions).set({ status: eff <= 0 ? "paid" : toCents(sale.paid) > 0 ? "partial" : "unpaid" }).where(eq(transactions.id, sale.id));
      await audit({ ...ctx, db: d }, "sale.return", "transaction", cn.id, { saleId: sale.id, refund: fromCents(R), cashRefund: fromCents(cash), reason: v.reason });
      return { transactionId: cn.id, number, refund: fromCents(R), cashRefund: fromCents(cash), debtReduced: fromCents(debtReduced) };
    });
  } catch (e) {
    if (String((e as Error).message).includes("tx_idem_uq") || String((e as { cause?: Error }).cause?.message ?? "").includes("tx_idem_uq")) {
      const again = await existing();
      if (again) return again;
    }
    throw e;
  }
}
export { desc };
