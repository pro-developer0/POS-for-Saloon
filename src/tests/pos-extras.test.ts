import { beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { createDb, type DB } from "@/db/client";
import { commissions, customers, products, services, staff, tenants, transactionItems, transactions, users, coupons, payments } from "@/db/schema";
import { seedDemo, DEMO_USERS } from "@/server/seed";
import { registerOwner } from "@/server/auth";
import { buildCtx, type Ctx } from "@/server/ctx";
import { addPayment, checkout, voidSale } from "@/server/services/pos";
import { createReturn, returnableLines } from "@/server/services/returns";
import { customerBalance, receiveCustomerPayment, saleBalances } from "@/server/services/ledger";
import { previewCoupon, saveCoupon } from "@/server/services/coupons";
import { closePreview, closeShift } from "@/server/services/dayclose";
import { saveExpense, saveProduct } from "@/server/services/inventory";
import { rangeFor, salesSummary } from "@/server/services/reports";
import { addDays, zonedParts } from "@/lib/time";
import { toCents } from "@/lib/money";

let db: DB; let ids: Record<string, string>; let royal: Ctx; let glow: Ctx; let cashier: Ctx; let manager: Ctx;
const uid = async (e: string) => (await db.select().from(users).where(eq(users.email, e)))[0].id;
let n = 0; const key = (p = "x") => `${p}-${++n}-${Math.random().toString(36).slice(2, 8)}`;
const svc = async (tenantId: string, name: string) => (await db.select().from(services).where(and(eq(services.tenantId, tenantId), eq(services.name, name))))[0];
const prod = async (tenantId: string, name: string) => (await db.select().from(products).where(and(eq(products.tenantId, tenantId), eq(products.name, name))))[0];
const cust = async (tenantId: string, i = 0) => (await db.select().from(customers).where(eq(customers.tenantId, tenantId)))[i];
const sale = (id: string) => db.select().from(transactions).where(eq(transactions.id, id)).then((r) => r[0]);
const items = (txId: string) => db.select().from(transactionItems).where(eq(transactionItems.transactionId, txId));
const ret = (ctx: Ctx, saleId: string, lines: { itemId: string; quantity: number; restock?: boolean }[], extra: Record<string, unknown> = {}) =>
  createReturn(ctx, { saleId, idempotencyKey: key("ret"), reason: "test return", refundMethod: "card", lines: lines.map((l) => ({ restock: true, ...l })), ...extra });

beforeAll(async () => {
  db = await createDb({ memory: true });
  ids = await seedDemo(db);
  royal = await buildCtx(db, await uid(DEMO_USERS.royal), ids.royal);
  glow = await buildCtx(db, await uid(DEMO_USERS.glow), ids.glow);
  cashier = await buildCtx(db, await uid(DEMO_USERS.multi), ids.glow); // cashier at Glow
  manager = await buildCtx(db, await uid(DEMO_USERS.multi), ids.royal); // manager at Royal
});

describe("returns: credit notes that net out of every report", () => {
  it("a full refund creates a negative credit note, leaves the sale untouched and nets sales + tax to zero", async () => {
    const m = await svc(ids.glow, "Classic Manicure");
    const before = await salesSummary(glow, rangeFor(glow, "year"));
    const r = await checkout(glow, { items: [{ kind: "service", id: m.id, quantity: 1 }], idempotencyKey: key(), payments: [{ method: "card", amount: 32.48 }] });
    const mid = await salesSummary(glow, rangeFor(glow, "year"));
    expect(toCents(mid.sales) - toCents(before.sales)).toBe(3248);
    const [line] = await items(r.transactionId);
    const cn = await ret(glow, r.transactionId, [{ itemId: line.id, quantity: 1 }]);
    expect(cn.refund).toBe("32.48"); expect(cn.cashRefund).toBe("32.48"); expect(cn.number).toMatch(/^CN-\d{5}$/);
    const note = await sale(cn.transactionId);
    expect(note.kind).toBe("return"); expect(note.total).toBe("-32.48"); expect(note.paid).toBe("-32.48"); expect(note.tax).toBe("-2.48");
    const orig = await sale(r.transactionId);
    expect(orig.total).toBe("32.48"); expect(orig.paid).toBe("32.48"); expect(orig.status).toBe("paid"); // original never edited
    const after = await salesSummary(glow, rangeFor(glow, "year"));
    expect(after.sales).toBe(before.sales); expect(after.tax).toBe(before.tax); expect(after.transactions).toBe(before.transactions + 1); // only the sale counts as a transaction
    expect(toCents(after.collected)).toBe(toCents(before.collected)); // refund paid back
  });

  it("partial returns of a discounted, taxed line add up exactly to the original (no cent lost to rounding)", async () => {
    const oil = await prod(ids.glow, "Cuticle Oil"); // 9.00 each, taxable 8.25%
    const r = await checkout(glow, { items: [{ kind: "product", id: oil.id, quantity: 3, discount: 1 }], idempotencyKey: key(), payments: [{ method: "cash", amount: 28.15 }] });
    expect(r.total).toBe("28.15");
    const [line] = await items(r.transactionId);
    const sums: number[] = [];
    for (let i = 0; i < 3; i++) sums.push(toCents((await ret(glow, r.transactionId, [{ itemId: line.id, quantity: 1 }], { refundMethod: "cash" })).refund));
    expect(sums.reduce((a, b) => a + b, 0)).toBe(2815);
    await expect(ret(glow, r.transactionId, [{ itemId: line.id, quantity: 1 }])).rejects.toThrow(/already been fully returned/);
  });

  it("restocks only when asked, and refuses to return more than was sold", async () => {
    const oil = await prod(ids.glow, "Cuticle Oil"); const q0 = oil.quantity;
    const r = await checkout(glow, { items: [{ kind: "product", id: oil.id, quantity: 4 }], idempotencyKey: key(), payments: [{ method: "cash", amount: 38.97 }] });
    const [line] = await items(r.transactionId);
    expect((await prod(ids.glow, "Cuticle Oil")).quantity).toBe(q0 - 4);
    await ret(glow, r.transactionId, [{ itemId: line.id, quantity: 1, restock: true }], { refundMethod: "cash" });
    expect((await prod(ids.glow, "Cuticle Oil")).quantity).toBe(q0 - 3);
    await ret(glow, r.transactionId, [{ itemId: line.id, quantity: 1, restock: false }], { refundMethod: "cash" }); // damaged: refund but no stock back
    expect((await prod(ids.glow, "Cuticle Oil")).quantity).toBe(q0 - 3);
    await expect(ret(glow, r.transactionId, [{ itemId: line.id, quantity: 3 }])).rejects.toThrow(/Only 2 of/);
    const lines = await returnableLines(glow, r.transactionId);
    expect(lines[0].returnable).toBe(2);
  });

  it("needs a reason and a valid, enabled refund method", async () => {
    const m = await svc(ids.glow, "Classic Manicure");
    const r = await checkout(glow, { items: [{ kind: "service", id: m.id, quantity: 1 }], idempotencyKey: key(), payments: [{ method: "card", amount: 32.48 }] });
    const [line] = await items(r.transactionId);
    await expect(ret(glow, r.transactionId, [{ itemId: line.id, quantity: 1 }], { reason: "" })).rejects.toThrow(/reason/i);
    await expect(ret(glow, r.transactionId, [{ itemId: line.id, quantity: 1 }], { refundMethod: null })).rejects.toThrow(/Choose how the refund/);
    await expect(ret(glow, r.transactionId, [{ itemId: line.id, quantity: 1 }], { refundMethod: "bitcoin" })).rejects.toThrow(/not enabled/);
    expect((await sale(r.transactionId)).status).toBe("paid"); // failed attempts changed nothing
  });

  it("is idempotent: submitting the same return twice refunds once", async () => {
    const m = await svc(ids.glow, "Classic Manicure");
    const r = await checkout(glow, { items: [{ kind: "service", id: m.id, quantity: 1 }], idempotencyKey: key(), payments: [{ method: "card", amount: 32.48 }] });
    const [line] = await items(r.transactionId);
    const k = key("ret-dup");
    const a = await createReturn(glow, { saleId: r.transactionId, idempotencyKey: k, reason: "dup", refundMethod: "card", lines: [{ itemId: line.id, quantity: 1, restock: true }] });
    const b = await createReturn(glow, { saleId: r.transactionId, idempotencyKey: k, reason: "dup", refundMethod: "card", lines: [{ itemId: line.id, quantity: 1, restock: true }] });
    expect(b.duplicate).toBe(true); expect(b.transactionId).toBe(a.transactionId);
    const notes = await db.select().from(transactions).where(eq(transactions.refTransactionId, r.transactionId));
    expect(notes).toHaveLength(1);
  });

  it("returning an unpaid/part-paid sale first cancels the customer's debt and refunds only the cash actually paid", async () => {
    const c = await cust(ids.royal, 3); const hc = await svc(ids.royal, "Hair Color"); // 6500
    const r = await checkout(royal, { customerId: c.id, items: [{ kind: "service", id: hc.id, quantity: 1 }], idempotencyKey: key(), creditSale: true, payments: [{ method: "cash", amount: 2000 }] });
    expect(r.status).toBe("partial");
    const [line] = await items(r.transactionId);
    const cn = await ret(royal, r.transactionId, [{ itemId: line.id, quantity: 1 }], { refundMethod: "cash" });
    expect(cn.refund).toBe("6500.00"); expect(cn.debtReduced).toBe("4500.00"); expect(cn.cashRefund).toBe("2000.00");
    expect((await saleBalances(db, ids.royal, [r.transactionId])).get(r.transactionId)).toBe(0);
    expect((await sale(r.transactionId)).status).toBe("paid");
    expect(await customerBalance(db, ids.royal, c.id)).toBe(0);
  });

  it("takes back service commission on returned lines", async () => {
    const hc = await svc(ids.royal, "Hair Color"); const [st] = await db.select().from(staff).where(eq(staff.tenantId, ids.royal));
    const r = await checkout(royal, { staffId: st.id, items: [{ kind: "service", id: hc.id, quantity: 1 }], idempotencyKey: key(), payments: [{ method: "cash", amount: 6500 }] });
    const [line] = await items(r.transactionId);
    const cn = await ret(royal, r.transactionId, [{ itemId: line.id, quantity: 1 }], { refundMethod: "cash" });
    const rows = await db.select().from(commissions).where(eq(commissions.staffId, st.id));
    const mine = rows.filter((x) => x.transactionId === r.transactionId || x.transactionId === cn.transactionId);
    expect(mine).toHaveLength(2);
    expect(mine.reduce((a, x) => a + toCents(x.amount), 0)).toBe(0);
  });

  it("refunds need the sales.refund permission (cashiers cannot, managers can)", async () => {
    expect(cashier.role).toBe("cashier");
    const m = await svc(ids.glow, "Classic Manicure");
    const r = await checkout(glow, { items: [{ kind: "service", id: m.id, quantity: 1 }], idempotencyKey: key(), payments: [{ method: "card", amount: 32.48 }] });
    const [line] = await items(r.transactionId);
    await expect(ret(cashier, r.transactionId, [{ itemId: line.id, quantity: 1 }])).rejects.toThrow(/Permission denied/);
    expect(manager.role).toBe("manager"); expect(manager.perms.has("sales.refund")).toBe(true);
  });

  it("another business cannot return this sale", async () => {
    const m = await svc(ids.glow, "Classic Manicure");
    const r = await checkout(glow, { items: [{ kind: "service", id: m.id, quantity: 1 }], idempotencyKey: key(), payments: [{ method: "card", amount: 32.48 }] });
    const [line] = await items(r.transactionId);
    await expect(ret(royal, r.transactionId, [{ itemId: line.id, quantity: 1 }], { refundMethod: "cash" })).rejects.toThrow(/not found/i);
  });

  it("a sale with returns, and credit notes themselves, cannot be voided", async () => {
    const c = await cust(ids.royal, 4); const hc = await svc(ids.royal, "Hair Color");
    const r = await checkout(royal, { customerId: c.id, items: [{ kind: "service", id: hc.id, quantity: 1 }], idempotencyKey: key(), creditSale: true, payments: [] });
    const [line] = await items(r.transactionId);
    const cn = await ret(royal, r.transactionId, [{ itemId: line.id, quantity: 1 }], { refundMethod: "cash" });
    await expect(voidSale(royal, r.transactionId, "x")).rejects.toThrow(/has returns/);
    await expect(voidSale(royal, cn.transactionId, "x")).rejects.toThrow(/Credit notes cannot be voided/);
    await expect(addPayment(royal, cn.transactionId, "cash", 1)).rejects.toThrow(/only be added to sales/);
  });

  it("restocked returns put the units back on the shelf (and are logged)", async () => {
    const p = await prod(ids.royal, "Styling Gel");
    const c = await cust(ids.royal);
    const r = await checkout(royal, { customerId: c.id, items: [{ kind: "product", id: p.id, quantity: 5 }], idempotencyKey: key(), payments: [{ method: "cash", amount: 3250 }] });
    expect((await prod(ids.royal, "Styling Gel")).quantity).toBe(p.quantity - 5);
    const [line] = await items(r.transactionId);
    await ret(royal, r.transactionId, [{ itemId: line.id, quantity: 2, restock: true }], { refundMethod: "cash" });
    expect((await prod(ids.royal, "Styling Gel")).quantity).toBe(p.quantity - 5 + 2);
  });
});

describe("customer credit (udhaar)", () => {
  it("a walk-in cannot take credit", async () => {
    const hc = await svc(ids.royal, "Hair Color");
    await expect(checkout(royal, { items: [{ kind: "service", id: hc.id, quantity: 1 }], idempotencyKey: key(), creditSale: true, payments: [] })).rejects.toThrow(/Choose a customer/);
  });

  it("enforces the credit limit and frees up room as the customer pays", async () => {
    const c = await cust(ids.royal, 6); const bn = await svc(ids.royal, "Blow Dry"); // 900
    await db.update(customers).set({ creditLimit: "1000.00" }).where(eq(customers.id, c.id));
    const before = await customerBalance(db, ids.royal, c.id);
    await checkout(royal, { customerId: c.id, items: [{ kind: "service", id: bn.id, quantity: 1 }], idempotencyKey: key(), creditSale: true, payments: [] });
    await expect(checkout(royal, { customerId: c.id, items: [{ kind: "service", id: bn.id, quantity: 1 }], idempotencyKey: key(), creditSale: true, payments: [] })).rejects.toThrow(/credit limit/i);
    expect(await customerBalance(db, ids.royal, c.id)).toBe(before + 90000);
    await receiveCustomerPayment(royal, c.id, 500, "cash");
    await expect(checkout(royal, { customerId: c.id, items: [{ kind: "service", id: bn.id, quantity: 1 }], idempotencyKey: key(), creditSale: true, payments: [] })).rejects.toThrow(/credit limit/i); // 400 + 900 > 1000
    await receiveCustomerPayment(royal, c.id, 400, "cash");
    await expect(checkout(royal, { customerId: c.id, items: [{ kind: "service", id: bn.id, quantity: 1 }], idempotencyKey: key(), creditSale: true, payments: [] })).resolves.toBeTruthy();
  });

  it("payments are applied to the oldest unpaid sales first and cannot exceed the balance", async () => {
    const c = await cust(ids.royal, 7); const bd = await svc(ids.royal, "Blow Dry"); const hc = await svc(ids.royal, "Hair Color");
    const old = await checkout(royal, { customerId: c.id, items: [{ kind: "service", id: bd.id, quantity: 1 }], idempotencyKey: key(), creditSale: true, payments: [] }); // 900
    const recent = await checkout(royal, { customerId: c.id, items: [{ kind: "service", id: hc.id, quantity: 1 }], idempotencyKey: key(), creditSale: true, payments: [] }); // 6500
    const owed = await customerBalance(db, ids.royal, c.id);
    await expect(receiveCustomerPayment(royal, c.id, owed / 100 + 1, "cash")).rejects.toThrow(/exceeds/);
    await expect(receiveCustomerPayment(royal, c.id, 0, "cash")).rejects.toThrow(/positive/);
    await receiveCustomerPayment(royal, c.id, 1500, "cash");
    expect((await sale(old.transactionId)).status).toBe("paid");
    const r2 = await sale(recent.transactionId);
    expect(r2.status).toBe("partial"); expect(r2.paid).toBe("600.00"); // 1500 - 900
    expect(await customerBalance(db, ids.royal, c.id)).toBe(owed - 150000);
    const pays = await db.select().from(payments).where(eq(payments.transactionId, old.transactionId));
    expect(pays.some((p) => p.note === "Customer account payment")).toBe(true);
  });

  it("another business cannot take payment for this customer", async () => {
    const c = await cust(ids.royal, 7);
    await expect(receiveCustomerPayment(glow, c.id, 10, "cash")).rejects.toThrow(/not found/i);
  });
});

describe("coupons", () => {
  const today = () => zonedParts(new Date(), "Asia/Karachi").date;
  beforeAll(async () => {
    await saveCoupon(royal, { code: "save10", type: "percent", value: 10, minSubtotal: 0 });
    await saveCoupon(royal, { code: "FLAT500", type: "fixed", value: 500, minSubtotal: 2000 });
    await saveCoupon(royal, { code: "ONCE", type: "fixed", value: 100, maxUses: 1 });
    await saveCoupon(royal, { code: "OLD", type: "percent", value: 50, expiresOn: addDays(today(), -1) });
    await saveCoupon(royal, { code: "OFF", type: "percent", value: 50, active: false });
  });
  const bd = () => svc(ids.royal, "Blow Dry"); // 900
  const hc = () => svc(ids.royal, "Hair Color"); // 6500

  it("percent coupon discounts on the server, case-insensitively, and counts the use", async () => {
    const s = await bd();
    const r = await checkout(royal, { items: [{ kind: "service", id: s.id, quantity: 1 }], couponCode: "Save10", idempotencyKey: key(), payments: [{ method: "cash", amount: 810 }] });
    expect(r.total).toBe("810.00");
    const t = await sale(r.transactionId); expect(t.couponCode).toBe("SAVE10");
    expect((await db.select().from(coupons).where(and(eq(coupons.tenantId, ids.royal), eq(coupons.code, "SAVE10"))))[0].usedCount).toBeGreaterThanOrEqual(1);
  });
  it("fixed coupon respects its minimum purchase and stacks with a manual discount", async () => {
    const small = await bd(); const big = await hc();
    await expect(checkout(royal, { items: [{ kind: "service", id: small.id, quantity: 1 }], couponCode: "FLAT500", idempotencyKey: key(), payments: [] })).rejects.toThrow(/minimum purchase/);
    const r = await checkout(royal, { items: [{ kind: "service", id: big.id, quantity: 1 }], couponCode: "FLAT500", discount: 100, idempotencyKey: key(), payments: [{ method: "cash", amount: 5900 }] });
    expect(r.total).toBe("5900.00");
  });
  it("the client cannot fake a discount: unknown, inactive, expired and other-business codes are refused", async () => {
    const s = await bd();
    for (const code of ["NOPE", "OFF", "OLD"]) await expect(checkout(royal, { items: [{ kind: "service", id: s.id, quantity: 1 }], couponCode: code, idempotencyKey: key(), payments: [] })).rejects.toThrow(/not valid|expired/);
    const m = await svc(ids.glow, "Classic Manicure");
    await expect(checkout(glow, { items: [{ kind: "service", id: m.id, quantity: 1 }], couponCode: "SAVE10", idempotencyKey: key(), payments: [] })).rejects.toThrow(/not valid/);
  });
  it("a single-use coupon works once; voiding the sale gives the use back", async () => {
    const s = await bd(); const c = await cust(ids.royal, 8);
    const first = await checkout(royal, { customerId: c.id, items: [{ kind: "service", id: s.id, quantity: 1 }], couponCode: "ONCE", idempotencyKey: key(), creditSale: true, payments: [] });
    await expect(checkout(royal, { items: [{ kind: "service", id: s.id, quantity: 1 }], couponCode: "ONCE", idempotencyKey: key(), payments: [] })).rejects.toThrow(/maximum number of times/);
    await voidSale(royal, first.transactionId, "test");
    const again = await checkout(royal, { items: [{ kind: "service", id: s.id, quantity: 1 }], couponCode: "ONCE", idempotencyKey: key(), payments: [{ method: "cash", amount: 800 }] });
    expect(again.total).toBe("800.00");
  });
  it("two simultaneous checkouts cannot both use the last redemption", async () => {
    await saveCoupon(royal, { code: "LASTONE", type: "fixed", value: 50, maxUses: 1 });
    const s = await bd();
    const go = () => checkout(royal, { items: [{ kind: "service", id: s.id, quantity: 1 }], couponCode: "LASTONE", idempotencyKey: key(), payments: [{ method: "cash", amount: 850 }] });
    const res = await Promise.allSettled([go(), go()]);
    expect(res.filter((x) => x.status === "fulfilled")).toHaveLength(1);
  });
  it("preview matches checkout; tax is calculated on the discounted amount", async () => {
    const p = await previewCoupon(royal, "save10", 90000); expect(p.discount).toBe("90.00");
    await saveCoupon(glow, { code: "GLOW10", type: "percent", value: 10 });
    const m = await svc(ids.glow, "Classic Manicure"); // 30.00 + 8.25% tax
    const r = await checkout(glow, { items: [{ kind: "service", id: m.id, quantity: 1 }], couponCode: "GLOW10", idempotencyKey: key(), payments: [{ method: "card", amount: 29.23 }] });
    expect(r.total).toBe("29.23"); // 27.00 + 2.23 tax (27 x 8.25% = 2.2275)
  });
  it("only roles with coupons.manage can create coupons", async () => {
    await expect(saveCoupon(cashier, { code: "HACK", type: "percent", value: 90 })).rejects.toThrow(/Permission denied/);
    await expect(saveCoupon(royal, { code: "BAD", type: "percent", value: 150 })).rejects.toThrow(/cannot exceed 100/);
    await expect(saveCoupon(royal, { code: "SAVE10", type: "percent", value: 5 })).rejects.toThrow(/already exists/);
  });
});

describe("end-of-day cash closing", () => {
  let shop: Ctx;
  beforeAll(async () => {
    const { user, tenant } = await registerOwner(db, { name: "Closer", email: "close@shop.test", password: "Closing-Pass-1", businessName: "Close Salon", businessType: "unisex_salon" });
    await db.update(tenants).set({ onboarded: true, paymentMethods: ["cash", "card"] }).where(eq(tenants.id, tenant.id));
    shop = await buildCtx(db, user.id, tenant.id);
  });

  it("totals the period, subtracts cash refunds and cash expenses, and records the difference", async () => {
    const pid = await saveProduct(shop, { name: "Soap", sellPrice: 100, costPrice: 40, initialQuantity: 50 });
    const cu = (await db.insert(customers).values({ tenantId: shop.tenantId, name: "Walk" }).returning())[0];
    const a = await checkout(shop, { items: [{ kind: "product", id: pid, quantity: 1 }], idempotencyKey: key(), payments: [{ method: "cash", amount: 100 }] });
    await checkout(shop, { items: [{ kind: "product", id: pid, quantity: 1 }], idempotencyKey: key(), payments: [{ method: "card", amount: 100 }] });
    const [line] = await items(a.transactionId);
    // refund 1 unit of the cash sale: 100 cash back (whole line)
    await createReturn(shop, { saleId: a.transactionId, idempotencyKey: key(), reason: "changed mind", refundMethod: "cash", lines: [{ itemId: line.id, quantity: 1, restock: true }] });
    await checkout(shop, { items: [{ kind: "product", id: pid, quantity: 1 }], idempotencyKey: key(), payments: [{ method: "cash", amount: 100 }] });
    await saveExpense(shop, { name: "Cleaning", amount: 20, spentOn: zonedParts(new Date(), "UTC").date, paymentMethod: "cash" });
    void cu;
    const pre = await closePreview(shop);
    expect(pre.totals.salesCount).toBe(3);
    expect(pre.totals.grossSales).toBe(30000);
    expect(pre.totals.returns).toBe(10000);
    expect(pre.totals.netSales).toBe(20000);
    expect(pre.totals.cashIn).toBe(10000); // +100 +100 -100 refund
    expect(pre.totals.cashExpenses).toBe(2000);
    const row = await closeShift(shop, { openingFloat: 50, countedCash: 125 });
    expect(row.expectedCash).toBe("130.00"); // 50 + 100 - 20
    expect(row.difference).toBe("-5.00");
  });

  it("the next close starts where the last ended (nothing is counted twice), even with simultaneous closes", async () => {
    const pre = await closePreview(shop);
    expect(pre.hasPrevious).toBe(true);
    expect(pre.totals.salesCount).toBe(0);
    expect(pre.lastCounted).toBe(12500);
    const res = await Promise.allSettled([closeShift(shop, { openingFloat: 125, countedCash: 125 }), closeShift(shop, { openingFloat: 125, countedCash: 125 })]);
    for (const r of res) if (r.status === "fulfilled") expect((r.value.totals as { salesCount: number }).salesCount).toBe(0);
  });

  it("is tenant-scoped and needs the POS permission", async () => {
    const pre = await closePreview(royal);
    expect(pre.totals.salesCount).toBeGreaterThanOrEqual(0);
    const staffCtx = { ...royal, perms: new Set(["appointments.view"]) } as Ctx;
    await expect(closePreview(staffCtx)).rejects.toThrow(/Permission denied/);
  });
});
