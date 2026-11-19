import { beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { createDb, type DB } from "@/db/client";
import { customers, inventoryMovements, notifications, productBatches, products, transactionItemBatches, transactionItems, users } from "@/db/schema";
import { seedDemo, DEMO_USERS } from "@/server/seed";
import { buildCtx, type Ctx } from "@/server/ctx";
import { checkout, voidSale } from "@/server/services/pos";
import { adjustStock, createPurchase, receivePurchase, saveProduct } from "@/server/services/inventory";
import { expiryNotify, expiryReport, expirySummary, listBatches, writeOffBatch, sellableMap } from "@/server/services/batches";
import { saveStaff } from "@/server/services/crm";
import { addDays, defaultWeek, zonedParts } from "@/lib/time";

let db: DB; let ids: Record<string, string>; let owner: Ctx; let pharmacist: Ctx; let royal: Ctx;
const uid = async (e: string) => (await db.select().from(users).where(eq(users.email, e)))[0].id;
const prod = async (name: string) => (await db.select().from(products).where(and(eq(products.tenantId, ids.pharmacy), eq(products.name, name))))[0];
const batch = async (no: string) => (await db.select().from(productBatches).where(and(eq(productBatches.tenantId, ids.pharmacy), eq(productBatches.batchNo, no))))[0];
let n = 0; const key = () => `pharm-test-${++n}-${Math.random().toString(36).slice(2, 8)}`;
const custCache = new Map<string, string>();
async function custFor(ctx: Ctx) { // credit sales must name a customer
  if (!custCache.has(ctx.tenantId)) custCache.set(ctx.tenantId, (await db.select().from(customers).where(eq(customers.tenantId, ctx.tenantId)).limit(1))[0].id);
  return custCache.get(ctx.tenantId)!;
}
const sell = async (ctx: Ctx, productId: string, quantity: number, extra: Record<string, unknown> = {}, pay = true) =>
  checkout(ctx, { items: [{ kind: "product", id: productId, quantity, ...extra }], idempotencyKey: key(), ...(pay ? { payments: [{ method: "cash", amount: 100000 }] } : { creditSale: true, customerId: await custFor(ctx), payments: [] }) });
// pay exactly: use credit sale so tests do not depend on prices
const sellCredit = (ctx: Ctx, productId: string, quantity: number, extra: Record<string, unknown> = {}) => sell(ctx, productId, quantity, extra, false);

beforeAll(async () => {
  db = await createDb({ memory: true });
  ids = await seedDemo(db);
  owner = await buildCtx(db, await uid(DEMO_USERS.pharmacy), ids.pharmacy);
  pharmacist = await buildCtx(db, await uid(DEMO_USERS.pharmacist), ids.pharmacy);
  royal = await buildCtx(db, await uid(DEMO_USERS.royal), ids.royal);
});

describe("pharmacy demo data", () => {
  it("is a pharmacy with batches on and stock equal to the sum of its batches", async () => {
    expect(owner.tenant.businessType).toBe("pharmacy");
    for (const p of await db.select().from(products).where(eq(products.tenantId, ids.pharmacy))) {
      const bs = await db.select().from(productBatches).where(eq(productBatches.productId, p.id));
      expect(bs.reduce((a, b) => a + b.quantity, 0)).toBe(p.quantity);
    }
  });
});

describe("first-expiry-first-out selling", () => {
  it("takes from the soonest-expiring in-date batch first", async () => {
    const p = await prod("Panadol 500mg"); const soon = await batch("PAN-2312"), late = await batch("PAN-2409");
    const r = await sellCredit(owner, p.id, 10);
    expect((await batch("PAN-2312")).quantity).toBe(soon.quantity - 10);
    expect((await batch("PAN-2409")).quantity).toBe(late.quantity);
    expect((await prod("Panadol 500mg")).quantity).toBe(p.quantity - 10);
    const mv = await db.select().from(inventoryMovements).where(eq(inventoryMovements.refId, r.transactionId));
    expect(mv).toHaveLength(1);
    expect(mv[0].batchId).toBe(soon.id);
  });
  it("spans batches when the first one runs out", async () => {
    const p = await prod("Panadol 500mg"); const soon = await batch("PAN-2312"), late = await batch("PAN-2409");
    const want = soon.quantity + 15;
    const r = await sellCredit(owner, p.id, want);
    expect((await batch("PAN-2312")).quantity).toBe(0);
    expect((await batch("PAN-2409")).quantity).toBe(late.quantity - 15);
    const [item] = await db.select().from(transactionItems).where(eq(transactionItems.transactionId, r.transactionId));
    const alloc = await db.select().from(transactionItemBatches).where(eq(transactionItemBatches.itemId, item.id));
    expect(alloc.reduce((a, x) => a + x.quantity, 0)).toBe(want);
    expect(item.stockUnits).toBe(want);
  });
  it("never sells expired stock and explains why", async () => {
    const p = await prod("Augmentin 625mg");
    const [sellable] = [(await sellableMap(owner)).get(p.id)!];
    expect(sellable.expired).toBeGreaterThan(0);
    await expect(sellCredit(owner, p.id, sellable.sellable + 1)).rejects.toThrow(/expired unit\(s\) cannot be sold/);
    await sellCredit(owner, p.id, sellable.sellable); // all in-date units are sellable
    await expect(sellCredit(owner, p.id, 1)).rejects.toThrow(/Not enough in-date stock/);
    expect((await batch("AUG-2305")).quantity).toBe(sellable.expired); // expired batch untouched
  });
  it("a failed sale changes nothing (no stock, no sale row)", async () => {
    const p = await prod("Brufen 400mg"); const before = p.quantity;
    await expect(sellCredit(owner, p.id, before + 1)).rejects.toThrow();
    expect((await prod("Brufen 400mg")).quantity).toBe(before);
  });
  it("two simultaneous sales cannot oversell a batch", async () => {
    const p = await prod("Calpol Syrup 120mg/5ml"); // 38 units in total, 30 per sale
    const res = await Promise.allSettled([sellCredit(owner, p.id, 30), sellCredit(owner, p.id, 30)]);
    expect(res.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    const bs = await listBatches(owner, p.id);
    expect(bs.every((b) => b.quantity >= 0)).toBe(true);
    expect((await prod("Calpol Syrup 120mg/5ml")).quantity).toBe(bs.reduce((a, b) => a + b.quantity, 0));
  });
});

describe("selling by strip / box", () => {
  it("a pack sale takes pack-size units from stock at the pack price", async () => {
    const p = await prod("Brufen 400mg");
    const r = await sell(owner, p.id, 2, { pack: true }, false);
    expect(r.total).toBe("90.00"); // 2 strips x 45 (pack price)
    expect((await prod("Brufen 400mg")).quantity).toBe(p.quantity - 20);
    const [item] = await db.select().from(transactionItems).where(eq(transactionItems.transactionId, r.transactionId));
    expect(item.stockUnits).toBe(20);
    expect(item.name).toMatch(/strip of 10/);
  });
  it("units and packs of the same product can share one sale", async () => {
    const p = await prod("Brufen 400mg");
    const r = await checkout(owner, { items: [{ kind: "product", id: p.id, quantity: 3 }, { kind: "product", id: p.id, quantity: 1, pack: true }], idempotencyKey: key(), creditSale: true, customerId: await custFor(owner), payments: [] });
    expect(r.total).toBe("60.00"); // 3 x 5 + 1 x 45
    expect((await prod("Brufen 400mg")).quantity).toBe(p.quantity - 3 - 10);
  });
  it("pack price falls back to unit price x pack size; products without a pack size reject pack sales", async () => {
    const [vit] = await db.select().from(products).where(and(eq(products.tenantId, ids.pharmacy), eq(products.name, "Vitamin C 500mg")));
    await db.update(products).set({ packPrice: null }).where(eq(products.id, vit.id));
    const r = await sell(owner, vit.id, 1, { pack: true }, false);
    expect(r.total).toBe("300.00"); // 100 x 3.00
    const syrup = await prod("Calpol Syrup 120mg/5ml");
    await expect(sell(owner, syrup.id, 1, { pack: true }, false)).rejects.toThrow(/no pack size/);
  });
});

describe("voids return stock to the same batches", () => {
  it("restores batch quantity and logs batch-level return movements", async () => {
    const p = await prod("Panadol 500mg"); const late = await batch("PAN-2409");
    const r = await sellCredit(owner, p.id, 7);
    const mid = await batch("PAN-2409");
    expect(mid.quantity).toBe(late.quantity - 7);
    await voidSale(owner, r.transactionId, "customer changed mind");
    expect((await batch("PAN-2409")).quantity).toBe(late.quantity);
    expect((await prod("Panadol 500mg")).quantity).toBe(p.quantity);
    const mv = await db.select().from(inventoryMovements).where(eq(inventoryMovements.refId, r.transactionId));
    expect(mv.map((m) => m.reason).sort()).toEqual(["return", "sale"]);
    expect(mv.every((m) => m.batchId === late.id)).toBe(true);
  });
  it("voiding a pack sale returns all pack units", async () => {
    const p = await prod("Brufen 400mg");
    const r = await sell(owner, p.id, 1, { pack: true }, false);
    await voidSale(owner, r.transactionId, "mistake");
    expect((await prod("Brufen 400mg")).quantity).toBe(p.quantity);
  });
});

describe("expiry report and alerts", () => {
  it("lists expired, 30, 60 and 90-day groups", async () => {
    const vit = await prod("Vitamin C 500mg");
    const today = zonedParts(new Date(), "Asia/Karachi").date;
    await adjustStock(owner, vit.id, 5, "adjustment", "t", { batchNo: "VIC-D10", expiryDate: addDays(today, 10) });
    await adjustStock(owner, vit.id, 5, "adjustment", "t", { batchNo: "VIC-D45", expiryDate: addDays(today, 45) });
    await adjustStock(owner, vit.id, 5, "adjustment", "t", { batchNo: "VIC-D80", expiryDate: addDays(today, 80) });
    const rows = await expiryReport(owner, 90);
    const by = (no: string) => rows.find((r) => r.batchNo === no);
    expect(by("AUG-2305")!.daysLeft).toBeLessThan(0); // already expired
    expect(by("VIC-D10")!.daysLeft).toBe(10);
    expect(by("VIC-D45")!.daysLeft).toBe(45);
    expect(by("VIC-D80")!.daysLeft).toBe(80);
    expect(by("VIC-2503")).toBeUndefined(); // 500 days away: not in the 90-day window
    const s = expirySummary(rows);
    expect(s.expired).toBeGreaterThanOrEqual(1);
    expect(s.d30).toBeGreaterThanOrEqual(1);
    expect(s.d60).toBeGreaterThanOrEqual(1);
    expect(s.d90).toBeGreaterThanOrEqual(1);
    expect(rows.every((r) => r.quantity > 0)).toBe(true);
  });
  it("creates each notification once, however often it is checked", async () => {
    await expiryNotify(owner); await expiryNotify(owner);
    const rows = await db.select().from(notifications).where(and(eq(notifications.tenantId, ids.pharmacy), eq(notifications.kind, "expiry")));
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(new Set(rows.map((r) => r.dedupeKey)).size).toBe(rows.length);
    expect(rows.some((r) => r.title.startsWith("Expired:"))).toBe(true);
  });
  it("businesses without batches get no expiry data", async () => {
    expect(await expiryReport(royal, 90)).toEqual([]);
  });
});

describe("write-off", () => {
  it("removes an expired batch from stock and records it", async () => {
    const b = await batch("AUG-2305"); const p = await prod("Augmentin 625mg");
    const units = await writeOffBatch(owner, b.id);
    expect(units).toBe(b.quantity);
    expect((await batch("AUG-2305")).quantity).toBe(0);
    expect((await prod("Augmentin 625mg")).quantity).toBe(p.quantity - b.quantity);
    const mv = await db.select().from(inventoryMovements).where(eq(inventoryMovements.batchId, b.id));
    expect(mv.some((m) => m.reason === "expired" && m.delta === -b.quantity)).toBe(true);
    await expect(writeOffBatch(owner, b.id)).rejects.toThrow(/Nothing left/);
  });
});

describe("receiving purchases into batches", () => {
  let brufen: typeof products.$inferSelect; let supplierId: string;
  beforeAll(async () => { brufen = await prod("Brufen 400mg"); supplierId = brufen.supplierId!; });
  const future = (d: number) => addDays(zonedParts(new Date(), "Asia/Karachi").date, d);

  it("requires a batch number and a future expiry date", async () => {
    await expect(createPurchase(owner, { supplierId, items: [{ productId: brufen.id, quantity: 5, unitCost: 40 }] })).rejects.toThrow(/Batch number is required/);
    await expect(createPurchase(owner, { supplierId, items: [{ productId: brufen.id, quantity: 5, unitCost: 40, batchNo: "OLD-1", expiryDate: future(-1) }] })).rejects.toThrow(/already expired/);
  });
  it("orders by the box, then receiving adds base units to a new batch at per-unit cost", async () => {
    const before = (await prod("Brufen 400mg")).quantity;
    const id = await createPurchase(owner, { supplierId, items: [{ productId: brufen.id, quantity: 5, unitCost: 40, packs: true, batchNo: "BRU-NEW", expiryDate: future(365) }] });
    await receivePurchase(owner, id);
    expect((await prod("Brufen 400mg")).quantity).toBe(before + 50);
    const b = await batch("BRU-NEW");
    expect(b.quantity).toBe(50);
    expect(b.costPrice).toBe("4.00");
    expect((await prod("Brufen 400mg")).costPrice).toBe("4.00");
    await expect(receivePurchase(owner, id)).rejects.toThrow(/already/);
  });
  it("receiving the same batch again tops it up instead of duplicating it", async () => {
    const id = await createPurchase(owner, { supplierId, items: [{ productId: brufen.id, quantity: 2, unitCost: 40, packs: true, batchNo: "BRU-NEW", expiryDate: future(365) }] });
    await receivePurchase(owner, id);
    expect((await batch("BRU-NEW")).quantity).toBe(70);
    const all = await db.select().from(productBatches).where(and(eq(productBatches.productId, brufen.id), eq(productBatches.batchNo, "BRU-NEW")));
    expect(all).toHaveLength(1);
  });
});

describe("manual stock changes need a batch", () => {
  it("removing stock requires choosing a batch and cannot exceed it", async () => {
    const p = await prod("Vitamin C 500mg"); const b = (await listBatches(owner, p.id))[0];
    await expect(adjustStock(owner, p.id, -5, "damage")).rejects.toThrow(/Choose which batch/);
    await expect(adjustStock(owner, p.id, -(b.quantity + 1), "damage", "x", { batchId: b.id })).rejects.toThrow(/fewer units/);
    await adjustStock(owner, p.id, -5, "damage", "broken bottle", { batchId: b.id });
    expect((await batch(b.batchNo)).quantity).toBe(b.quantity - 5);
    expect((await prod("Vitamin C 500mg")).quantity).toBe(p.quantity - 5);
  });
  it("adding stock requires batch details (or an existing batch)", async () => {
    const p = await prod("Vitamin C 500mg"); const b = (await listBatches(owner, p.id))[0];
    await expect(adjustStock(owner, p.id, 10, "adjustment")).rejects.toThrow(/Batch number is required/);
    await adjustStock(owner, p.id, 10, "adjustment", "count correction", { batchId: b.id });
    expect((await prod("Vitamin C 500mg")).quantity).toBe(p.quantity + 10);
  });
  it("opening stock for a new medicine must carry batch + expiry and lands in a batch", async () => {
    await expect(saveProduct(owner, { name: "Test Med", sellPrice: 10, costPrice: 5, initialQuantity: 20 })).rejects.toThrow(/Batch number is required/);
    const id = await saveProduct(owner, { name: "Test Med", genericName: "Testamol", strength: "10 mg", sellPrice: 10, costPrice: 5, initialQuantity: 20, batchNo: "TM-1", openingExpiry: addDays(zonedParts(new Date(), "Asia/Karachi").date, 100) });
    const bs = await listBatches(owner, id);
    expect(bs).toHaveLength(1); expect(bs[0].quantity).toBe(20);
    expect((await db.select().from(products).where(eq(products.id, id)))[0].quantity).toBe(20);
  });
});

describe("pharmacist role and isolation", () => {
  it("pharmacist can dispense and manage stock but not settings, team, salaries or staff", async () => {
    expect(pharmacist.role).toBe("pharmacist");
    for (const p of ["pos.use", "inventory.manage", "suppliers.manage", "reports.view"]) expect(pharmacist.perms.has(p)).toBe(true);
    for (const p of ["settings.manage", "members.manage", "staff.salary", "staff.manage"]) expect(pharmacist.perms.has(p)).toBe(false);
    const p = await prod("Panadol 500mg");
    await expect(sellCredit(pharmacist, p.id, 1)).resolves.toBeTruthy();
    await expect(saveStaff(pharmacist, { name: "X", schedule: defaultWeek() })).rejects.toThrow();
  });
  it("another business can neither sell, write off nor list this pharmacy's batches", async () => {
    const p = await prod("Panadol 500mg"); const b = await batch("PAN-2409");
    await expect(sellCredit(royal, p.id, 1)).rejects.toThrow(/not found/i);
    await expect(writeOffBatch(royal, b.id)).rejects.toThrow();
    expect(await listBatches(royal, p.id)).toEqual([]);
    expect((await batch("PAN-2409")).quantity).toBe(b.quantity);
  });
});
