import { and, eq } from "drizzle-orm";
import type { DB } from "@/db/client";
import { memberships, tenants, users } from "@/db/schema";
import { permissionsFor } from "@/lib/permissions";
import { hasModule, MODULE_INFO, type Module } from "@/lib/verticals";

export class AppError extends Error {
  constructor(message: string, public code: "validation" | "forbidden" | "not_found" | "conflict" | "unauthorized" = "validation") {
    super(message);
  }
}

export type Tenant = typeof tenants.$inferSelect;

/**
 * Request context. tenantId ALWAYS comes from a verified membership (buildCtx), never from client input.
 * Every tenant-owned query in src/server/services must filter by ctx.tenantId.
 */
export type Ctx = {
  db: DB; tenant: Tenant; tenantId: string; userId: string; role: string; perms: Set<string>;
};

export async function buildCtx(db: DB, userId: string, tenantId: string): Promise<Ctx> {
  const [row] = await db
    .select({ m: memberships, t: tenants, u: users })
    .from(memberships)
    .innerJoin(tenants, eq(tenants.id, memberships.tenantId))
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(and(eq(memberships.userId, userId), eq(memberships.tenantId, tenantId), eq(memberships.active, true)));
  if (!row || row.u.disabled) throw new AppError("You do not have access to this business.", "forbidden");
  if (row.t.status === "suspended") throw new AppError("This business is suspended. Contact support.", "forbidden");
  return { db, tenant: row.t, tenantId, userId, role: row.m.role, perms: permissionsFor(row.m.role, row.m.permissions) };
}

/** Server-side feature switch: throws if this business has the module turned off. */
export function needModule(ctx: Pick<Ctx, "tenant">, m: Module) {
  if (!hasModule(ctx.tenant, m)) throw new AppError(`${MODULE_INFO[m].label} is not enabled for this business.`, "forbidden");
}
export const can = (ctx: Ctx, p: string) => ctx.perms.has(p);
export function need(ctx: Ctx, p: string) {
  if (!ctx.perms.has(p)) throw new AppError(`Permission denied (${p}).`, "forbidden");
}

export async function audit(ctx: Pick<Ctx, "db" | "tenantId" | "userId">, action: string, entity?: string, entityId?: string, detail?: unknown) {
  const { auditLogs } = await import("@/db/schema");
  await ctx.db.insert(auditLogs).values({ tenantId: ctx.tenantId, userId: ctx.userId, action, entity, entityId, detail: (detail ?? null) as never });
}
