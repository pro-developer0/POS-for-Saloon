import { asc, eq, and } from "drizzle-orm";
import { customers, services, staff, staffServices } from "@/db/schema";
import type { Ctx } from "@/server/ctx";

/** Option lists for forms (tenant-scoped). */
export async function bookingOptions(ctx: Ctx) {
  const [c, s, st, links] = await Promise.all([
    ctx.db.select({ id: customers.id, name: customers.name, phone: customers.phone }).from(customers).where(and(eq(customers.tenantId, ctx.tenantId), eq(customers.archived, false))).orderBy(asc(customers.name)),
    ctx.db.select().from(services).where(and(eq(services.tenantId, ctx.tenantId), eq(services.active, true), eq(services.archived, false), eq(services.bookable, true))).orderBy(asc(services.name)),
    ctx.db.select().from(staff).where(and(eq(staff.tenantId, ctx.tenantId), eq(staff.active, true))).orderBy(asc(staff.name)),
    ctx.db.select().from(staffServices).where(eq(staffServices.tenantId, ctx.tenantId)),
  ]);
  return {
    customers: c.map((x) => ({ id: x.id, name: x.name, extra: x.phone ?? undefined })),
    services: s.map((x) => ({ id: x.id, name: x.name, minutes: x.durationMinutes, price: x.price, staffIds: links.filter((l) => l.serviceId === x.id).map((l) => l.staffId) })),
    staff: st.map((x) => ({ id: x.id, name: x.name })),
  };
}
