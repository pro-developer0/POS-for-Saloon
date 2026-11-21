import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createDb, type DB } from "@/db/client";
import { tenants } from "@/db/schema";
import { registerOwner } from "@/server/auth";
import { buildCtx, type Ctx } from "@/server/ctx";
import { saveService } from "@/server/services/crm";
import { hasModule, labelsOf, modulesOf, SALON_TYPES, MODULES, CORE_MODULES, BUSINESS_TYPE_OPTIONS, verticalOf } from "@/lib/verticals";

let db: DB;
async function make(type: string, n: string): Promise<Ctx> {
  const { user, tenant } = await registerOwner(db, { name: "Owner " + n, email: `${n}@v.test`, password: "Vertical-Pass-1", businessName: `${n} Salon`, businessType: type });
  await db.update(tenants).set({ onboarded: true, paymentMethods: ["cash", "card"] }).where(eq(tenants.id, tenant.id));
  return buildCtx(db, user.id, tenant.id);
}
beforeAll(async () => { db = await createDb({ memory: true }); });

describe("salon-only registry", () => {
  it("only salon types are offered", () => {
    expect(BUSINESS_TYPE_OPTIONS.map(([k]) => k)).toEqual(["mens_salon", "womens_salon", "unisex_salon"]);
    for (const [k] of BUSINESS_TYPE_OPTIONS) expect(SALON_TYPES[k]).toBeDefined();
    for (const bad of ["pharmacy", "retail", "grocery", "restaurant", "clinic", "other", "spa", "barbershop", "hair_salon"]) expect(SALON_TYPES[bad]).toBeUndefined();
  });
  it("core modules are always on, and unknown types fall back to a salon", () => {
    const m = modulesOf({ modules: [] });
    for (const c of CORE_MODULES) expect(m.has(c)).toBe(true);
    expect(MODULES).not.toContain("batches");
    expect(verticalOf("made_up").label).toBe("Unisex salon");
    expect(verticalOf("hair_salon").label).toBe("Hair salon"); // older salons keep their label
    expect(labelsOf().staff).toBe("Stylists");
  });
});

describe("salon sign-up", () => {
  it("rejects non-salon business types", async () => {
    await expect(registerOwner(db, { name: "X Owner", email: "bad@v.test", password: "Vertical-Pass-1", businessName: "Bad Pharmacy", businessType: "pharmacy" })).rejects.toThrow();
  });
  it("new salons start active with appointments, services and staff on", async () => {
    const c = await make("mens_salon", "barber");
    expect(c.tenant.status).toBe("active");
    expect(c.tenant.businessType).toBe("mens_salon");
    expect(c.tenant.trialEndsAt).toBeNull();
    for (const m of CORE_MODULES) expect(hasModule(c.tenant, m)).toBe(true);
    await expect(saveService(c, { name: "Fade", durationMinutes: 30, price: 15 })).resolves.toBeTruthy();
  });
  it("optional modules can be switched off but core ones cannot", async () => {
    const c = await make("womens_salon", "spa1");
    await db.update(tenants).set({ modules: ["inventory"] }).where(eq(tenants.id, c.tenantId));
    const again = await buildCtx(db, c.userId, c.tenantId);
    expect(hasModule(again.tenant, "expenses")).toBe(false);
    expect(hasModule(again.tenant, "appointments")).toBe(true);
  });
});
