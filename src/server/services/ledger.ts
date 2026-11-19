import { and, desc, eq, sql } from "drizzle-orm";
import type { DB } from "@/db/client";
import { customers, invoices, payments, transactions } from "@/db/schema";
import { AppError, audit, need, type Ctx } from "../ctx";
import { fromCents, toCents } from "@/lib/money";

/**
 * Money owed on a sale, in cents (>0 = customer owes).
 *   sale.total - sale.paid  +  sum over its credit notes of (note.total - note.paid)
 * A credit note's (total - paid) is negative exactly when the return reduced the customer's debt instead of paying cash back.
 */
export async function saleBalances(db: DB, tenantId: string, saleIds: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (!saleIds.length) return out;
  const rows = await db.execute<{ id: string; bal: string }>(sql`
    select t.id, (t.total - t.paid + coalesce((select sum(n.total - n.paid) from transactions n
      where n.ref_transaction_id = t.id and n.tenant_id = ${tenantId} and n.kind = 'return' and n.status <> 'cancelled'), 0)) as bal
    from transactions t where t.tenant_id = ${tenantId} and t.id in (${sql.join(saleIds.map((i) => sql`${i}`), sql`, `)})`);
  for (const r of rows.rows) out.set(r.id, toCents(r.bal));
  return out;
}

/** What a customer owes in total (cents). Credit notes that cancelled debt are included as negatives. */
export async function customerBalance(db: DB, tenantId: string, customerId: string): Promise<number> {
  const [r] = await db.execute<{ v: string }>(sql`select coalesce(sum(total - paid),0) v from transactions
    where tenant_id = ${tenantId} and customer_id = ${customerId} and status <> 'cancelled'`).then((x) => x.rows);
  return Math.max(0, toCents(r.v));
}

/** Throws if leaving `owed` cents on credit would break the customer's rules. */
export async function assertCreditAllowed(db: DB, ctx: Pick<Ctx, "tenantId">, customerId: string | null | undefined, owed: number) {
  if (owed <= 0) return;
  if (!customerId) throw new AppError("Choose a customer to leave a balance on credit.");
  const [c] = await db.select({ limit: customers.creditLimit, name: customers.name }).from(customers).where(and(eq(customers.id, customerId), eq(customers.tenantId, ctx.tenantId)));
  if (!c) throw new AppError("Customer not found", "not_found");
  if (c.limit !== null) {
    const bal = await customerBalance(db, ctx.tenantId, customerId);
    if (bal + owed > toCents(c.limit)) throw new AppError(`${c.name}'s credit limit would be exceeded (limit ${c.limit}, already owes ${fromCents(bal)}).`, "conflict");
  }
}

/** Customer pays off their balance. Applied to the oldest unpaid sales first. */
export async function receiveCustomerPayment(ctx: Ctx, customerId: string, amountRaw: number, method: string, note?: string) {
  need(ctx, "invoices.manage");
  const amount = toCents(Number(amountRaw).toFixed(2));
  if (!(amount > 0)) throw new AppError("Amount must be positive");
  if (!ctx.tenant.paymentMethods.includes(method)) throw new AppError("Payment method is not enabled");
  return ctx.db.transaction(async (tx) => {
    const d = tx as unknown as DB;
    const [c] = await tx.select({ id: customers.id }).from(customers).where(and(eq(customers.id, customerId), eq(customers.tenantId, ctx.tenantId))).for("update");
    if (!c) throw new AppError("Customer not found", "not_found");
    const sales = await tx.select().from(transactions)
      .where(and(eq(transactions.tenantId, ctx.tenantId), eq(transactions.customerId, customerId), eq(transactions.kind, "sale"), sql`${transactions.status} in ('unpaid','partial')`))
      .orderBy(transactions.createdAt).for("update");
    const bal = await saleBalances(d, ctx.tenantId, sales.map((s) => s.id));
    const total = [...bal.values()].reduce((a, b) => a + Math.max(0, b), 0);
    if (amount > total) throw new AppError(`Payment exceeds the customer's balance (${fromCents(total)}).`);
    let left = amount;
    const applied: { saleId: string; amount: number }[] = [];
    for (const s of sales) {
      if (left <= 0) break;
      const due = Math.max(0, bal.get(s.id) ?? 0);
      if (!due) continue;
      const take = Math.min(due, left);
      await tx.insert(payments).values({ tenantId: ctx.tenantId, transactionId: s.id, method, amount: fromCents(take), note: note ?? "Customer account payment", createdBy: ctx.userId });
      const newPaid = toCents(s.paid) + take;
      await tx.update(transactions).set({ paid: fromCents(newPaid), status: due - take === 0 ? "paid" : "partial" }).where(eq(transactions.id, s.id));
      applied.push({ saleId: s.id, amount: take }); left -= take;
    }
    await audit({ ...ctx, db: d }, "customer.payment", "customer", customerId, { amount: fromCents(amount), method, applied: applied.length });
    return { applied: applied.length, amount: fromCents(amount) };
  });
}

/** Customers who owe money, largest first. */
export async function debtors(ctx: Ctx, limit = 20) {
  need(ctx, "reports.view");
  const rows = await ctx.db.execute<{ id: string; name: string; phone: string | null; bal: string; limit: string | null }>(sql`
    select c.id, c.name, c.phone, c.credit_limit as limit, coalesce(sum(t.total - t.paid),0) bal
    from customers c join transactions t on t.customer_id = c.id and t.tenant_id = ${ctx.tenantId} and t.status <> 'cancelled'
    where c.tenant_id = ${ctx.tenantId} group by c.id having coalesce(sum(t.total - t.paid),0) > 0 order by bal desc limit ${limit}`);
  return rows.rows.map((r) => ({ id: r.id, name: r.name, phone: r.phone, balance: r.bal, limit: r.limit }));
}

export async function customerOpenInvoices(ctx: Ctx, customerId: string) {
  need(ctx, "customers.view");
  const sales = await ctx.db.select({ t: transactions, number: invoices.number }).from(transactions).innerJoin(invoices, eq(invoices.transactionId, transactions.id))
    .where(and(eq(transactions.tenantId, ctx.tenantId), eq(transactions.customerId, customerId), eq(transactions.kind, "sale"), sql`${transactions.status} in ('unpaid','partial')`)).orderBy(desc(transactions.createdAt));
  const bal = await saleBalances(ctx.db, ctx.tenantId, sales.map((s) => s.t.id));
  return sales.map((s) => ({ ...s, balance: fromCents(Math.max(0, bal.get(s.t.id) ?? 0)) })).filter((s) => toCents(s.balance) > 0);
}
