import { beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { createDb, type DB } from "@/db/client";
import { customers, products, services, staff, tenants, users, transactions, inventoryMovements, appointments } from "@/db/schema";
import { seedDemo, DEMO_USERS } from "@/server/seed";
import { buildCtx, type Ctx } from "@/server/ctx";
import { createAppointment, rescheduleAppointment, findSlots } from "@/server/services/appointments";
import { checkout, addPayment, voidSale } from "@/server/services/pos";
import { getCustomerProfile, updateCustomer, listCustomers, listStaff, saveStaff } from "@/server/services/crm";
import { adjustStock, createPurchase, receivePurchase } from "@/server/services/inventory";
import { salesSummary, rangeFor } from "@/server/services/reports";
import { registerOwner, verifyLogin } from "@/server/auth";
import { toCents, fromCents, pctOf } from "@/lib/money";
import { addDays, zonedParts, zonedToUtc } from "@/lib/time";

let db: DB; let royal: Ctx; let glow: Ctx; let ids: Record<string, string>;
const uid = async (email: string) => (await db.select().from(users).where(eq(users.email, email)))[0].id;

beforeAll(async () => {
  db = await createDb({ memory: true });
  ids = await seedDemo(db);
  royal = await buildCtx(db, await uid(DEMO_USERS.royal), ids.royal);
  glow = await buildCtx(db, await uid(DEMO_USERS.glow), ids.glow);
});

/** next open weekday at hh:mm local, in the tenant tz */
function futureSlot(ctx: Ctx, hour: number, minute = 0, skip = 3) {
  const tz = ctx.tenant.timezone;
  let d = addDays(zonedParts(new Date(), tz).date, skip);
  for (let i = 0; i < 7; i++) { const wd = zonedParts(zonedToUtc(d, 720, tz), tz).weekday; if (ctx.tenant.hours[String(wd) as "0"]) break; d = addDays(d, 1); }
  return zonedToUtc(d, hour * 60 + minute, tz);
}

describe("money", () => {
  it("uses exact cents math", () => {
    expect(toCents("0.10") + toCents("0.20")).toBe(30);
    expect(fromCents(1999)).toBe("19.99");
    expect(pctOf(3000, "8.25")).toBe(248); // 247.5 -> half-up
    expect(toCents("1234567.89")).toBe(123456789);
  });
});

describe("tenant isolation", () => {
  it("seed created two independent businesses with different currencies", () => {
    expect(royal.tenant.currency).toBe("PKR");
    expect(glow.tenant.currency).toBe("USD");
    expect(royal.tenantId).not.toBe(glow.tenantId);
  });
  it("a user cannot build context for a business they do not belong to", async () => {
    await expect(buildCtx(db, await uid(DEMO_USERS.royal), ids.glow)).rejects.toThrow(/access/);
  });
  it("lists never include other tenants' customers", async () => {
    const r = await listCustomers(royal), g = await listCustomers(glow);
    const gIds = new Set(g.map((x) => x.c.id));
    expect(r.length).toBeGreaterThan(5);
    expect(r.every((x) => x.c.tenantId === ids.royal)).toBe(true);
    expect(r.some((x) => gIds.has(x.c.id))).toBe(false);
  });
  it("cannot read or edit another tenant's customer by id", async () => {
    const [gc] = await db.select().from(customers).where(eq(customers.tenantId, ids.glow));
    await expect(getCustomerProfile(royal, gc.id)).rejects.toThrow(/not found/i);
    await expect(updateCustomer(royal, gc.id, { name: "Hacked" })).rejects.toThrow(/not found/i);
    const [after] = await db.select().from(customers).where(eq(customers.id, gc.id));
    expect(after.name).not.toBe("Hacked");
  });
  it("cannot sell, book or stock another tenant's catalog items", async () => {
    const [gp] = await db.select().from(products).where(eq(products.tenantId, ids.glow));
    const [gs] = await db.select().from(services).where(eq(services.tenantId, ids.glow));
    const [gst] = await db.select().from(staff).where(eq(staff.tenantId, ids.glow));
    const [rc] = await db.select().from(customers).where(eq(customers.tenantId, ids.royal));
    await expect(checkout(royal, { items: [{ kind: "product", id: gp.id, quantity: 1 }], idempotencyKey: "x-iso-1234", payments: [{ method: "cash", amount: 1 }] })).rejects.toThrow(/not found/i);
    await expect(checkout(royal, { items: [{ kind: "service", id: gs.id, quantity: 1 }], idempotencyKey: "x-iso-5678", payments: [] , creditSale: true })).rejects.toThrow(/not found/i);
    await expect(adjustStock(royal, gp.id, 5, "adjustment")).rejects.toThrow();
    await expect(createAppointment(royal, { customerId: rc.id, serviceId: gs.id, staffId: gst.id, startsAt: futureSlot(royal, 11) })).rejects.toThrow();
    const [still] = await db.select().from(products).where(eq(products.id, gp.id));
    expect(still.quantity).toBe(gp.quantity);
  });
  it("reports only aggregate the tenant's own data", async () => {
    const a = await salesSummary(royal, rangeFor(royal, "year"));
    const b = await salesSummary(glow, rangeFor(glow, "year"));
    expect(a.transactions).toBeGreaterThan(0);
    expect(a.sales).not.toBe(b.sales);
    const all = await db.select().from(transactions).where(eq(transactions.tenantId, ids.royal));
    expect(all.length).toBeGreaterThanOrEqual(a.transactions);
  });
});

describe("permissions", () => {
  it("cashier cannot manage staff or settings; salary hidden without permission", async () => {
    const cashier = await buildCtx(db, await uid(DEMO_USERS.multi), ids.glow);
    expect(cashier.role).toBe("cashier");
    await expect(saveStaff(cashier, { name: "X", schedule: {} })).rejects.toThrow(/Permission/);
    const manager = await buildCtx(db, await uid(DEMO_USERS.multi), ids.royal);
    expect(manager.role).toBe("manager");
    expect((await listStaff(manager)).every((s) => s.salary === null)).toBe(true);
    expect((await listStaff(royal)).some((s) => s.salary !== null)).toBe(true);
  });
  it("same user has different roles per workspace", async () => {
    const u = await uid(DEMO_USERS.multi);
    expect((await buildCtx(db, u, ids.royal)).role).not.toBe((await buildCtx(db, u, ids.glow)).role);
  });
});

describe("appointments", () => {
  let svc: typeof services.$inferSelect, st: typeof staff.$inferSelect, cu: typeof customers.$inferSelect;
  beforeAll(async () => {
    [svc] = await db.select().from(services).where(and(eq(services.tenantId, ids.royal), eq(services.name, "Haircut & Style")));
    [st] = await db.select().from(staff).where(eq(staff.tenantId, ids.royal));
    [cu] = await db.select().from(customers).where(eq(customers.tenantId, ids.royal));
  });
  it("books a valid slot and blocks double booking", async () => {
    const at = futureSlot(royal, 11);
    const a = await createAppointment(royal, { customerId: cu.id, serviceId: svc.id, staffId: st.id, startsAt: at });
    expect(a.status).toBe("confirmed");
    await expect(createAppointment(royal, { customerId: cu.id, serviceId: svc.id, staffId: st.id, startsAt: new Date(at.getTime() + 15 * 60000) })).rejects.toThrow(/conflict/i);
  });
  it("rejects bookings outside business hours, off-grid times and during breaks", async () => {
    await expect(createAppointment(royal, { customerId: cu.id, serviceId: svc.id, staffId: st.id, startsAt: futureSlot(royal, 7) })).rejects.toThrow(/business hours/i);
    await expect(createAppointment(royal, { customerId: cu.id, serviceId: svc.id, staffId: st.id, startsAt: futureSlot(royal, 16, 7) })).rejects.toThrow(/slots/i);
    await expect(createAppointment(royal, { customerId: cu.id, serviceId: svc.id, staffId: st.id, startsAt: futureSlot(royal, 14, 15) })).rejects.toThrow(/break/i);
    await expect(createAppointment(royal, { customerId: cu.id, serviceId: svc.id, staffId: st.id, startsAt: futureSlot(royal, 19, 30) })).rejects.toThrow(/business hours/i);
  });
  it("rejects invalid durations", async () => {
    await expect(createAppointment(royal, { customerId: cu.id, serviceId: svc.id, staffId: st.id, startsAt: futureSlot(royal, 16, 0, 5), durationMinutes: 2 })).rejects.toThrow(/duration/i);
  });
  it("reschedules and prevents rescheduling into a conflict", async () => {
    const t1 = futureSlot(royal, 16, 0, 6), t2 = futureSlot(royal, 18, 0, 6);
    const a = await createAppointment(royal, { customerId: cu.id, serviceId: svc.id, staffId: st.id, startsAt: t1 });
    const b = await createAppointment(royal, { customerId: cu.id, serviceId: svc.id, staffId: st.id, startsAt: t2 });
    await expect(rescheduleAppointment(royal, b.id, new Date(t1.getTime() + 15 * 60000))).rejects.toThrow(/conflict/i);
    await rescheduleAppointment(royal, a.id, futureSlot(royal, 12, 0, 6));
    const [row] = await db.select().from(appointments).where(eq(appointments.id, a.id));
    expect(row.startsAt.getTime()).toBe(futureSlot(royal, 12, 0, 6).getTime());
  });
  it("slot search only returns bookable slots", async () => {
    const d = zonedParts(futureSlot(royal, 11, 0, 8), royal.tenant.timezone).date;
    const slots = await findSlots(royal, { date: d, serviceId: svc.id, staffId: st.id });
    expect(slots.length).toBeGreaterThan(0);
    for (const s of slots.slice(0, 5)) {
      const m = zonedParts(s.startsAt, royal.tenant.timezone).minutes;
      expect(m).toBeGreaterThanOrEqual(600);
      expect(m + svc.durationMinutes).toBeLessThanOrEqual(1200);
      expect(m < 840 + 0 || m >= 900 || m + svc.durationMinutes <= 840).toBe(true); // never overlaps 14:00-15:00 break
    }
  });
  it("tenant timezone changes the interpretation of hours (Glow closed Sunday)", async () => {
    const [gsvc] = await db.select().from(services).where(eq(services.tenantId, ids.glow));
    const [gst] = await db.select().from(staff).where(eq(staff.tenantId, ids.glow));
    const [gc] = await db.select().from(customers).where(eq(customers.tenantId, ids.glow));
    let d = addDays(zonedParts(new Date(), glow.tenant.timezone).date, 2);
    while (zonedParts(zonedToUtc(d, 720, glow.tenant.timezone), glow.tenant.timezone).weekday !== 0) d = addDays(d, 1);
    await expect(createAppointment(glow, { customerId: gc.id, serviceId: gsvc.id, staffId: gst.id, startsAt: zonedToUtc(d, 660, glow.tenant.timezone) })).rejects.toThrow(/closed/i);
  });
});

describe("POS & financials", () => {
  it("computes tax on Glow (8.25%) exactly and records payment, invoice, commission", async () => {
    const [svc] = await db.select().from(services).where(and(eq(services.tenantId, ids.glow), eq(services.name, "Classic Manicure")));
    const [st] = await db.select().from(staff).where(eq(staff.tenantId, ids.glow));
    const r = await checkout(glow, { staffId: st.id, items: [{ kind: "service", id: svc.id, quantity: 1 }], idempotencyKey: "pos-tax-0001", payments: [{ method: "card", amount: 32.48 }] });
    expect(r.total).toBe("32.48"); // 30.00 + 2.48 (2.475 half-up)
    expect(r.status).toBe("paid");
    expect(r.invoiceNumber).toMatch(/^GBL-\d{5}$/);
  });
  it("is idempotent: same key never creates a second sale", async () => {
    const [p] = await db.select().from(products).where(and(eq(products.tenantId, ids.royal), eq(products.sku, "RHS-GEL")));
    const body = { items: [{ kind: "product", id: p.id, quantity: 2 }], idempotencyKey: "pos-idem-0001", payments: [{ method: "cash", amount: 1300 }] };
    const a = await checkout(royal, body), b = await checkout(royal, body);
    expect(b.duplicate).toBe(true);
    expect(b.transactionId).toBe(a.transactionId);
    const [after] = await db.select().from(products).where(eq(products.id, p.id));
    expect(after.quantity).toBe(p.quantity - 2);
  });
  it("concurrent duplicate submits produce one sale and one stock deduction", async () => {
    const [p] = await db.select().from(products).where(and(eq(products.tenantId, ids.royal), eq(products.sku, "RHS-SER")));
    const body = { items: [{ kind: "product", id: p.id, quantity: 1 }], idempotencyKey: "pos-race-0001", payments: [{ method: "cash", amount: 1200 }] };
    await Promise.allSettled([checkout(royal, body), checkout(royal, body)]);
    const sales = await db.select().from(transactions).where(and(eq(transactions.tenantId, ids.royal), eq(transactions.idempotencyKey, "pos-race-0001")));
    expect(sales.length).toBe(1);
    const [after] = await db.select().from(products).where(eq(products.id, p.id));
    expect(after.quantity).toBe(p.quantity - 1);
  });
  it("refuses to oversell and leaves stock and sales unchanged", async () => {
    const [p] = await db.select().from(products).where(and(eq(products.tenantId, ids.royal), eq(products.sku, "RHS-SHP")));
    const before = (await db.select().from(transactions).where(eq(transactions.tenantId, ids.royal))).length;
    await expect(checkout(royal, { items: [{ kind: "product", id: p.id, quantity: p.quantity + 1 }], idempotencyKey: "pos-over-0001", creditSale: true, payments: [] })).rejects.toThrow(/stock/i);
    expect((await db.select().from(transactions).where(eq(transactions.tenantId, ids.royal))).length).toBe(before);
    expect((await db.select().from(products).where(eq(products.id, p.id)))[0].quantity).toBe(p.quantity);
  });
  it("supports discounts, partial payment and settlement; rejects overpayment", async () => {
    const [svc] = await db.select().from(services).where(and(eq(services.tenantId, ids.royal), eq(services.name, "Hair Color")));
    const r = await checkout(royal, { items: [{ kind: "service", id: svc.id, quantity: 1, discount: 500 }], discount: 500, idempotencyKey: "pos-part-0001", creditSale: true, payments: [{ method: "cash", amount: 2000 }] });
    expect(r.total).toBe("5500.00");
    expect(r.status).toBe("partial");
    await expect(addPayment(royal, r.transactionId, "cash", 4000)).rejects.toThrow(/exceeds/i);
    await addPayment(royal, r.transactionId, "card", 3500);
    expect((await db.select().from(transactions).where(eq(transactions.id, r.transactionId)))[0].status).toBe("paid");
    await expect(voidSale(royal, r.transactionId, "mistake")).rejects.toThrow(/cannot be voided/i);
  });
  it("rejects payment methods the business has not enabled and short payments", async () => {
    const [svc] = await db.select().from(services).where(eq(services.tenantId, ids.royal));
    await expect(checkout(royal, { items: [{ kind: "service", id: svc.id, quantity: 1 }], idempotencyKey: "pos-meth-0001", payments: [{ method: "bitcoin", amount: 1500 }] })).rejects.toThrow(/not enabled/i);
    await expect(checkout(royal, { items: [{ kind: "service", id: svc.id, quantity: 1 }], idempotencyKey: "pos-short-001", payments: [{ method: "cash", amount: 1 }] })).rejects.toThrow(/less than/i);
  });
  it("voiding an unpaid sale restocks inventory and logs a movement", async () => {
    const p = (await db.select().from(products).where(eq(products.tenantId, ids.royal))).sort((a, b) => b.quantity - a.quantity)[0];
    expect(p.quantity).toBeGreaterThanOrEqual(3);
    const r = await checkout(royal, { items: [{ kind: "product", id: p.id, quantity: 3 }], idempotencyKey: "pos-void-0001", creditSale: true, payments: [] });
    expect((await db.select().from(products).where(eq(products.id, p.id)))[0].quantity).toBe(p.quantity - 3);
    await voidSale(royal, r.transactionId, "customer left");
    expect((await db.select().from(products).where(eq(products.id, p.id)))[0].quantity).toBe(p.quantity);
    const moves = await db.select().from(inventoryMovements).where(eq(inventoryMovements.refId, r.transactionId));
    expect(moves.map((m) => m.reason).sort()).toEqual(["return", "sale"]);
  });
  it("dashboard figures reconcile with raw rows", async () => {
    const r = rangeFor(royal, "year");
    const s = await salesSummary(royal, r);
    const rows = await db.select().from(transactions).where(and(eq(transactions.tenantId, ids.royal)));
    const live = rows.filter((x) => x.status !== "cancelled" && x.createdAt >= r.from && x.createdAt < r.to);
    expect(s.transactions).toBe(live.length);
    expect(toCents(s.sales)).toBe(live.reduce((a, x) => a + toCents(x.total), 0));
  });
});

describe("inventory & purchases", () => {
  it("records every stock change and prevents negative stock", async () => {
    const [p] = await db.select().from(products).where(and(eq(products.tenantId, ids.royal), eq(products.sku, "RHS-GEL")));
    await adjustStock(royal, p.id, -1, "damage", "dropped");
    await expect(adjustStock(royal, p.id, -100000, "adjustment")).rejects.toThrow(/below zero/i);
    const moves = await db.select().from(inventoryMovements).where(eq(inventoryMovements.productId, p.id));
    expect(moves.some((m) => m.reason === "damage")).toBe(true);
  });
  it("receiving a purchase adds stock once only", async () => {
    const [p] = await db.select().from(products).where(and(eq(products.tenantId, ids.royal), eq(products.sku, "RHS-SHP")));
    const supplierId = p.supplierId!;
    const id = await createPurchase(royal, { supplierId, items: [{ productId: p.id, quantity: 10, unitCost: 650 }] });
    await receivePurchase(royal, id);
    await expect(receivePurchase(royal, id)).rejects.toThrow(/already/i);
    expect((await db.select().from(products).where(eq(products.id, p.id)))[0].quantity).toBe(p.quantity + 10);
  });
});

describe("auth", () => {
  it("registers a business owner, enforces unique email, hashes password and locks after repeated failures", async () => {
    const { user, tenant } = await registerOwner(db, { name: "New Owner", email: "new@owner.test", password: "Str0ng-Password1", businessName: "Fresh Cuts" });
    expect(user.passwordHash).not.toContain("Str0ng");
    expect(tenant.status).toBe("active");
    await expect(registerOwner(db, { name: "Dup", email: "NEW@owner.test", password: "Str0ng-Password1", businessName: "Other" })).rejects.toThrow(/already exists/);
    await expect(registerOwner(db, { name: "W", email: "weak@owner.test", password: "short", businessName: "W" })).rejects.toThrow();
    expect((await verifyLogin(db, "new@owner.test", "Str0ng-Password1")).id).toBe(user.id);
    for (let i = 0; i < 5; i++) await expect(verifyLogin(db, "new@owner.test", "wrong-password")).rejects.toThrow();
    await expect(verifyLogin(db, "new@owner.test", "Str0ng-Password1")).rejects.toThrow(/Too many/);
  });
  it("suspended businesses cannot be accessed", async () => {
    await db.update(tenants).set({ status: "suspended" }).where(eq(tenants.id, ids.glow));
    await expect(buildCtx(db, await uid(DEMO_USERS.glow), ids.glow)).rejects.toThrow(/suspended/);
    await db.update(tenants).set({ status: "active" }).where(eq(tenants.id, ids.glow));
  });
});
