import { and, asc, eq, gt, lt, ne, notInArray, sql } from "drizzle-orm";
import { z } from "zod";
import { appointments, customers, services, staff, staffServices, staffTimeOff, notifications } from "@/db/schema";
import { AppError, audit, need, needModule, type Ctx } from "../ctx";
import { addDays, hm, minToHm, zonedParts, zonedToUtc } from "@/lib/time";
import { toCents, fromCents, pctOf } from "@/lib/money";

export const APPT_STATUSES = ["pending", "confirmed", "checked_in", "in_progress", "completed", "cancelled", "no_show"] as const;
const INACTIVE = ["cancelled", "no_show"];

const TRANSITIONS: Record<string, string[]> = {
  pending: ["confirmed", "checked_in", "cancelled", "no_show"],
  confirmed: ["checked_in", "in_progress", "cancelled", "no_show", "pending"],
  checked_in: ["in_progress", "completed", "cancelled", "no_show"],
  in_progress: ["completed", "cancelled"],
  completed: [],
  cancelled: ["pending"],
  no_show: ["pending"],
};

type Candidate = { staffId: string; serviceId: string; startsAt: Date; durationMinutes: number; excludeId?: string };

/**
 * The single source of truth for "can this slot be booked?". Returns an error string or null.
 * Used by manual booking, rescheduling, slot search and the AI assistant (which can never bypass it).
 */
export async function validateSlot(ctx: Ctx, c: Candidate): Promise<string | null> {
  const t = ctx.tenant;
  if (!Number.isInteger(c.durationMinutes) || c.durationMinutes < 5 || c.durationMinutes > 720) return "Invalid appointment duration.";
  const end = new Date(c.startsAt.getTime() + c.durationMinutes * 60_000);
  if (isNaN(c.startsAt.getTime())) return "Invalid start time.";

  const s = zonedParts(c.startsAt, t.timezone), e = zonedParts(end, t.timezone);
  if (s.date !== e.date && !(e.minutes === 0 && addDays(s.date, 1) === e.date)) return "Appointments cannot span multiple days.";
  const endMin = s.date === e.date ? e.minutes : 1440;
  if (t.slotMinutes > 0 && s.minutes % t.slotMinutes !== 0) return `Start time must align to ${t.slotMinutes}-minute slots.`;

  const day = t.hours[String(s.weekday) as keyof typeof t.hours];
  if (!day) return "The business is closed on this day.";
  if (s.minutes < hm(day.open) || endMin > hm(day.close)) return `Outside business hours (${day.open}–${day.close}).`;

  const [st] = await ctx.db.select().from(staff).where(and(eq(staff.id, c.staffId), eq(staff.tenantId, ctx.tenantId)));
  if (!st || !st.active) return "Staff member is not available.";
  const [svc] = await ctx.db.select().from(services).where(and(eq(services.id, c.serviceId), eq(services.tenantId, ctx.tenantId)));
  if (!svc || !svc.active || svc.archived || !svc.bookable) return "Service is not available for booking.";
  const links = await ctx.db.select().from(staffServices).where(and(eq(staffServices.staffId, c.staffId), eq(staffServices.tenantId, ctx.tenantId)));
  if (links.length && !links.some((l) => l.serviceId === c.serviceId)) return "This staff member does not perform that service.";

  const sday = st.schedule[String(s.weekday) as keyof typeof st.schedule];
  if (!sday) return `${st.name} does not work on this day.`;
  if (s.minutes < hm(sday.open) || endMin > hm(sday.close)) return `Outside ${st.name}'s working hours (${sday.open}–${sday.close}).`;
  for (const b of st.breaks) if (s.minutes < hm(b.end) && endMin > hm(b.start)) return `${st.name} is on break (${b.start}–${b.end}).`;

  const [off] = await ctx.db.select({ id: staffTimeOff.id }).from(staffTimeOff)
    .where(and(eq(staffTimeOff.staffId, c.staffId), eq(staffTimeOff.tenantId, ctx.tenantId), lt(staffTimeOff.startsAt, end), gt(staffTimeOff.endsAt, c.startsAt))).limit(1);
  if (off) return `${st.name} has time off during this period.`;

  const buf = t.bufferMinutes * 60_000;
  const conds = [
    eq(appointments.tenantId, ctx.tenantId), eq(appointments.staffId, c.staffId),
    notInArray(appointments.status, INACTIVE),
    lt(appointments.startsAt, new Date(end.getTime() + buf)), gt(appointments.endsAt, new Date(c.startsAt.getTime() - buf)),
  ];
  if (c.excludeId) conds.push(ne(appointments.id, c.excludeId));
  const [clash] = await ctx.db.select({ id: appointments.id }).from(appointments).where(and(...conds)).limit(1);
  if (clash) return `${st.name} already has an appointment that conflicts with this time.`;
  return null;
}

export const apptSchema = z.object({
  customerId: z.string().uuid(),
  serviceId: z.string().uuid(),
  staffId: z.string().uuid(),
  startsAt: z.coerce.date(),
  durationMinutes: z.coerce.number().int().optional(),
  price: z.coerce.number().min(0).optional(),
  discount: z.coerce.number().min(0).default(0),
  notes: z.string().max(1000).optional().nullable(),
  status: z.enum(APPT_STATUSES).default("confirmed"),
  source: z.enum(["staff", "online", "phone", "walk_in", "ai"]).default("staff"),
});

export async function createAppointment(ctx: Ctx, raw: unknown) {
  needModule(ctx, "appointments");
  need(ctx, "appointments.manage");
  const v = apptSchema.parse(raw);
  const [cust] = await ctx.db.select({ id: customers.id }).from(customers).where(and(eq(customers.id, v.customerId), eq(customers.tenantId, ctx.tenantId)));
  if (!cust) throw new AppError("Customer not found", "not_found");
  const [svc] = await ctx.db.select().from(services).where(and(eq(services.id, v.serviceId), eq(services.tenantId, ctx.tenantId)));
  if (!svc) throw new AppError("Service not found", "not_found");
  const duration = v.durationMinutes ?? svc.durationMinutes;
  const price = v.price !== undefined ? v.price.toFixed(2) : svc.price;
  if (toCents(v.discount.toFixed(2)) > toCents(price)) throw new AppError("Discount cannot exceed the price.");

  return ctx.db.transaction(async (tx) => {
    const tctx = { ...ctx, db: tx as unknown as Ctx["db"] };
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${v.staffId}))`); // serialize bookings per staff member
    const err = await validateSlot(tctx, { staffId: v.staffId, serviceId: v.serviceId, startsAt: v.startsAt, durationMinutes: duration });
    if (err) throw new AppError(err, "conflict");
    const [a] = await tx.insert(appointments).values({
      tenantId: ctx.tenantId, customerId: v.customerId, serviceId: v.serviceId, staffId: v.staffId,
      startsAt: v.startsAt, endsAt: new Date(v.startsAt.getTime() + duration * 60_000), durationMinutes: duration,
      price, discount: v.discount.toFixed(2), notes: v.notes ?? null, status: v.status, source: v.source, createdBy: ctx.userId,
    }).returning();
    await tx.insert(notifications).values({ tenantId: ctx.tenantId, kind: "appointment", title: "New appointment booked", body: `${svc.name}`, link: "/appointments" });
    await audit(tctx, "appointment.create", "appointment", a.id);
    return a;
  });
}

export async function rescheduleAppointment(ctx: Ctx, id: string, startsAt: Date, staffId?: string) {
  needModule(ctx, "appointments");
  need(ctx, "appointments.manage");
  return ctx.db.transaction(async (tx) => {
    const tctx = { ...ctx, db: tx as unknown as Ctx["db"] };
    const [a] = await tx.select().from(appointments).where(and(eq(appointments.id, id), eq(appointments.tenantId, ctx.tenantId)));
    if (!a) throw new AppError("Appointment not found", "not_found");
    if (["completed", "cancelled", "no_show"].includes(a.status)) throw new AppError("This appointment can no longer be changed.");
    const sid = staffId ?? a.staffId;
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${sid}))`);
    const err = await validateSlot(tctx, { staffId: sid, serviceId: a.serviceId, startsAt, durationMinutes: a.durationMinutes, excludeId: a.id });
    if (err) throw new AppError(err, "conflict");
    await tx.update(appointments).set({ startsAt, endsAt: new Date(startsAt.getTime() + a.durationMinutes * 60_000), staffId: sid })
      .where(and(eq(appointments.id, id), eq(appointments.tenantId, ctx.tenantId)));
    await tx.insert(notifications).values({ tenantId: ctx.tenantId, kind: "appointment", title: "Appointment rescheduled", link: "/appointments" });
    await audit(tctx, "appointment.reschedule", "appointment", id, { from: a.startsAt, to: startsAt });
  });
}

export async function setAppointmentStatus(ctx: Ctx, id: string, status: (typeof APPT_STATUSES)[number]) {
  needModule(ctx, "appointments");
  need(ctx, "appointments.manage");
  const [a] = await ctx.db.select().from(appointments).where(and(eq(appointments.id, id), eq(appointments.tenantId, ctx.tenantId)));
  if (!a) throw new AppError("Appointment not found", "not_found");
  if (!TRANSITIONS[a.status]?.includes(status)) throw new AppError(`Cannot change from ${a.status} to ${status}.`);
  if (status === "completed" && !a.transactionId) {
    // completion normally happens through POS checkout; allow manual completion for non-billed visits
  }
  await ctx.db.update(appointments).set({ status }).where(and(eq(appointments.id, id), eq(appointments.tenantId, ctx.tenantId)));
  if (status === "cancelled") await ctx.db.insert(notifications).values({ tenantId: ctx.tenantId, kind: "appointment", title: "Appointment cancelled", link: "/appointments" });
  await audit(ctx, "appointment.status", "appointment", id, { from: a.status, to: status });
}

export async function listAppointments(ctx: Ctx, o: { from: Date; to: Date; staffId?: string; status?: string; serviceId?: string; q?: string }) {
  needModule(ctx, "appointments");
  need(ctx, "appointments.view");
  const conds = [eq(appointments.tenantId, ctx.tenantId), gt(appointments.endsAt, o.from), lt(appointments.startsAt, o.to)];
  if (o.staffId) conds.push(eq(appointments.staffId, o.staffId));
  if (o.status) conds.push(eq(appointments.status, o.status));
  if (o.serviceId) conds.push(eq(appointments.serviceId, o.serviceId));
  if (o.q) conds.push(sql`${customers.name} ilike ${"%" + o.q + "%"}`);
  return ctx.db.select({ a: appointments, customerName: customers.name, customerPhone: customers.phone, serviceName: services.name, staffName: staff.name, staffColor: staff.color })
    .from(appointments).innerJoin(customers, eq(customers.id, appointments.customerId))
    .innerJoin(services, eq(services.id, appointments.serviceId)).innerJoin(staff, eq(staff.id, appointments.staffId))
    .where(and(...conds)).orderBy(asc(appointments.startsAt));
}

/** Available start times for a service on a local date. Every slot is verified through validateSlot. */
export async function findSlots(ctx: Ctx, o: { date: string; serviceId: string; staffId?: string; durationMinutes?: number }) {
  needModule(ctx, "appointments");
  need(ctx, "appointments.view");
  const [svc] = await ctx.db.select().from(services).where(and(eq(services.id, o.serviceId), eq(services.tenantId, ctx.tenantId)));
  if (!svc) throw new AppError("Service not found", "not_found");
  const dur = o.durationMinutes ?? svc.durationMinutes;
  const t = ctx.tenant;
  const weekday = zonedParts(zonedToUtc(o.date, 720, t.timezone), t.timezone).weekday;
  const day = t.hours[String(weekday) as keyof typeof t.hours];
  if (!day) return [];
  const staffRows = o.staffId
    ? await ctx.db.select().from(staff).where(and(eq(staff.id, o.staffId), eq(staff.tenantId, ctx.tenantId)))
    : await ctx.db.select().from(staff).where(and(eq(staff.tenantId, ctx.tenantId), eq(staff.active, true)));
  const out: { staffId: string; staffName: string; startsAt: Date; label: string }[] = [];
  const now = Date.now();
  for (const st of staffRows) {
    for (let m = hm(day.open); m + dur <= hm(day.close); m += Math.max(t.slotMinutes, 5)) {
      const startsAt = zonedToUtc(o.date, m, t.timezone);
      if (startsAt.getTime() < now) continue;
      const err = await validateSlot(ctx, { staffId: st.id, serviceId: o.serviceId, startsAt, durationMinutes: dur });
      if (!err) out.push({ staffId: st.id, staffName: st.name, startsAt, label: minToHm(m) });
    }
  }
  return out;
}

export function apptNet(a: { price: string; discount: string }) { return fromCents(toCents(a.price) - toCents(a.discount)); }
export { pctOf };
