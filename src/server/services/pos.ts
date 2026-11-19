import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import {
  transactions, transactionItems, payments, invoices, commissions, products, services, staff, customers,
  inventoryMovements, tenants, appointments, notifications,
} from "@/db/schema";
import { AppError, audit, need, type Ctx } from "../ctx";
import { fromCents, pctOf, toCents } from "@/lib/money";

const amt = z.coerce.number().min(0).max(10_000_000).transform((n) => toCents(n.toFixed(2)));

export const checkoutSchema = z.object({
  customerId: z.string().uuid().nullable().optional(),
  staffId: z.string().uuid().nullable().optional(),
  appointmentId: z.string().uuid().nullable().optional(),
  idempotencyKey: z.string().min(8).max(100),
  items: z.array(z.object({
    kind: z.enum(["service", "product"]), id: z.string().uuid(),
    quantity: z.coerce.number().int().min(1).max(999).default(1),
    discount: amt.default(0), staffId: z.string().uuid().nullable().optional(),
  })).min(1, "Add at least one item").max(100),
  discount: amt.default(0),
  payments: z.array(z.object({ method: z.string().min(1).max(30), amount: amt, note: z.string().max(200).optional() })).max(10).default([]),
  notes: z.string().max(500).optional().nullable(),
  creditSale: z.boolean().default(false), // allow leaving a balance (invoice)
});

export type CheckoutResult = { transactionId: string; invoiceNumber: string; total: string; paid: string; status: string; duplicate?: boolean };

export async function checkout(ctx: Ctx, raw: unknown): Promise<CheckoutResult> {
  need(ctx, "pos.use");
  const v = checkoutSchema.parse(raw);
  const t = ctx.tenant;

  // Idempotency: the same key never creates two sales.
  const [dup] = await ctx.db.select().from(transactions).where(and(eq(transactions.tenantId, ctx.tenantId), eq(transactions.idempotencyKey, v.idempotencyKey)));
  if (dup) {
    const [inv] = await ctx.db.select().from(invoices).where(eq(invoices.transactionId, dup.id));
    return { transactionId: dup.id, invoiceNumber: inv?.number ?? "", total: dup.total, paid: dup.paid, status: dup.status, duplicate: true };
  }

  const allowed = new Set(t.paymentMethods);
  for (const p of v.payments) if (!allowed.has(p.method)) throw new AppError(`Payment method "${p.method}" is not enabled.`);

  try {
    return await ctx.db.transaction(async (tx) => {
      const tctx = { ...ctx, db: tx as unknown as Ctx["db"] };
      const pendingMovements: { productId: string; delta: number; after: number }[] = [];
      // validate ownership of referenced entities
      if (v.customerId) {
        const [c] = await tx.select({ id: customers.id }).from(customers).where(and(eq(customers.id, v.customerId), eq(customers.tenantId, ctx.tenantId)));
        if (!c) throw new AppError("Customer not found", "not_found");
      }
      const staffIds = [v.staffId, ...v.items.map((i) => i.staffId)].filter(Boolean) as string[];
      if (staffIds.length) {
        const rows = await tx.select({ id: staff.id }).from(staff).where(and(eq(staff.tenantId, ctx.tenantId), inArray(staff.id, staffIds)));
        if (rows.length !== new Set(staffIds).size) throw new AppError("Invalid staff member");
      }
      const svcIds = v.items.filter((i) => i.kind === "service").map((i) => i.id);
      const prodIds = v.items.filter((i) => i.kind === "product").map((i) => i.id);
      const svcRows = svcIds.length ? await tx.select().from(services).where(and(eq(services.tenantId, ctx.tenantId), inArray(services.id, svcIds))) : [];
      // lock product rows so concurrent checkouts cannot oversell
      const prodRows = prodIds.length
        ? await tx.select().from(products).where(and(eq(products.tenantId, ctx.tenantId), inArray(products.id, prodIds))).for("update")
        : [];
      const svcMap = new Map(svcRows.map((s) => [s.id, s]));
      const prodMap = new Map(prodRows.map((p) => [p.id, p]));

      type Line = { kind: "service" | "product"; id: string; name: string; qty: number; unit: number; disc: number; taxable: boolean; staffId: string | null; net: number; tax: number; commissionPct: string };
      const lines: Line[] = v.items.map((i) => {
        const src = i.kind === "service" ? svcMap.get(i.id) : prodMap.get(i.id);
        if (!src) throw new AppError(`${i.kind === "service" ? "Service" : "Product"} not found`, "not_found");
        if (!src.active) throw new AppError(`${src.name} is inactive`);
        const unit = toCents(i.kind === "service" ? (src as typeof svcRows[number]).price : (src as typeof prodRows[number]).sellPrice);
        const gross = unit * i.quantity;
        if (i.discount > gross) throw new AppError(`Discount exceeds line amount for ${src.name}`);
        return { kind: i.kind, id: i.id, name: src.name, qty: i.quantity, unit, disc: i.discount, taxable: src.taxable, staffId: i.staffId ?? v.staffId ?? null, net: gross - i.discount, tax: 0, commissionPct: i.kind === "service" ? (src as typeof svcRows[number]).commissionPct : "0" };
      });

      const sub = lines.reduce((s, l) => s + l.net, 0);
      if (v.discount > sub) throw new AppError("Order discount exceeds subtotal");
      // allocate order-level discount proportionally; remainder to last line
      let left = v.discount;
      lines.forEach((l, idx) => {
        const share = idx === lines.length - 1 ? left : sub ? Math.min(left, Math.round((v.discount * l.net) / sub)) : 0;
        left -= share; l.net -= share; l.disc += share;
        l.tax = l.taxable ? pctOf(l.net, t.taxRate) : 0;
      });
      const itemDiscounts = lines.reduce((s, l) => s + l.disc, 0);
      const taxTotal = lines.reduce((s, l) => s + l.tax, 0);
      const netTotal = lines.reduce((s, l) => s + l.net, 0);
      const total = netTotal + taxTotal;
      const subtotalGross = lines.reduce((s, l) => s + l.unit * l.qty, 0);

      const paid = v.payments.reduce((s, p) => s + p.amount, 0);
      if (paid > total) throw new AppError("Payments exceed the total due.");
      if (paid < total && !v.creditSale) throw new AppError("Payment is less than the total. Enable 'leave balance on invoice' for partial payment.");
      const status = paid === total ? "paid" : paid > 0 ? "partial" : "unpaid";

      // stock deduction (atomic and guarded)
      for (const l of lines.filter((x) => x.kind === "product" && prodMap.get(x.id)?.trackStock)) {
        const [p] = await tx.update(products).set({ quantity: sql`${products.quantity} - ${l.qty}` })
          .where(and(eq(products.id, l.id), eq(products.tenantId, ctx.tenantId), sql`${products.quantity} >= ${l.qty}`)).returning({ q: products.quantity });
        if (!p) throw new AppError(`Not enough stock for ${l.name}`, "conflict");
        pendingMovements.push({ productId: l.id, delta: -l.qty, after: p.q });
      }

      const [txn] = await tx.insert(transactions).values({
        tenantId: ctx.tenantId, customerId: v.customerId ?? null, staffId: v.staffId ?? null, idempotencyKey: v.idempotencyKey,
        subtotal: fromCents(subtotalGross), discount: fromCents(itemDiscounts), tax: fromCents(taxTotal), total: fromCents(total), paid: fromCents(paid),
        status, notes: v.notes ?? null, createdBy: ctx.userId,
      }).returning();

      await tx.insert(transactionItems).values(lines.map((l) => ({
        tenantId: ctx.tenantId, transactionId: txn.id, kind: l.kind,
        serviceId: l.kind === "service" ? l.id : null, productId: l.kind === "product" ? l.id : null, staffId: l.staffId,
        name: l.name, quantity: l.qty, unitPrice: fromCents(l.unit), discount: fromCents(l.disc), tax: fromCents(l.tax), lineTotal: fromCents(l.net + l.tax),
      })));
      if (v.payments.some((p) => p.amount > 0)) {
        await tx.insert(payments).values(v.payments.filter((p) => p.amount > 0).map((p) => ({
          tenantId: ctx.tenantId, transactionId: txn.id, method: p.method, amount: fromCents(p.amount), note: p.note, createdBy: ctx.userId,
        })));
      }
      for (const m of pendingMovements.splice(0)) {
        await tx.insert(inventoryMovements).values({ tenantId: ctx.tenantId, productId: m.productId, delta: m.delta, balanceAfter: m.after, reason: "sale", refType: "transaction", refId: txn.id, userId: ctx.userId });
      }

      // invoice number: atomic per-tenant counter
      const [tn] = await tx.update(tenants).set({ invoiceCounter: sql`${tenants.invoiceCounter} + 1` }).where(eq(tenants.id, ctx.tenantId)).returning({ n: tenants.invoiceCounter, p: tenants.invoicePrefix });
      const number = `${tn.p}-${String(tn.n).padStart(5, "0")}`;
      await tx.insert(invoices).values({ tenantId: ctx.tenantId, transactionId: txn.id, number, dueDate: status === "paid" ? null : new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10) });

      // commissions on service lines (pre-tax net)
      const staffRows = staffIds.length ? await tx.select().from(staff).where(inArray(staff.id, staffIds)) : [];
      const comm = new Map<string, number>();
      for (const l of lines.filter((x) => x.kind === "service" && x.staffId)) {
        const sRow = staffRows.find((s) => s.id === l.staffId);
        const pct = Number(l.commissionPct) > 0 ? l.commissionPct : sRow?.commissionPct ?? "0";
        const c = pctOf(l.net, pct);
        if (c > 0) comm.set(l.staffId!, (comm.get(l.staffId!) ?? 0) + c);
      }
      for (const [sid, c] of comm) await tx.insert(commissions).values({ tenantId: ctx.tenantId, staffId: sid, transactionId: txn.id, amount: fromCents(c) });

      if (v.customerId && paid > 0) {
        const pts = Math.floor(paid / 1000) * t.loyaltyPointsPerUnit; // per 10 currency units
        if (pts > 0) await tx.update(customers).set({ loyaltyPoints: sql`${customers.loyaltyPoints} + ${pts}` }).where(and(eq(customers.id, v.customerId), eq(customers.tenantId, ctx.tenantId)));
      }
      if (v.appointmentId) {
        const r = await tx.update(appointments).set({ status: "completed", transactionId: txn.id })
          .where(and(eq(appointments.id, v.appointmentId), eq(appointments.tenantId, ctx.tenantId), sql`${appointments.status} not in ('cancelled','no_show','completed')`)).returning({ id: appointments.id });
        if (!r.length) throw new AppError("Appointment cannot be completed from checkout");
      }
      await audit(tctx, "sale.create", "transaction", txn.id, { total: fromCents(total), status });
      return { transactionId: txn.id, invoiceNumber: number, total: txn.total, paid: txn.paid, status };
    });
  } catch (e) {
    // concurrent duplicate submit: unique(idempotency_key) fires; return the winner
    if (String((e as Error).message).includes("tx_idem_uq") || String((e as { cause?: Error }).cause?.message ?? "").includes("tx_idem_uq")) {
      const [d] = await ctx.db.select().from(transactions).where(and(eq(transactions.tenantId, ctx.tenantId), eq(transactions.idempotencyKey, v.idempotencyKey)));
      const [inv] = await ctx.db.select().from(invoices).where(eq(invoices.transactionId, d.id));
      return { transactionId: d.id, invoiceNumber: inv?.number ?? "", total: d.total, paid: d.paid, status: d.status, duplicate: true };
    }
    throw e;
  } finally {
    await lowStockCheck(ctx).catch(() => {});
  }
}

export async function lowStockCheck(ctx: Ctx) {
  const low = await ctx.db.select().from(products).where(and(eq(products.tenantId, ctx.tenantId), eq(products.active, true), eq(products.trackStock, true), sql`${products.quantity} <= ${products.minStock}`));
  for (const p of low) {
    await ctx.db.insert(notifications).values({ tenantId: ctx.tenantId, kind: "low_stock", title: `Low stock: ${p.name}`, body: `${p.quantity} left (minimum ${p.minStock})`, link: "/inventory", dedupeKey: `low:${p.id}:${p.quantity}` }).onConflictDoNothing();
  }
}

export async function addPayment(ctx: Ctx, transactionId: string, method: string, amountRaw: number, note?: string) {
  need(ctx, "invoices.manage");
  const amount = toCents(Number(amountRaw).toFixed(2));
  if (amount <= 0) throw new AppError("Amount must be positive");
  if (!ctx.tenant.paymentMethods.includes(method)) throw new AppError("Payment method is not enabled");
  return ctx.db.transaction(async (tx) => {
    const [t] = await tx.select().from(transactions).where(and(eq(transactions.id, transactionId), eq(transactions.tenantId, ctx.tenantId))).for("update");
    if (!t) throw new AppError("Sale not found", "not_found");
    if (t.status === "cancelled") throw new AppError("Sale is cancelled");
    const due = toCents(t.total) - toCents(t.paid);
    if (amount > due) throw new AppError("Payment exceeds the outstanding balance");
    await tx.insert(payments).values({ tenantId: ctx.tenantId, transactionId, method, amount: fromCents(amount), note, createdBy: ctx.userId });
    const paid = toCents(t.paid) + amount;
    await tx.update(transactions).set({ paid: fromCents(paid), status: paid === toCents(t.total) ? "paid" : "partial" }).where(eq(transactions.id, transactionId));
    await audit({ ...ctx, db: tx as unknown as Ctx["db"] }, "payment.add", "transaction", transactionId, { amount: fromCents(amount), method });
  });
}

/** Voids an UNPAID sale (restocks products). Paid sales are never silently altered. */
export async function voidSale(ctx: Ctx, transactionId: string, reason: string) {
  need(ctx, "invoices.manage");
  if (!reason.trim()) throw new AppError("A reason is required");
  return ctx.db.transaction(async (tx) => {
    const [t] = await tx.select().from(transactions).where(and(eq(transactions.id, transactionId), eq(transactions.tenantId, ctx.tenantId))).for("update");
    if (!t) throw new AppError("Sale not found", "not_found");
    if (t.status === "cancelled") return;
    if (toCents(t.paid) > 0) throw new AppError("Sales with payments cannot be voided. Issue a refund process instead.");
    const items = await tx.select().from(transactionItems).where(and(eq(transactionItems.transactionId, transactionId), eq(transactionItems.tenantId, ctx.tenantId)));
    for (const i of items.filter((x) => x.kind === "product" && x.productId)) {
      const [p] = await tx.update(products).set({ quantity: sql`${products.quantity} + ${i.quantity}` }).where(and(eq(products.id, i.productId!), eq(products.tenantId, ctx.tenantId), eq(products.trackStock, true))).returning({ q: products.quantity });
      if (!p) continue; // untracked items have no stock to return
      await tx.insert(inventoryMovements).values({ tenantId: ctx.tenantId, productId: i.productId!, delta: i.quantity, balanceAfter: p.q, reason: "return", refType: "transaction", refId: transactionId, userId: ctx.userId });
    }
    await tx.update(transactions).set({ status: "cancelled", notes: `${t.notes ?? ""} [VOID: ${reason}]`.trim() }).where(eq(transactions.id, transactionId));
    await tx.update(invoices).set({ cancelled: true }).where(eq(invoices.transactionId, transactionId));
    await tx.delete(commissions).where(eq(commissions.transactionId, transactionId));
    await audit({ ...ctx, db: tx as unknown as Ctx["db"] }, "sale.void", "transaction", transactionId, { reason });
  });
}

export async function listInvoices(ctx: Ctx, o: { status?: string; q?: string } = {}) {
  need(ctx, "invoices.view");
  const rows = await ctx.db.select({ inv: invoices, t: transactions, customerName: customers.name })
    .from(invoices).innerJoin(transactions, eq(transactions.id, invoices.transactionId)).leftJoin(customers, eq(customers.id, transactions.customerId))
    .where(eq(invoices.tenantId, ctx.tenantId)).orderBy(desc(invoices.createdAt)).limit(500);
  const now = new Date().toISOString().slice(0, 10);
  const withStatus = rows.map((r) => {
    const st = r.inv.cancelled ? "cancelled" : r.t.status === "paid" ? "paid" : r.inv.dueDate && r.inv.dueDate < now ? "overdue" : r.t.status === "partial" ? "partially_paid" : "unpaid";
    return { ...r, status: st, balance: fromCents(toCents(r.t.total) - toCents(r.t.paid)) };
  });
  return withStatus.filter((r) => (!o.status || r.status === o.status) && (!o.q || r.inv.number.toLowerCase().includes(o.q.toLowerCase()) || (r.customerName ?? "").toLowerCase().includes(o.q.toLowerCase())));
}

export async function getInvoiceDetail(ctx: Ctx, transactionId: string) {
  need(ctx, "invoices.view");
  const [row] = await ctx.db.select({ inv: invoices, t: transactions, customer: customers })
    .from(invoices).innerJoin(transactions, eq(transactions.id, invoices.transactionId)).leftJoin(customers, eq(customers.id, transactions.customerId))
    .where(and(eq(invoices.transactionId, transactionId), eq(invoices.tenantId, ctx.tenantId)));
  if (!row) throw new AppError("Invoice not found", "not_found");
  const items = await ctx.db.select().from(transactionItems).where(and(eq(transactionItems.transactionId, transactionId), eq(transactionItems.tenantId, ctx.tenantId)));
  const pays = await ctx.db.select().from(payments).where(and(eq(payments.transactionId, transactionId), eq(payments.tenantId, ctx.tenantId))).orderBy(payments.createdAt);
  return { ...row, items, payments: pays, balance: fromCents(toCents(row.t.total) - toCents(row.t.paid)) };
}
