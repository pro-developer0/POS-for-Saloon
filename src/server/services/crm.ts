import { and, desc, eq, ilike, or, sql, asc } from "drizzle-orm";
import { z } from "zod";
import { customers, services, serviceCategories, staff, staffServices, staffTimeOff, appointments, transactions } from "@/db/schema";
import { AppError, audit, need, needModule, type Ctx } from "../ctx";
import type { WeekHours } from "@/db/schema";

const emptyToNull = (v: unknown) => (v === "" ? null : v);
const opt = (s: z.ZodTypeAny) => z.preprocess(emptyToNull, s.nullable().optional());

// ---------------- Customers ----------------
export const customerSchema = z.object({
  name: z.string().trim().min(1).max(120),
  phone: opt(z.string().trim().max(40)),
  email: opt(z.string().trim().email().max(200)),
  birthday: opt(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)),
  address: opt(z.string().max(300)),
  notes: opt(z.string().max(2000)),
  preferences: opt(z.string().max(1000)),
  tags: z.array(z.string().trim().min(1).max(30)).max(20).default([]),
  marketingConsent: z.boolean().default(false),
  creditLimit: z.preprocess(emptyToNull, z.coerce.number().min(0).max(100_000_000).transform((n) => n.toFixed(2)).nullable().optional()), // blank = no limit
});

export async function listCustomers(ctx: Ctx, o: { q?: string; tag?: string; archived?: boolean } = {}) {
  need(ctx, "customers.view");
  const conds = [eq(customers.tenantId, ctx.tenantId), eq(customers.archived, !!o.archived)];
  if (o.q) { const like = `%${o.q}%`; conds.push(or(ilike(customers.name, like), ilike(customers.phone, like), ilike(customers.email, like))!); }
  if (o.tag) conds.push(sql`${customers.tags} @> ${JSON.stringify([o.tag])}::jsonb`);
  return ctx.db.select({
    c: customers,
    lastVisit: sql<Date | null>`(select max(a.starts_at) from appointments a where a.customer_id = ${customers.id} and a.tenant_id = ${ctx.tenantId} and a.status = 'completed')`,
    nextAppt: sql<Date | null>`(select min(a.starts_at) from appointments a where a.customer_id = ${customers.id} and a.tenant_id = ${ctx.tenantId} and a.starts_at > now() and a.status in ('pending','confirmed'))`,
    spent: sql<string>`coalesce((select sum(t.paid) from transactions t where t.customer_id = ${customers.id} and t.tenant_id = ${ctx.tenantId} and t.status <> 'cancelled'),0)`,
    balance: sql<string>`greatest(0, coalesce((select sum(t.total - t.paid) from transactions t where t.customer_id = ${customers.id} and t.tenant_id = ${ctx.tenantId} and t.status <> 'cancelled'),0))`,
  }).from(customers).where(and(...conds)).orderBy(asc(customers.name)).limit(500);
}

export async function createCustomer(ctx: Ctx, raw: unknown) {
  need(ctx, "customers.manage");
  const v = customerSchema.parse(raw);
  const [c] = await ctx.db.insert(customers).values({ ...v, tenantId: ctx.tenantId } as never).returning();
  await audit(ctx, "customer.create", "customer", c.id);
  return c;
}
export async function updateCustomer(ctx: Ctx, id: string, raw: unknown) {
  need(ctx, "customers.manage");
  const v = customerSchema.parse(raw);
  const [c] = await ctx.db.update(customers).set(v as never).where(and(eq(customers.id, id), eq(customers.tenantId, ctx.tenantId))).returning();
  if (!c) throw new AppError("Customer not found", "not_found");
  return c;
}
export async function archiveCustomer(ctx: Ctx, id: string, archived = true) {
  need(ctx, "customers.manage");
  const r = await ctx.db.update(customers).set({ archived }).where(and(eq(customers.id, id), eq(customers.tenantId, ctx.tenantId))).returning({ id: customers.id });
  if (!r.length) throw new AppError("Customer not found", "not_found");
}
export async function adjustLoyalty(ctx: Ctx, id: string, delta: number) {
  need(ctx, "customers.manage");
  if (!Number.isInteger(delta)) throw new AppError("Points must be a whole number");
  const r = await ctx.db.update(customers).set({ loyaltyPoints: sql`greatest(0, ${customers.loyaltyPoints} + ${delta})` })
    .where(and(eq(customers.id, id), eq(customers.tenantId, ctx.tenantId))).returning({ id: customers.id });
  if (!r.length) throw new AppError("Customer not found", "not_found");
  await audit(ctx, "customer.loyalty", "customer", id, { delta });
}

export async function getCustomerProfile(ctx: Ctx, id: string) {
  need(ctx, "customers.view");
  const [c] = await ctx.db.select().from(customers).where(and(eq(customers.id, id), eq(customers.tenantId, ctx.tenantId)));
  if (!c) throw new AppError("Customer not found", "not_found");
  const appts = await ctx.db.select({ a: appointments, serviceName: services.name, staffName: staff.name })
    .from(appointments).innerJoin(services, eq(services.id, appointments.serviceId)).innerJoin(staff, eq(staff.id, appointments.staffId))
    .where(and(eq(appointments.customerId, id), eq(appointments.tenantId, ctx.tenantId))).orderBy(desc(appointments.startsAt)).limit(100);
  const sales = await ctx.db.select().from(transactions)
    .where(and(eq(transactions.customerId, id), eq(transactions.tenantId, ctx.tenantId))).orderBy(desc(transactions.createdAt)).limit(100);
  return { customer: c, appointments: appts, sales };
}

// ---------------- Services ----------------
export const serviceSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: opt(z.string().max(1000)),
  categoryId: opt(z.string().uuid()),
  durationMinutes: z.coerce.number().int().min(5).max(720),
  price: z.coerce.number().min(0).max(1_000_000).transform((n) => n.toFixed(2)),
  taxable: z.boolean().default(true),
  commissionPct: z.coerce.number().min(0).max(100).transform((n) => n.toFixed(2)).default("0"),
  bookable: z.boolean().default(true),
  active: z.boolean().default(true),
  staffIds: z.array(z.string().uuid()).default([]),
});

async function assertOwnedStaff(ctx: Ctx, ids: string[]) {
  if (!ids.length) return;
  const rows = await ctx.db.select({ id: staff.id }).from(staff).where(and(eq(staff.tenantId, ctx.tenantId), sql`${staff.id} in ${ids}`));
  if (rows.length !== new Set(ids).size) throw new AppError("Invalid staff selection");
}
async function assertOwnedCategory(ctx: Ctx, id?: string | null) {
  if (!id) return;
  const [r] = await ctx.db.select({ id: serviceCategories.id }).from(serviceCategories).where(and(eq(serviceCategories.id, id), eq(serviceCategories.tenantId, ctx.tenantId)));
  if (!r) throw new AppError("Invalid category");
}

export async function listServices(ctx: Ctx, includeArchived = false) {
  need(ctx, "services.view");
  const rows = await ctx.db.select({ s: services, category: serviceCategories.name }).from(services)
    .leftJoin(serviceCategories, eq(serviceCategories.id, services.categoryId))
    .where(and(eq(services.tenantId, ctx.tenantId), includeArchived ? undefined : eq(services.archived, false))).orderBy(asc(services.sort), asc(services.name));
  const links = await ctx.db.select().from(staffServices).where(eq(staffServices.tenantId, ctx.tenantId));
  return rows.map((r) => ({ ...r, staffIds: links.filter((l) => l.serviceId === r.s.id).map((l) => l.staffId) }));
}

export async function saveService(ctx: Ctx, raw: unknown, id?: string) {
  needModule(ctx, "services");
  need(ctx, "services.manage");
  const { staffIds, ...v } = serviceSchema.parse(raw);
  await assertOwnedStaff(ctx, staffIds);
  await assertOwnedCategory(ctx, v.categoryId as string | null);
  return ctx.db.transaction(async (tx) => {
    let sid = id;
    if (id) {
      const r = await tx.update(services).set(v as never).where(and(eq(services.id, id), eq(services.tenantId, ctx.tenantId))).returning({ id: services.id });
      if (!r.length) throw new AppError("Service not found", "not_found");
    } else {
      const [s] = await tx.insert(services).values({ ...v, tenantId: ctx.tenantId } as never).returning();
      sid = s.id;
    }
    await tx.delete(staffServices).where(and(eq(staffServices.serviceId, sid!), eq(staffServices.tenantId, ctx.tenantId)));
    if (staffIds.length) await tx.insert(staffServices).values(staffIds.map((staffId) => ({ staffId, serviceId: sid!, tenantId: ctx.tenantId })));
    return sid!;
  });
}
export async function archiveService(ctx: Ctx, id: string, archived = true) {
  need(ctx, "services.manage");
  await ctx.db.update(services).set({ archived, active: !archived }).where(and(eq(services.id, id), eq(services.tenantId, ctx.tenantId)));
}
export async function moveService(ctx: Ctx, id: string, dir: -1 | 1) {
  need(ctx, "services.manage");
  const list = await ctx.db.select({ id: services.id }).from(services).where(and(eq(services.tenantId, ctx.tenantId), eq(services.archived, false))).orderBy(asc(services.sort), asc(services.name));
  const i = list.findIndex((s) => s.id === id), j = i + dir;
  if (i < 0 || j < 0 || j >= list.length) return;
  [list[i], list[j]] = [list[j], list[i]];
  for (let k = 0; k < list.length; k++) await ctx.db.update(services).set({ sort: k }).where(and(eq(services.id, list[k].id), eq(services.tenantId, ctx.tenantId)));
}
export async function saveCategory(ctx: Ctx, name: string) {
  need(ctx, "services.manage");
  const n = z.string().trim().min(1).max(60).parse(name);
  const [c] = await ctx.db.insert(serviceCategories).values({ tenantId: ctx.tenantId, name: n }).returning();
  return c;
}
export async function listCategories(ctx: Ctx) {
  return ctx.db.select().from(serviceCategories).where(eq(serviceCategories.tenantId, ctx.tenantId)).orderBy(asc(serviceCategories.sort), asc(serviceCategories.name));
}

// ---------------- Staff ----------------
const hoursDay = z.object({ open: z.string().regex(/^\d{2}:\d{2}$/), close: z.string().regex(/^\d{2}:\d{2}$/) }).nullable();
export const staffSchema = z.object({
  name: z.string().trim().min(1).max(120),
  phone: opt(z.string().max(40)), email: opt(z.string().email()), jobTitle: opt(z.string().max(80)),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default("#7c3aed"),
  commissionPct: z.coerce.number().min(0).max(100).transform((n) => n.toFixed(2)).default("0"),
  salary: z.preprocess(emptyToNull, z.coerce.number().min(0).transform((n) => n.toFixed(2)).nullable().optional()),
  schedule: z.record(z.enum(["0", "1", "2", "3", "4", "5", "6"]), hoursDay),
  breaks: z.array(z.object({ start: z.string().regex(/^\d{2}:\d{2}$/), end: z.string().regex(/^\d{2}:\d{2}$/) })).default([]),
  active: z.boolean().default(true),
  serviceIds: z.array(z.string().uuid()).default([]),
});

export async function listStaff(ctx: Ctx) {
  need(ctx, "staff.view");
  const rows = await ctx.db.select().from(staff).where(eq(staff.tenantId, ctx.tenantId)).orderBy(asc(staff.name));
  const links = await ctx.db.select().from(staffServices).where(eq(staffServices.tenantId, ctx.tenantId));
  const canSalary = ctx.perms.has("staff.salary");
  return rows.map((s) => ({ ...s, salary: canSalary ? s.salary : null, serviceIds: links.filter((l) => l.staffId === s.id).map((l) => l.serviceId) }));
}

export async function saveStaff(ctx: Ctx, raw: unknown, id?: string) {
  needModule(ctx, "staff");
  need(ctx, "staff.manage");
  const { serviceIds, salary, ...v } = staffSchema.parse(raw);
  if (serviceIds.length) {
    const rows = await ctx.db.select({ id: services.id }).from(services).where(and(eq(services.tenantId, ctx.tenantId), sql`${services.id} in ${serviceIds}`));
    if (rows.length !== new Set(serviceIds).size) throw new AppError("Invalid service selection");
  }
  const values = { ...v, schedule: v.schedule as WeekHours, ...(ctx.perms.has("staff.salary") ? { salary: salary ?? null } : {}) };
  return ctx.db.transaction(async (tx) => {
    let sid = id;
    if (id) {
      const r = await tx.update(staff).set(values as never).where(and(eq(staff.id, id), eq(staff.tenantId, ctx.tenantId))).returning({ id: staff.id });
      if (!r.length) throw new AppError("Staff member not found", "not_found");
    } else {
      const [s] = await tx.insert(staff).values({ ...values, tenantId: ctx.tenantId } as never).returning();
      sid = s.id;
    }
    await tx.delete(staffServices).where(and(eq(staffServices.staffId, sid!), eq(staffServices.tenantId, ctx.tenantId)));
    if (serviceIds.length) await tx.insert(staffServices).values(serviceIds.map((serviceId) => ({ staffId: sid!, serviceId, tenantId: ctx.tenantId })));
    return sid!;
  });
}

export async function addTimeOff(ctx: Ctx, staffId: string, startsAt: Date, endsAt: Date, reason?: string) {
  need(ctx, "staff.manage");
  if (endsAt <= startsAt) throw new AppError("End must be after start");
  const [s] = await ctx.db.select({ id: staff.id }).from(staff).where(and(eq(staff.id, staffId), eq(staff.tenantId, ctx.tenantId)));
  if (!s) throw new AppError("Staff member not found", "not_found");
  await ctx.db.insert(staffTimeOff).values({ tenantId: ctx.tenantId, staffId, startsAt, endsAt, reason });
}
export async function listTimeOff(ctx: Ctx) {
  need(ctx, "staff.view");
  return ctx.db.select({ t: staffTimeOff, staffName: staff.name }).from(staffTimeOff).innerJoin(staff, eq(staff.id, staffTimeOff.staffId))
    .where(and(eq(staffTimeOff.tenantId, ctx.tenantId), sql`${staffTimeOff.endsAt} > now()`)).orderBy(asc(staffTimeOff.startsAt));
}
export async function deleteTimeOff(ctx: Ctx, id: string) {
  need(ctx, "staff.manage");
  await ctx.db.delete(staffTimeOff).where(and(eq(staffTimeOff.id, id), eq(staffTimeOff.tenantId, ctx.tenantId)));
}
