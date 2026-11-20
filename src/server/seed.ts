import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import type { DB } from "@/db/client";
import { users, memberships, tenants, customers, services, serviceCategories, staff, staffServices, products, suppliers, expenses, appointments, transactions, payments, invoices, commissions, inventoryMovements } from "@/db/schema";
import { createTenant } from "./auth";
import { buildCtx } from "./ctx";
import { checkout } from "./services/pos";
import { defaultWeek, zonedParts, zonedToUtc, addDays } from "@/lib/time";

export const DEMO_PASSWORD = "Demo-Pass-123";
export const DEMO_USERS = {
  royal: "owner@royal.demo", glow: "owner@glow.demo", multi: "multi@demo.test", admin: "admin@salonpro.local",
};

type Spec = {
  name: string; type: string; currency: string; tz: string; country: string; brand: string; accent: string; taxRate: string; prefix: string;
  cats: { name: string; items: [string, number, number, number][] }[]; // name, minutes, price, commission%
  staff: [string, string, string][]; // name, title, color
  customers: string[]; products: [string, string, number, number, number][]; // name, sku, cost, sell, qty
  expenses: [string, string, number][]; methods: string[];
};

const SPECS: Record<string, Spec> = {
  royal: {
    name: "Royal Hair Studio", type: "hair_salon", currency: "PKR", tz: "Asia/Karachi", country: "PK", brand: "#8b5cf6", accent: "#f59e0b", taxRate: "0", prefix: "RHS",
    cats: [
      { name: "Hair", items: [["Haircut & Style", 45, 1500, 20], ["Hair Color", 120, 6500, 15], ["Keratin Treatment", 150, 12000, 15], ["Blow Dry", 30, 900, 20]] },
      { name: "Grooming", items: [["Beard Trim", 20, 500, 25], ["Facial", 60, 3000, 20]] },
    ],
    staff: [["Ayesha Khan", "Senior Stylist", "#be185d"], ["Bilal Ahmed", "Barber", "#0369a1"], ["Sana Malik", "Colorist", "#7c3aed"]],
    customers: ["Fatima Noor", "Hassan Raza", "Zainab Ali", "Usman Tariq", "Maryam Shah", "Imran Qureshi", "Hira Siddiqui", "Ali Haider", "Nida Farooq", "Kamran Butt", "Rabia Iqbal", "Saad Mehmood"],
    products: [["Argan Hair Oil", "RHS-OIL", 900, 1600, 12], ["Keratin Shampoo", "RHS-SHP", 700, 1300, 3], ["Hair Serum", "RHS-SER", 600, 1200, 8], ["Styling Gel", "RHS-GEL", 300, 650, 20]],
    expenses: [["Shop rent", "Rent", 85000], ["Electricity bill", "Utilities", 18000], ["Staff tea & supplies", "Supplies", 4500], ["Instagram ads", "Marketing", 6000]],
    methods: ["cash", "card", "easypaisa", "jazzcash"],
  },
  glow: {
    name: "Glow Beauty Lounge", type: "beauty_salon", currency: "USD", tz: "America/New_York", country: "US", brand: "#0d9488", accent: "#e11d48", taxRate: "8.25", prefix: "GBL",
    cats: [
      { name: "Nails", items: [["Classic Manicure", 30, 30, 25], ["Gel Pedicure", 60, 55, 25], ["Nail Art", 45, 40, 30]] },
      { name: "Skin & Brows", items: [["Signature Facial", 60, 95, 20], ["Brow Shaping", 30, 35, 30], ["Lash Lift", 60, 85, 25]] },
    ],
    staff: [["Olivia Martin", "Nail Artist", "#0d9488"], ["Emma Wilson", "Esthetician", "#e11d48"], ["Chloe Davis", "Brow & Lash Specialist", "#f59e0b"]],
    customers: ["Sophia Turner", "Mia Johnson", "Ava Brown", "Isabella Lee", "Charlotte King", "Amelia Scott", "Harper Young", "Evelyn Hall", "Abigail Wright", "Ella Green"],
    products: [["Cuticle Oil", "GBL-CUT", 3, 9, 25], ["Hydrating Mask", "GBL-MSK", 8, 22, 4], ["Gel Polish - Rose", "GBL-GRS", 6, 16, 10]],
    expenses: [["Studio rent", "Rent", 3200], ["Supplies order", "Supplies", 640], ["Social media ads", "Marketing", 300]],
    methods: ["cash", "card", "apple_pay"],
  },
};

export async function seedDemo(db: DB) {
  const hash = await bcrypt.hash(DEMO_PASSWORD, 10);
  const mk = async (email: string, name: string, admin = false) => (await db.insert(users).values({ email, name, passwordHash: hash, isPlatformAdmin: admin, emailVerifiedAt: new Date() }).returning())[0];
  const owners = { royal: await mk(DEMO_USERS.royal, "Royal Owner"), glow: await mk(DEMO_USERS.glow, "Glow Owner") };
  const multi = await mk(DEMO_USERS.multi, "Multi Workspace Manager");
  await mk(DEMO_USERS.admin, "Platform Admin", true);
  const out: Record<string, string> = {};

  for (const key of ["royal", "glow"] as const) {
    const sp = SPECS[key];
    const t = await createTenant(db, { name: sp.name, type: sp.type, currency: sp.currency, timezone: sp.tz, country: sp.country, isDemo: true });
    out[key] = t.id;
    await db.update(tenants).set({
      brandColor: sp.brand, accentColor: sp.accent, taxRate: sp.taxRate, invoicePrefix: sp.prefix, onboarded: true, status: "active",
      paymentMethods: sp.methods, hours: defaultWeek("10:00", "20:00", key === "royal" ? [] : [0]), email: `hello@${key}.demo`, phone: "+00 000 0000",
      address: key === "royal" ? "Demo Plaza, Lahore" : "123 Demo Ave, New York, NY",
    }).where(eq(tenants.id, t.id));
    await db.insert(memberships).values({ userId: owners[key].id, tenantId: t.id, role: "owner" });
    if (key === "royal") await db.insert(memberships).values({ userId: multi.id, tenantId: t.id, role: "manager" });
    if (key === "glow") await db.insert(memberships).values({ userId: multi.id, tenantId: t.id, role: "cashier" });

    const svcRows: (typeof services.$inferSelect)[] = [];
    for (const c of sp.cats) {
      const [cat] = await db.insert(serviceCategories).values({ tenantId: t.id, name: c.name }).returning();
      for (const [name, min, price, comm] of c.items)
        svcRows.push((await db.insert(services).values({ tenantId: t.id, categoryId: cat.id, name, durationMinutes: min, price: price.toFixed(2), commissionPct: comm.toFixed(2), taxable: key === "glow" }).returning())[0]);
    }
    const staffRows: (typeof staff.$inferSelect)[] = [];
    for (const [name, title, color] of sp.staff) {
      const [s] = await db.insert(staff).values({ tenantId: t.id, name, jobTitle: title, color, schedule: defaultWeek("10:00", "20:00", key === "royal" ? [] : [0]), breaks: [{ start: "14:00", end: "15:00" }], commissionPct: "15", salary: "0" }).returning();
      staffRows.push(s);
      await db.insert(staffServices).values(svcRows.map((v) => ({ staffId: s.id, serviceId: v.id, tenantId: t.id })));
    }
    const [sup] = await db.insert(suppliers).values({ tenantId: t.id, name: key === "royal" ? "Karachi Beauty Wholesale" : "Pro Beauty Supply Co", phone: "000-000" }).returning();
    const prodRows: (typeof products.$inferSelect)[] = [];
    for (const [name, sku, cost, sell, qty] of sp.products) {
      const [p] = await db.insert(products).values({ tenantId: t.id, name, sku, costPrice: cost.toFixed(2), sellPrice: sell.toFixed(2), quantity: qty, minStock: 5, supplierId: sup.id, category: "Retail", taxable: key === "glow" }).returning();
      await db.insert(inventoryMovements).values({ tenantId: t.id, productId: p.id, delta: qty, balanceAfter: qty, reason: "initial" });
      prodRows.push(p);
    }
    const custRows: (typeof customers.$inferSelect)[] = [];
    for (const [i, name] of sp.customers.entries())
      custRows.push((await db.insert(customers).values({ tenantId: t.id, name, phone: `+000 555 01${String(i).padStart(2, "0")}`, email: `${name.split(" ")[0].toLowerCase()}@example.test`, tags: i % 3 === 0 ? ["vip"] : [], marketingConsent: i % 2 === 0 }).returning())[0]);

    const today = zonedParts(new Date(), sp.tz).date;
    for (const [i, [name, cat, amt]] of sp.expenses.entries())
      await db.insert(expenses).values({ tenantId: t.id, name, category: cat, amount: amt.toFixed(2), spentOn: addDays(today, -i * 4 - 1), paymentMethod: "cash" });

    // Past completed appointments + real checkouts, backdated over 45 days
    const ctx = await buildCtx(db, owners[key].id, t.id);
    for (let n = 0; n < 40; n++) {
      const daysAgo = 1 + (n * 7) % 44;
      const svc = svcRows[n % svcRows.length], st = staffRows[n % staffRows.length], cu = custRows[(n * 5) % custRows.length];
      const date = addDays(today, -daysAgo);
      const startsAt = zonedToUtc(date, 600 + ((n * 45) % 360), sp.tz);
      const [a] = await db.insert(appointments).values({
        tenantId: t.id, customerId: cu.id, serviceId: svc.id, staffId: st.id, startsAt, endsAt: new Date(startsAt.getTime() + svc.durationMinutes * 60000),
        durationMinutes: svc.durationMinutes, price: svc.price, status: "completed", source: "staff",
      }).returning();
      const items: { kind: "service" | "product"; id: string; quantity: number }[] = [{ kind: "service", id: svc.id, quantity: 1 }];
      if (n % 4 === 0) items.push({ kind: "product", id: prodRows[n % prodRows.length].id, quantity: 1 });
      const r = await checkout(ctx, { customerId: cu.id, staffId: st.id, items, idempotencyKey: `seed-${key}-${n}`, appointmentId: null,
        payments: [{ method: sp.methods[n % sp.methods.length], amount: Number((await totalFor(ctx, svc, prodRows, items, key)).toFixed(2)) }] });
      await db.update(appointments).set({ transactionId: r.transactionId }).where(eq(appointments.id, a.id));
      await backdate(db, r.transactionId, startsAt);
    }
    // today's schedule across all stylists (feeds the dashboard day view)
    const todayRows: [number, number, number][] = [[0, 0, 540], [0, 2, 690], [0, 4, 840], [1, 1, 540], [1, 3, 690], [1, 5, 780], [2, 2, 570], [2, 0, 720], [2, 4, 870]]; // staff idx, service idx, start minutes
    for (const [n, [si, vi, mins]] of todayRows.entries()) {
      const st = staffRows[si % staffRows.length], svc = svcRows[vi % svcRows.length];
      const startsAt = zonedToUtc(today, mins, sp.tz);
      await db.insert(appointments).values({
        tenantId: t.id, customerId: custRows[(n * 3) % custRows.length].id, serviceId: svc.id, staffId: st.id, startsAt,
        endsAt: new Date(startsAt.getTime() + svc.durationMinutes * 60000), durationMinutes: svc.durationMinutes, price: svc.price, status: n % 3 === 0 ? "pending" : "confirmed",
      });
    }
    // upcoming appointments on the next days
    for (let n = 0; n < 8; n++) {
      const date = addDays(today, 1 + (n % 5));
      const st = staffRows[n % staffRows.length], svc = svcRows[(n + 1) % svcRows.length];
      const startsAt = zonedToUtc(date, 600 + n * 40, sp.tz);
      await db.insert(appointments).values({ tenantId: t.id, customerId: custRows[(n * 2 + 1) % custRows.length].id, serviceId: svc.id, staffId: st.id, startsAt, endsAt: new Date(startsAt.getTime() + svc.durationMinutes * 60000), durationMinutes: svc.durationMinutes, price: svc.price, status: "confirmed" });
    }
    // legacy: a few more future appointments
    for (let n = 0; n < 3; n++) {
      const date = addDays(today, 1 + n);
      const d = zonedParts(zonedToUtc(date, 720, sp.tz), sp.tz);
      if (!ctx.tenant.hours[String(d.weekday) as "0"] && key === "glow" && d.weekday === 0) continue;
      const svc = svcRows[n], st = staffRows[n % staffRows.length];
      const startsAt = zonedToUtc(date, 660 + n * 60, sp.tz);
      await db.insert(appointments).values({ tenantId: t.id, customerId: custRows[n].id, serviceId: svc.id, staffId: st.id, startsAt, endsAt: new Date(startsAt.getTime() + svc.durationMinutes * 60000), durationMinutes: svc.durationMinutes, price: svc.price, status: "confirmed" });
    }
  }
  return out;
}

async function totalFor(ctx: Awaited<ReturnType<typeof buildCtx>>, svc: typeof services.$inferSelect, prods: (typeof products.$inferSelect)[], items: { kind: string; id: string; quantity: number }[], key: string) {
  const { toCents, pctOf } = await import("@/lib/money");
  let total = 0;
  for (const i of items) {
    const src = i.kind === "service" ? svc : prods.find((p) => p.id === i.id)!;
    const net = toCents(i.kind === "service" ? (src as typeof svc).price : (src as (typeof prods)[number]).sellPrice) * i.quantity;
    total += net + (src.taxable ? pctOf(net, ctx.tenant.taxRate) : 0);
  }
  void key;
  return total / 100;
}

async function backdate(db: DB, txId: string, when: Date) {
  await db.update(transactions).set({ createdAt: when }).where(eq(transactions.id, txId));
  await db.update(payments).set({ createdAt: when }).where(eq(payments.transactionId, txId));
  await db.update(invoices).set({ createdAt: when }).where(eq(invoices.transactionId, txId));
  await db.update(commissions).set({ createdAt: when }).where(eq(commissions.transactionId, txId));
}
