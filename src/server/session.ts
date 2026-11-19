import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SignJWT, jwtVerify } from "jose";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { users, memberships } from "@/db/schema";
import { buildCtx, AppError, need, type Ctx } from "./ctx";
import { sessionStillValid } from "./tokens";
import { hasModule, type Module } from "@/lib/verticals";

const COOKIE = "sp_session";
const TENANT_COOKIE = "sp_tenant";

function secret() {
  const s = process.env.AUTH_SECRET;
  if (!s || s.length < 32) {
    if (process.env.NODE_ENV === "production") throw new Error("AUTH_SECRET must be set (>= 32 chars) in production");
    return new TextEncoder().encode("dev-only-insecure-secret-change-me-please-0123456789");
  }
  return new TextEncoder().encode(s);
}

export async function createSession(userId: string) {
  const token = await new SignJWT({}).setProtectedHeader({ alg: "HS256" }).setSubject(userId)
    .setIssuedAt().setExpirationTime("7d").sign(secret());
  (await cookies()).set(COOKIE, token, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 7 * 86400 });
}
export async function destroySession() {
  const c = await cookies();
  c.delete(COOKIE); c.delete(TENANT_COOKIE);
}
export async function setActiveTenant(tenantId: string) {
  (await cookies()).set(TENANT_COOKIE, tenantId, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 30 * 86400 });
}

export async function getUser() {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret());
    const d = await db();
    const [u] = await d.select().from(users).where(eq(users.id, String(payload.sub)));
    if (!u || u.disabled || !sessionStillValid(payload.iat, u.tokensValidAfter)) return null;
    return u;
  } catch { return null; }
}

export async function requireUser() {
  const u = await getUser();
  if (!u) redirect("/login");
  return u;
}

/** Resolves the tenant workspace from the cookie, but ONLY if the user holds an active membership. */
export async function requireCtx(perm?: string, module?: Module): Promise<Ctx> {
  const user = await requireUser();
  if (user.mustChangePassword) redirect("/account"); // temporary password issued by an admin: choose your own first
  const d = await db();
  const wanted = (await cookies()).get(TENANT_COOKIE)?.value;
  let ctx: Ctx | null = null;
  if (wanted) { try { ctx = await buildCtx(d, user.id, wanted); } catch { ctx = null; } }
  if (!ctx) {
    const ms = await d.select().from(memberships).where(eq(memberships.userId, user.id));
    for (const m of ms) { try { ctx = await buildCtx(d, user.id, m.tenantId); break; } catch { /* try next */ } }
  }
  if (!ctx) redirect(user.isPlatformAdmin ? "/admin" : "/register");
  if (!ctx.tenant.onboarded && perm !== "__onboarding") redirect("/onboarding");
  if (module && !hasModule(ctx.tenant, module)) redirect("/dashboard");
  if (perm && perm !== "__onboarding") {
    try { need(ctx, perm); } catch { redirect("/forbidden"); }
  }
  return ctx;
}

export async function requirePlatformAdmin() {
  const u = await requireUser();
  if (!u.isPlatformAdmin) throw new AppError("Platform admin only.", "forbidden");
  return u;
}
