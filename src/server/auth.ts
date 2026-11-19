import bcrypt from "bcryptjs";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { DB } from "@/db/client";
import { memberships, tenants, users, staff, serviceCategories, services } from "@/db/schema";
import { defaultWeek } from "@/lib/time";
import { AppError } from "./ctx";

export const passwordSchema = z.string().min(10, "Password must be at least 10 characters").max(200)
  .refine((p) => /[a-z]/i.test(p) && /\d/.test(p), "Password needs letters and numbers");

export const registerSchema = z.object({
  name: z.string().trim().min(2).max(100),
  email: z.string().trim().toLowerCase().email().max(200),
  password: passwordSchema,
  businessName: z.string().trim().min(2).max(120),
  businessType: z.string().trim().default("hair_salon"),
});

const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "business";

export const BUSINESS_TYPES = ["hair_salon", "beauty_salon", "barbershop", "spa", "nail_studio", "makeup_studio", "hair_clinic", "other"] as const;

export async function createTenant(db: DB, input: { name: string; type?: string; currency?: string; timezone?: string; country?: string; isDemo?: boolean }) {
  const base = slugify(input.name);
  let slug = base;
  for (let i = 2; ; i++) {
    const [ex] = await db.select({ id: tenants.id }).from(tenants).where(eq(tenants.slug, slug));
    if (!ex) break;
    slug = `${base}-${i}`;
  }
  const [t] = await db.insert(tenants).values({
    name: input.name, slug, businessType: input.type ?? "hair_salon",
    currency: input.currency ?? "USD", timezone: input.timezone ?? "UTC", country: input.country ?? "US",
    hours: defaultWeek(), status: "active", isDemo: !!input.isDemo,
  }).returning();
  return t;
}

export async function registerOwner(db: DB, raw: unknown) {
  const v = registerSchema.parse(raw);
  const [exists] = await db.select({ id: users.id }).from(users).where(eq(users.email, v.email));
  if (exists) throw new AppError("An account with this email already exists.", "conflict");
  const passwordHash = await bcrypt.hash(v.password, 11);
  return db.transaction(async (tx) => {
    const [u] = await tx.insert(users).values({ email: v.email, name: v.name, passwordHash }).returning();
    const t = await createTenant(tx as unknown as DB, { name: v.businessName, type: v.businessType });
    await tx.insert(memberships).values({ userId: u.id, tenantId: t.id, role: "owner" });
    return { user: u, tenant: t };
  });
}

const MAX_FAILS = 5;
export async function verifyLogin(db: DB, emailRaw: string, password: string) {
  const email = emailRaw.trim().toLowerCase();
  const [u] = await db.select().from(users).where(eq(users.email, email));
  const fail = () => new AppError("Invalid email or password.", "unauthorized");
  if (!u) { await bcrypt.compare(password, "$2a$11$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidi"); throw fail(); }
  if (u.lockedUntil && u.lockedUntil > new Date()) throw new AppError("Too many attempts. Try again in a few minutes.", "unauthorized");
  if (u.disabled) throw new AppError("This account is disabled.", "unauthorized");
  const ok = await bcrypt.compare(password, u.passwordHash);
  if (!ok) {
    const n = u.failedLogins + 1;
    await db.update(users).set({ failedLogins: n, lockedUntil: n >= MAX_FAILS ? new Date(Date.now() + 10 * 60_000) : null }).where(eq(users.id, u.id));
    throw fail();
  }
  if (u.failedLogins) await db.update(users).set({ failedLogins: 0, lockedUntil: null }).where(eq(users.id, u.id));
  return u;
}

export async function listMemberships(db: DB, userId: string) {
  return db.select({ tenantId: tenants.id, name: tenants.name, role: memberships.role, status: tenants.status, brandColor: tenants.brandColor, logoUrl: tenants.logoUrl })
    .from(memberships).innerJoin(tenants, eq(tenants.id, memberships.tenantId))
    .where(sql`${memberships.userId} = ${userId} and ${memberships.active} = true`);
}

/** Seeds starter catalog/staff during onboarding. Tenant-scoped by construction. */
export async function seedStarter(db: DB, tenantId: string, ownerName: string) {
  const [cat] = await db.insert(serviceCategories).values({ tenantId, name: "General" }).returning();
  await db.insert(services).values([
    { tenantId, categoryId: cat.id, name: "Haircut", durationMinutes: 30, price: "20.00" },
  ]);
  await db.insert(staff).values({ tenantId, name: ownerName, schedule: defaultWeek(), jobTitle: "Owner" });
}
