import { and, eq, sql } from "drizzle-orm";
import { appointments, customers, transactions, transactionItems, payments, commissions, staff, products, services, notifications } from "@/db/schema";
import { need, type Ctx } from "../ctx";
import { fromCents, toCents } from "@/lib/money";
import { resolveRange, type RangeKey } from "@/lib/time";

export type Range = { from: Date; to: Date; fromDate: string; toDate: string };

/**
 * Deterministic financial summary. All numbers come from SQL aggregates scoped to the tenant.
 * Definitions:
 *  - Sales (revenue)  = total of non-cancelled sales created in range (tax included)
 *  - Net sales        = Sales - tax
 *  - Collected        = payments received in range
 *  - Outstanding      = unpaid balance of all non-cancelled sales (all time)
 *  - Net profit       = Net sales - expenses in range (purchases are stock, not expense; COGS not deducted)
 */
export async function salesSummary(ctx: Ctx, r: Range) {
  need(ctx, "dashboard.view");
  const tid = ctx.tenantId;
  const [s] = await ctx.db.execute<{ sales: string; tax: string; count: string; discounts: string }>(sql`
    select coalesce(sum(total),0) sales, coalesce(sum(tax),0) tax, count(*) count, coalesce(sum(discount),0) discounts
    from transactions where tenant_id = ${tid} and status <> 'cancelled' and created_at >= ${r.from} and created_at < ${r.to}`).then((x) => x.rows);
  const [c] = await ctx.db.execute<{ v: string }>(sql`select coalesce(sum(p.amount),0) v from payments p join transactions t on t.id = p.transaction_id
    where p.tenant_id = ${tid} and t.status <> 'cancelled' and p.created_at >= ${r.from} and p.created_at < ${r.to}`).then((x) => x.rows);
  const [o] = await ctx.db.execute<{ v: string }>(sql`select coalesce(sum(total - paid),0) v from transactions where tenant_id = ${tid} and status in ('unpaid','partial')`).then((x) => x.rows);
  const [e] = await ctx.db.execute<{ v: string }>(sql`select coalesce(sum(amount),0) v from expenses where tenant_id = ${tid} and spent_on >= ${r.fromDate} and spent_on < ${r.toDate}`).then((x) => x.rows);
  const sales = toCents(s.sales), tax = toCents(s.tax), n = Number(s.count), exp = toCents(e.v);
  return {
    sales: fromCents(sales), tax: fromCents(tax), netSales: fromCents(sales - tax), transactions: n,
    avgTransaction: n ? fromCents(Math.round(sales / n)) : "0.00", discounts: s.discounts,
    collected: fromCents(toCents(c.v)), outstanding: fromCents(toCents(o.v)), expenses: fromCents(exp), netProfit: fromCents(sales - tax - exp),
  };
}

export async function revenueSeries(ctx: Ctx, r: Range) {
  need(ctx, "dashboard.view");
  const tz = ctx.tenant.timezone;
  const rows = await ctx.db.execute<{ d: string; v: string; n: string }>(sql`
    select to_char(created_at at time zone ${tz}, 'YYYY-MM-DD') d, sum(total) v, count(*) n from transactions
    where tenant_id = ${ctx.tenantId} and status <> 'cancelled' and created_at >= ${r.from} and created_at < ${r.to} group by 1 order by 1`);
  return rows.rows.map((x) => ({ date: x.d, revenue: Number(x.v), count: Number(x.n) }));
}

export async function appointmentStats(ctx: Ctx, r: Range) {
  need(ctx, "dashboard.view");
  const rows = await ctx.db.select({ status: appointments.status, n: sql<number>`count(*)::int` }).from(appointments)
    .where(and(eq(appointments.tenantId, ctx.tenantId), sql`${appointments.startsAt} >= ${r.from} and ${appointments.startsAt} < ${r.to}`)).groupBy(appointments.status);
  const by: Record<string, number> = {};
  rows.forEach((x) => (by[x.status] = x.n));
  const [up] = await ctx.db.select({ n: sql<number>`count(*)::int` }).from(appointments)
    .where(and(eq(appointments.tenantId, ctx.tenantId), sql`${appointments.startsAt} > now() and ${appointments.status} in ('pending','confirmed')`));
  return { byStatus: by, total: rows.reduce((a, x) => a + x.n, 0), upcoming: up.n };
}

export async function customerStats(ctx: Ctx, r: Range) {
  need(ctx, "dashboard.view");
  const [x] = await ctx.db.execute<{ new_c: string; returning_c: string }>(sql`
    select (select count(*) from customers where tenant_id = ${ctx.tenantId} and created_at >= ${r.from} and created_at < ${r.to}) new_c,
           (select count(distinct t.customer_id) from transactions t where t.tenant_id = ${ctx.tenantId} and t.status <> 'cancelled' and t.created_at >= ${r.from} and t.created_at < ${r.to} and t.customer_id is not null
              and exists (select 1 from transactions t2 where t2.customer_id = t.customer_id and t2.tenant_id = ${ctx.tenantId} and t2.status <> 'cancelled' and t2.created_at < ${r.from})) returning_c`).then((q) => q.rows);
  return { newCustomers: Number(x.new_c), returning: Number(x.returning_c) };
}

export async function popularServices(ctx: Ctx, r: Range, limit = 6) {
  need(ctx, "reports.view");
  const rows = await ctx.db.execute<{ name: string; qty: string; revenue: string }>(sql`
    select i.name, sum(i.quantity) qty, sum(i.line_total) revenue from transaction_items i join transactions t on t.id = i.transaction_id
    where i.tenant_id = ${ctx.tenantId} and i.kind = 'service' and t.status <> 'cancelled' and t.created_at >= ${r.from} and t.created_at < ${r.to}
    group by i.name order by qty desc, revenue desc limit ${limit}`);
  return rows.rows.map((x) => ({ name: x.name, qty: Number(x.qty), revenue: x.revenue }));
}

export async function staffPerformance(ctx: Ctx, r: Range) {
  need(ctx, "reports.view");
  const rows = await ctx.db.execute<{ id: string; name: string; revenue: string; services: string; commission: string }>(sql`
    select s.id, s.name, coalesce(sum(i.line_total),0) revenue, coalesce(sum(i.quantity),0) services,
      (select coalesce(sum(c.amount),0) from commissions c where c.staff_id = s.id and c.tenant_id = ${ctx.tenantId} and c.created_at >= ${r.from} and c.created_at < ${r.to}) commission
    from staff s left join (select i.* from transaction_items i join transactions t on t.id = i.transaction_id
      where t.status <> 'cancelled' and t.created_at >= ${r.from} and t.created_at < ${r.to} and i.kind = 'service') i on i.staff_id = s.id and i.tenant_id = ${ctx.tenantId}
    where s.tenant_id = ${ctx.tenantId} group by s.id, s.name order by revenue desc`);
  return rows.rows.map((x) => ({ id: x.id, name: x.name, revenue: x.revenue, services: Number(x.services), commission: x.commission }));
}

export async function expenseByCategory(ctx: Ctx, r: Range) {
  need(ctx, "reports.view");
  const rows = await ctx.db.execute<{ category: string; total: string }>(sql`select category, sum(amount) total from expenses where tenant_id = ${ctx.tenantId} and spent_on >= ${r.fromDate} and spent_on < ${r.toDate} group by 1 order by 2 desc`);
  return rows.rows;
}

export async function paymentsByMethod(ctx: Ctx, r: Range) {
  need(ctx, "reports.view");
  const rows = await ctx.db.execute<{ method: string; total: string; n: string }>(sql`select p.method, sum(p.amount) total, count(*) n from payments p join transactions t on t.id = p.transaction_id
    where p.tenant_id = ${ctx.tenantId} and t.status <> 'cancelled' and p.created_at >= ${r.from} and p.created_at < ${r.to} group by 1 order by 2 desc`);
  return rows.rows;
}

export async function productSales(ctx: Ctx, r: Range) {
  need(ctx, "reports.view");
  const rows = await ctx.db.execute<{ name: string; qty: string; revenue: string }>(sql`select i.name, sum(i.quantity) qty, sum(i.line_total) revenue from transaction_items i join transactions t on t.id = i.transaction_id
    where i.tenant_id = ${ctx.tenantId} and i.kind = 'product' and t.status <> 'cancelled' and t.created_at >= ${r.from} and t.created_at < ${r.to} group by 1 order by 2 desc`);
  return rows.rows;
}

export async function taxReport(ctx: Ctx, r: Range) {
  need(ctx, "reports.view");
  const [x] = await ctx.db.execute<{ taxable: string; tax: string }>(sql`select coalesce(sum(subtotal - discount),0) taxable, coalesce(sum(tax),0) tax from transactions where tenant_id = ${ctx.tenantId} and status <> 'cancelled' and created_at >= ${r.from} and created_at < ${r.to}`).then((q) => q.rows);
  return x;
}

export async function dormantCustomers(ctx: Ctx, days = 60, limit = 20) {
  need(ctx, "customers.view");
  const rows = await ctx.db.execute<{ id: string; name: string; phone: string | null; last: string; marketing_consent: boolean }>(sql`
    select c.id, c.name, c.phone, c.marketing_consent, max(a.starts_at) last from customers c join appointments a on a.customer_id = c.id and a.status = 'completed'
    where c.tenant_id = ${ctx.tenantId} and c.archived = false group by c.id having max(a.starts_at) < now() - (${days} || ' days')::interval order by last asc limit ${limit}`);
  return rows.rows;
}

export async function busiestDays(ctx: Ctx, r: Range) {
  need(ctx, "reports.view");
  const rows = await ctx.db.execute<{ dow: number; n: string }>(sql`select extract(dow from starts_at at time zone ${ctx.tenant.timezone})::int dow, count(*) n from appointments
    where tenant_id = ${ctx.tenantId} and status not in ('cancelled','no_show') and starts_at >= ${r.from} and starts_at < ${r.to} group by 1 order by 2 desc`);
  const names = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  return rows.rows.map((x) => ({ day: names[x.dow], count: Number(x.n) }));
}

export async function lowStock(ctx: Ctx) {
  need(ctx, "inventory.view");
  return ctx.db.select({ id: products.id, name: products.name, quantity: products.quantity, minStock: products.minStock }).from(products)
    .where(and(eq(products.tenantId, ctx.tenantId), eq(products.active, true), sql`${products.quantity} <= ${products.minStock}`));
}

export async function recentTransactions(ctx: Ctx, limit = 8) {
  need(ctx, "dashboard.view");
  return ctx.db.select({ t: transactions, customerName: customers.name }).from(transactions).leftJoin(customers, eq(customers.id, transactions.customerId))
    .where(eq(transactions.tenantId, ctx.tenantId)).orderBy(sql`${transactions.createdAt} desc`).limit(limit);
}

export function rangeFor(ctx: Ctx, key: RangeKey, custom?: { from?: string; to?: string }): Range {
  return resolveRange(key, ctx.tenant.timezone, custom);
}

export async function listNotifications(ctx: Ctx, limit = 30) {
  return ctx.db.select().from(notifications).where(and(eq(notifications.tenantId, ctx.tenantId), sql`(${notifications.userId} is null or ${notifications.userId} = ${ctx.userId})`)).orderBy(sql`${notifications.createdAt} desc`).limit(limit);
}
export async function markNotificationsRead(ctx: Ctx, id?: string) {
  await ctx.db.update(notifications).set({ read: true }).where(and(eq(notifications.tenantId, ctx.tenantId), id ? eq(notifications.id, id) : undefined));
}
export { commissions, staff, services, transactionItems, payments };
