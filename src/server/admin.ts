import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { DB } from "@/db/client";
import { auditLogs, memberships, users } from "@/db/schema";
import { AppError } from "./ctx";
import { createTenant, passwordSchema } from "./auth";
import { VERTICALS } from "@/lib/verticals";

/** Readable temporary password (no look-alike characters), ~64 bits of entropy. Shown once, never stored in plain text. */
export function temporaryPassword() {
  const alphabet = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.randomBytes(12);
  const body = Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
  return `${body.slice(0, 4)}-${body.slice(4, 8)}-${body.slice(8)}7`; // trailing digit guarantees "letters and numbers"
}

async function adminLog(db: DB, adminId: string, action: string, tenantId?: string | null, detail?: unknown) {
  await db.insert(auditLogs).values({ tenantId: tenantId ?? null, userId: adminId, action, entity: "admin", detail: (detail ?? null) as never });
}

export const createBusinessSchema = z.object({
  businessName: z.string().trim().min(2).max(120),
  businessType: z.string().refine((t) => t in VERTICALS, "Choose a business type"),
  ownerName: z.string().trim().min(2).max(100),
  ownerEmail: z.string().trim().toLowerCase().email().max(200),
  password: z.string().max(200).optional().nullable(),
  currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/).default("PKR"),
  timezone: z.string().default("Asia/Karachi"),
});

/**
 * Super-admin creates a client's business + owner login. The owner finishes onboarding (branding, hours, ...) on first login.
 * If the email already has an account, that user simply becomes owner of the new business (their password is untouched).
 */
export async function createBusinessWithOwner(db: DB, adminId: string, raw: unknown) {
  const v = createBusinessSchema.parse(raw);
  try { new Intl.DateTimeFormat("en", { timeZone: v.timezone }); } catch { throw new AppError("Unknown timezone"); }
  const typed = v.password?.trim();
  if (typed) { const r = passwordSchema.safeParse(typed); if (!r.success) throw new AppError(r.error.issues[0].message); }
  return db.transaction(async (tx) => {
    const d = tx as unknown as DB;
    const [existing] = await tx.select().from(users).where(eq(users.email, v.ownerEmail));
    let userId = existing?.id; let tempPassword: string | null = null;
    if (!existing) {
      tempPassword = typed || temporaryPassword();
      const [u] = await tx.insert(users).values({ email: v.ownerEmail, name: v.ownerName, passwordHash: await bcrypt.hash(tempPassword, 11), emailVerifiedAt: new Date(), mustChangePassword: true }).returning();
      userId = u.id;
    } else if (existing.disabled) throw new AppError("That account is disabled. Enable it first.");
    const t = await createTenant(d, { name: v.businessName, type: v.businessType, currency: v.currency, timezone: v.timezone });
    await tx.insert(memberships).values({ userId: userId!, tenantId: t.id, role: "owner" });
    await adminLog(d, adminId, "admin.business.create", t.id, { owner: v.ownerEmail, type: v.businessType, newUser: !existing });
    return { tenantId: t.id, name: t.name, ownerEmail: v.ownerEmail, tempPassword, existingUser: !!existing };
  });
}

/** Issues a new temporary password, signs the user out everywhere and forces a change at next login. */
export async function resetUserPassword(db: DB, adminId: string, userId: string) {
  const [u] = await db.select().from(users).where(eq(users.id, userId));
  if (!u) throw new AppError("User not found", "not_found");
  if (u.isPlatformAdmin && u.id !== adminId) throw new AppError("Other platform admins reset their own password.", "forbidden");
  const temp = temporaryPassword();
  await db.update(users).set({ passwordHash: await bcrypt.hash(temp, 11), mustChangePassword: true, failedLogins: 0, lockedUntil: null, tokensValidAfter: new Date() }).where(eq(users.id, userId));
  await adminLog(db, adminId, "admin.user.reset_password", null, { userId });
  return { email: u.email, tempPassword: temp };
}

export async function setUserDisabled(db: DB, adminId: string, userId: string, disabled: boolean) {
  if (userId === adminId) throw new AppError("You cannot disable your own account.");
  const [u] = await db.select().from(users).where(eq(users.id, userId));
  if (!u) throw new AppError("User not found", "not_found");
  if (u.isPlatformAdmin) throw new AppError("Platform admins cannot be disabled here.", "forbidden");
  await db.update(users).set({ disabled, ...(disabled ? { tokensValidAfter: new Date() } : {}) }).where(eq(users.id, userId));
  await adminLog(db, adminId, disabled ? "admin.user.disable" : "admin.user.enable", null, { userId });
}

export async function listUsersForAdmin(db: DB, q?: string) {
  const rows = await db.execute<{ id: string; name: string; email: string; disabled: boolean; is_admin: boolean; must_change: boolean; created_at: Date; biz: string | null }>(sql`
    select u.id, u.name, u.email, u.disabled, u.is_platform_admin is_admin, u.must_change_password must_change, u.created_at,
      (select string_agg(t.name || ' (' || m.role || ')', ', ' order by t.name) from memberships m join tenants t on t.id = m.tenant_id where m.user_id = u.id and m.active) biz
    from users u ${q ? sql`where u.email ilike ${"%" + q + "%"} or u.name ilike ${"%" + q + "%"}` : sql``} order by u.created_at desc limit 200`);
  return rows.rows;
}

/** User changes their own password (needs the current one). Clears the forced-change flag and signs out other sessions. */
export async function changeOwnPassword(db: DB, userId: string, current: string, next: string) {
  const parsed = passwordSchema.safeParse(next);
  if (!parsed.success) throw new AppError(parsed.error.issues[0].message);
  const [u] = await db.select().from(users).where(eq(users.id, userId));
  if (!u) throw new AppError("User not found", "not_found");
  if (!(await bcrypt.compare(current, u.passwordHash))) throw new AppError("Current password is incorrect.");
  if (current === next) throw new AppError("Choose a password different from the current one.");
  await db.update(users).set({ passwordHash: await bcrypt.hash(parsed.data, 11), mustChangePassword: false, tokensValidAfter: new Date() }).where(eq(users.id, userId));
}
export { desc, and };
