import { desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { DB } from "@/db/client";
import { cashCloses } from "@/db/schema";
import { AppError, audit, need, type Ctx } from "../ctx";
import { fromCents, toCents } from "@/lib/money";
import { zonedToUtc } from "@/lib/time";
import { todayLocal } from "./batches";

/**
 * End-of-day / end-of-shift cash closing.
 * Each close covers the time since the previous close (or the start of today for the first one), so nothing is
 * counted twice. Refunds and customer-account payments are already in the payments table (refunds as negatives).
 */
export type PeriodTotals = {
  salesCount: number; grossSales: number; returns: number; netSales: number; tax: number; discounts: number;
  byMethod: { method: string; total: number }[]; cashIn: number; cashExpenses: number;
};

export async function periodTotals(db: DB, tenantId: string, from: Date, to: Date): Promise<PeriodTotals> {
  const [s] = await db.execute<{ cnt: string; gross: string; ret: string; tax: string; disc: string }>(sql`
    select count(*) filter (where kind = 'sale') cnt,
           coalesce(sum(total) filter (where kind = 'sale'),0) gross, coalesce(sum(-total) filter (where kind = 'return'),0) ret,
           coalesce(sum(tax),0) tax, coalesce(sum(discount),0) disc
    from transactions where tenant_id = ${tenantId} and status <> 'cancelled' and created_at >= ${from} and created_at < ${to}`).then((x) => x.rows);
  const pm = await db.execute<{ method: string; total: string }>(sql`
    select p.method, coalesce(sum(p.amount),0) total from payments p join transactions t on t.id = p.transaction_id
    where p.tenant_id = ${tenantId} and t.status <> 'cancelled' and p.created_at >= ${from} and p.created_at < ${to} group by p.method order by 2 desc`);
  const [e] = await db.execute<{ v: string }>(sql`select coalesce(sum(amount),0) v from expenses where tenant_id = ${tenantId} and payment_method = 'cash' and created_at >= ${from} and created_at < ${to}`).then((x) => x.rows);
  const byMethod = pm.rows.map((r) => ({ method: r.method, total: toCents(r.total) }));
  const gross = toCents(s.gross), ret = toCents(s.ret);
  return { salesCount: Number(s.cnt), grossSales: gross, returns: ret, netSales: gross - ret, tax: toCents(s.tax), discounts: toCents(s.disc), byMethod, cashIn: byMethod.find((m) => m.method === "cash")?.total ?? 0, cashExpenses: toCents(e.v) };
}

async function lastClose(db: DB, tenantId: string) {
  const [last] = await db.select().from(cashCloses).where(eq(cashCloses.tenantId, tenantId)).orderBy(desc(cashCloses.closedAt)).limit(1);
  return last ?? null;
}

export async function closePreview(ctx: Ctx) {
  need(ctx, "pos.use");
  const last = await lastClose(ctx.db, ctx.tenantId);
  const periodStart = last ? last.closedAt : zonedToUtc(todayLocal(ctx), 0, ctx.tenant.timezone);
  const to = new Date();
  const totals = await periodTotals(ctx.db, ctx.tenantId, periodStart, to);
  return { periodStart, to, lastCounted: last ? toCents(last.countedCash) : 0, hasPrevious: !!last, totals };
}

export const closeSchema = z.object({
  openingFloat: z.coerce.number().min(0).max(100_000_000).default(0),
  countedCash: z.coerce.number().min(0).max(100_000_000),
  note: z.string().trim().max(300).optional().nullable(),
});

export async function closeShift(ctx: Ctx, raw: unknown) {
  need(ctx, "pos.use");
  const v = closeSchema.parse(raw);
  return ctx.db.transaction(async (tx) => {
    const d = tx as unknown as DB;
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${"close:" + ctx.tenantId}))`); // two people closing at once cannot double-count
    const last = await lastClose(d, ctx.tenantId);
    const periodStart = last ? last.closedAt : zonedToUtc(todayLocal(ctx), 0, ctx.tenant.timezone);
    const to = new Date();
    if (to <= periodStart) throw new AppError("Nothing to close yet.");
    const totals = await periodTotals(d, ctx.tenantId, periodStart, to);
    const opening = toCents(v.openingFloat.toFixed(2)), counted = toCents(v.countedCash.toFixed(2));
    const expected = opening + totals.cashIn - totals.cashExpenses;
    const [row] = await tx.insert(cashCloses).values({
      tenantId: ctx.tenantId, periodStart, closedAt: to, openingFloat: fromCents(opening), expectedCash: fromCents(expected), countedCash: fromCents(counted), difference: fromCents(counted - expected),
      totals: totals as unknown as Record<string, unknown>, note: v.note ?? null, closedBy: ctx.userId,
    }).returning();
    await audit({ ...ctx, db: d }, "cash.close", "cash_close", row.id, { expected: fromCents(expected), counted: fromCents(counted), difference: fromCents(counted - expected) });
    return row;
  });
}

export async function listCloses(ctx: Ctx, limit = 30) {
  need(ctx, "pos.use");
  return ctx.db.select().from(cashCloses).where(eq(cashCloses.tenantId, ctx.tenantId)).orderBy(desc(cashCloses.closedAt)).limit(limit);
}
