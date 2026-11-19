import { beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { createDb, type DB } from "@/db/client";
import { notifications, products, tenants, inventoryMovements } from "@/db/schema";
import { registerOwner } from "@/server/auth";
import { buildCtx, type Ctx } from "@/server/ctx";
import { createAppointment, findSlots } from "@/server/services/appointments";
import { saveService, saveStaff } from "@/server/services/crm";
import { saveProduct } from "@/server/services/inventory";
import { checkout, voidSale } from "@/server/services/pos";
import { hasModule, labelsOf, modulesOf, presetModules, VERTICALS, MODULES, BUSINESS_TYPE_OPTIONS } from "@/lib/verticals";
import { defaultWeek } from "@/lib/time";

let db: DB;
async function make(type: string, n: string): Promise<Ctx> {
  const { user, tenant } = await registerOwner(db, { name: "Owner " + n, email: `${n}@v.test`, password: "Vertical-Pass-1", businessName: `${n} Business`, businessType: type });
  await db.update(tenants).set({ onboarded: true, paymentMethods: ["cash", "card"] }).where(eq(tenants.id, tenant.id));
  return buildCtx(db, user.id, tenant.id);
}
beforeAll(async () => { db = await createDb({ memory: true }); });

describe("business-type registry", () => {
  it("pharmacy is offered first and every type is valid", () => {
    expect(BUSINESS_TYPE_OPTIONS[0][0]).toBe("pharmacy");
    for (const [k] of BUSINESS_TYPE_OPTIONS) { expect(VERTICALS[k]).toBeDefined(); for (const m of presetModules(k)) expect(MODULES).toContain(m); }
  });
  it("pharmacy gets batches + prescriptions but no appointments; salons keep appointments", () => {
    expect(presetModules("pharmacy")).toEqual(expect.arrayContaining(["inventory", "batches"]));
    expect(presetModules("pharmacy")).not.toContain("appointments");
    expect(presetModules("hair_salon")).toContain("appointments");
    expect(presetModules("restaurant")).not.toContain("appointments");
    expect(presetModules("clinic")).toContain("appointments");
  });
  it("unknown business types fall back safely and labels adapt per type", () => {
    expect(modulesOf({ businessType: "made_up", modules: null }).size).toBeGreaterThan(0);
    expect(labelsOf({ businessType: "clinic" }).customers).toBe("Patients");
    expect(labelsOf({ businessType: "restaurant" }).products).toBe("Menu");
    expect(labelsOf({ businessType: "hair_salon" }).customers).toBe("Customers");
  });
});

describe("module enforcement on the server", () => {
  let shop: Ctx;
  beforeAll(async () => { shop = await make("retail", "shop"); });

  it("a retail business cannot use appointments, services or staff scheduling even by calling the API", async () => {
    expect(hasModule(shop.tenant, "appointments")).toBe(false);
    await expect(createAppointment(shop, {})).rejects.toThrow(/not enabled/);
    await expect(findSlots(shop, { date: "2030-01-01", serviceId: "00000000-0000-0000-0000-000000000000" })).rejects.toThrow(/not enabled/);
    await expect(saveService(shop, { name: "Cut", durationMinutes: 30, price: 5 })).rejects.toThrow(/not enabled/);
    await expect(saveStaff(shop, { name: "X", schedule: defaultWeek() })).rejects.toThrow(/not enabled/);
  });
  it("the owner can switch a module on, and it then works; an explicit list overrides the type preset", async () => {
    await db.update(tenants).set({ modules: ["services", "inventory", "purchases", "expenses"] }).where(eq(tenants.id, shop.tenantId));
    const again = await buildCtx(db, shop.userId, shop.tenantId);
    expect(hasModule(again.tenant, "services")).toBe(true);
    await expect(saveService(again, { name: "Gift wrapping", durationMinutes: 10, price: 2 })).resolves.toBeTruthy();
    await expect(createAppointment(again, {})).rejects.toThrow(/not enabled/); // still off
  });
  it("modules left null follow a change of business type", async () => {
    const c = await make("grocery", "grocer");
    expect(hasModule(c.tenant, "appointments")).toBe(false);
    await db.update(tenants).set({ businessType: "hair_salon" }).where(eq(tenants.id, c.tenantId));
    expect(hasModule((await buildCtx(db, c.userId, c.tenantId)).tenant, "appointments")).toBe(true);
  });
});

describe("non-stocked items (restaurant menu, services-like goods)", () => {
  let cafe: Ctx; let menuId: string; let stockedId: string;
  beforeAll(async () => {
    cafe = await make("restaurant", "cafe");
    menuId = await saveProduct(cafe, { name: "Chicken Karahi", sellPrice: 1200, costPrice: 400, trackStock: false, minStock: 5 });
    stockedId = await saveProduct(cafe, { name: "Bottled Water", sellPrice: 100, costPrice: 40, initialQuantity: 3, minStock: 1 });
  });
  it("sells with zero stock and never changes quantity or logs movements", async () => {
    const r = await checkout(cafe, { items: [{ kind: "product", id: menuId, quantity: 4 }], idempotencyKey: "cafe-menu-0001", payments: [{ method: "cash", amount: 4800 }], notes: "Table 7" });
    expect(r.status).toBe("paid");
    const [p] = await db.select().from(products).where(eq(products.id, menuId));
    expect(p.quantity).toBe(0);
    expect(await db.select().from(inventoryMovements).where(eq(inventoryMovements.productId, menuId))).toHaveLength(0);
    const lows = await db.select().from(notifications).where(and(eq(notifications.tenantId, cafe.tenantId), eq(notifications.kind, "low_stock")));
    expect(lows.some((n) => n.title.includes("Chicken Karahi"))).toBe(false);
  });
  it("still enforces stock on tracked items in the same business", async () => {
    await expect(checkout(cafe, { items: [{ kind: "product", id: stockedId, quantity: 9 }], idempotencyKey: "cafe-water-0001", creditSale: true, payments: [] })).rejects.toThrow(/stock/i);
  });
  it("voiding an unpaid sale of an untracked item does not invent stock", async () => {
    const r = await checkout(cafe, { items: [{ kind: "product", id: menuId, quantity: 2 }], idempotencyKey: "cafe-void-0001", creditSale: true, payments: [] });
    await voidSale(cafe, r.transactionId, "guest left");
    expect((await db.select().from(products).where(eq(products.id, menuId)))[0].quantity).toBe(0);
  });
});

describe("business type is chosen once", () => {
  it("new businesses start active (no trial/billing state) and keep their chosen type", async () => {
    const c = await make("pharmacy", "locktest");
    expect(c.tenant.status).toBe("active");
    expect(c.tenant.businessType).toBe("pharmacy");
    expect(c.tenant.trialEndsAt).toBeNull();
  });
});
