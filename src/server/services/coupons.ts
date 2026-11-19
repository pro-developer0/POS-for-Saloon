import { and, asc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { DB } from "@/db/client";
import { coupons } from "@/db/schema";
import { AppError, audit, need, type Ctx } from "../ctx";
import { fromCents, pctOf, toCents } from "@/lib/money";
import { todayLocal } from "./batches";

const emptyToNull = (v: unknown) => (v === "" ? null : v);
export const couponSchema = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9_-]{3,30}$/, "Code: 3–30 letters, numbers, - or _"),
  description: z.preprocess(emptyToNull, z.string().trim().max(120).nullable().optional()),
  type: z.enum(["percent", "fixed"]),
  value: z.coerce.number().positive().max(10_000_000),
  minSubtotal: z.coerce.number().min(0).max(10_000_000).default(0),
  maxUses: z.preprocess(emptyToNull, z.coerce.number().int().min(1).max(1_000_000).nullable().optional()),
  expiresOn: z.preprocess(emptyToNull, z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional()),
  active: z.boolean().default(true),
}).refine((c) => c.type !== "percent" || c.value <= 100, { message: "Percent discount cannot exceed 100", path: ["value"] });

export async function saveCoupon(ctx: Ctx, raw: unknown, id?: string) {
  need(ctx, "coupons.manage");
  const v = couponSchema.parse(raw);
  const values = { code: v.code, description: v.description ?? null, type: v.type, value: v.value.toFixed(2), minSubtotal: v.minSubtotal.toFixed(2), maxUses: v.maxUses ?? null, expiresOn: v.expiresOn ?? null, active: v.active };
  try {
    if (id) {
      const r = await ctx.db.update(coupons).set(values).where(and(eq(coupons.id, id), eq(coupons.tenantId, ctx.tenantId))).returning({ id: coupons.id });
      if (!r.length) throw new AppError("Coupon not found", "not_found");
      return id;
    }
    const [c] = await ctx.db.insert(coupons).values({ ...values, tenantId: ctx.tenantId }).returning({ id: coupons.id });
    await audit(ctx, "coupon.create", "coupon", c.id, { code: v.code });
    return c.id;
  } catch (e) {
    if (String((e as Error).message + String((e as { cause?: Error }).cause?.message)).includes("coupons_code_uq")) throw new AppError("A coupon with this code already exists.", "conflict");
    throw e;
  }
}
export async function setCouponActive(ctx: Ctx, id: string, active: boolean) {
  need(ctx, "coupons.manage");
  await ctx.db.update(coupons).set({ active }).where(and(eq(coupons.id, id), eq(coupons.tenantId, ctx.tenantId)));
}
export async function listCoupons(ctx: Ctx) {
  need(ctx, "coupons.manage");
  return ctx.db.select().from(coupons).where(eq(coupons.tenantId, ctx.tenantId)).orderBy(asc(coupons.code));
}

/** Validates a coupon against a subtotal (cents) and returns the discount. Server-side only; nothing is trusted from the browser. */
export async function evaluateCoupon(db: DB, ctx: Pick<Ctx, "tenantId" | "tenant">, codeRaw: string, subtotalCents: number) {
  const code = codeRaw.trim().toUpperCase();
  const [c] = await db.select().from(coupons).where(and(eq(coupons.tenantId, ctx.tenantId), eq(coupons.code, code)));
  if (!c || !c.active) throw new AppError("This coupon code is not valid.");
  if (c.expiresOn && c.expiresOn < todayLocal(ctx)) throw new AppError("This coupon has expired.");
  if (c.maxUses !== null && c.usedCount >= c.maxUses) throw new AppError("This coupon has been used the maximum number of times.");
  if (subtotalCents < toCents(c.minSubtotal)) throw new AppError(`This coupon needs a minimum purchase of ${c.minSubtotal}.`);
  const raw = c.type === "percent" ? pctOf(subtotalCents, c.value) : toCents(c.value);
  return { coupon: c, discountCents: Math.min(raw, subtotalCents) };
}

export async function previewCoupon(ctx: Ctx, code: string, subtotalCents: number) {
  need(ctx, "pos.use");
  const r = await evaluateCoupon(ctx.db, ctx, code, Math.max(0, Math.round(subtotalCents)));
  return { code: r.coupon.code, discount: fromCents(r.discountCents), label: r.coupon.type === "percent" ? `${Number(r.coupon.value)}% off` : "Fixed discount" };
}

/** Atomically uses one redemption; fails if the last use was just taken by someone else. */
export async function consumeCoupon(db: DB, tenantId: string, couponId: string) {
  const r = await db.update(coupons).set({ usedCount: sql`${coupons.usedCount} + 1` })
    .where(and(eq(coupons.id, couponId), eq(coupons.tenantId, tenantId), sql`(${coupons.maxUses} is null or ${coupons.usedCount} < ${coupons.maxUses})`)).returning({ id: coupons.id });
  if (!r.length) throw new AppError("This coupon has just been used up.", "conflict");
}
export async function releaseCoupon(db: DB, tenantId: string, code: string) {
  await db.update(coupons).set({ usedCount: sql`greatest(0, ${coupons.usedCount} - 1)` }).where(and(eq(coupons.tenantId, tenantId), eq(coupons.code, code)));
}
