import { and, asc, eq, gt, lt, ne, sql } from "drizzle-orm";
import { appointments, customers, services, staff } from "@/db/schema";
import { need, type Ctx } from "../ctx";
import { addDays, zonedParts, zonedToUtc } from "@/lib/time";
import type { Range } from "./reports";

/** % change from `prev` to `cur`; null when there is nothing to compare against. */
export const pctChange = (cur: number, prev: number) => (prev > 0 ? Math.round(((cur - prev) / prev) * 1000) / 10 : cur > 0 ? 100 : null);

/**
 * The three headline numbers on the dashboard, each with its change against the previous period of the same length.
 * - customers: total customers now; change = new customers this period vs the period before
 * - revenue:   sales (tax included, credit notes netted) this period vs the period before
 * - today:     appointments today (not cancelled / no-show) vs yesterday
 */
export async function dashboardKpis(ctx: Ctx, r: Range) {
  need(ctx, "dashboard.view");
  const tid = ctx.tenantId, tz = ctx.tenant.timezone;
  const len = r.to.getTime() - r.from.getTime();
  const prevFrom = new Date(r.from.getTime() - len), prevTo = r.from;
  const today = zonedParts(new Date(), tz).date;
  const t0 = zonedToUtc(today, 0, tz), t1 = zonedToUtc(addDays(today, 1), 0, tz), y0 = zonedToUtc(addDays(today, -1), 0, tz);

  const [x] = await ctx.db.execute<{ total: string; new_cur: string; new_prev: string; rev_cur: string; rev_prev: string; appt_today: string; appt_yday: string }>(sql`
    select
      (select count(*) from customers where tenant_id = ${tid} and archived = false) total,
      (select count(*) from customers where tenant_id = ${tid} and created_at >= ${r.from} and created_at < ${r.to}) new_cur,
      (select count(*) from customers where tenant_id = ${tid} and created_at >= ${prevFrom} and created_at < ${prevTo}) new_prev,
      (select coalesce(sum(total),0) from transactions where tenant_id = ${tid} and status <> 'cancelled' and created_at >= ${r.from} and created_at < ${r.to}) rev_cur,
      (select coalesce(sum(total),0) from transactions where tenant_id = ${tid} and status <> 'cancelled' and created_at >= ${prevFrom} and created_at < ${prevTo}) rev_prev,
      (select count(*) from appointments where tenant_id = ${tid} and status not in ('cancelled','no_show') and starts_at >= ${t0} and starts_at < ${t1}) appt_today,
      (select count(*) from appointments where tenant_id = ${tid} and status not in ('cancelled','no_show') and starts_at >= ${y0} and starts_at < ${t0}) appt_yday`).then((q) => q.rows);
  return {
    customers: { value: Number(x.total), change: pctChange(Number(x.new_cur), Number(x.new_prev)) },
    revenue: { value: Number(x.rev_cur), change: pctChange(Number(x.rev_cur), Number(x.rev_prev)) },
    today: { value: Number(x.appt_today), change: pctChange(Number(x.appt_today), Number(x.appt_yday)) },
  };
}

/** Sales per calendar month of `year` (12 numbers, Jan..Dec) in the salon's timezone. */
export async function monthlySales(ctx: Ctx, year: number, mode: "monthly" | "weekly" = "monthly") {
  need(ctx, "dashboard.view");
  const tz = ctx.tenant.timezone;
  if (mode === "weekly") {
    // last 12 weeks, oldest first
    const today = zonedParts(new Date(), tz).date;
    const from = zonedToUtc(addDays(today, -83), 0, tz), to = zonedToUtc(addDays(today, 1), 0, tz);
    const rows = await ctx.db.execute<{ d: string; v: string }>(sql`select to_char(created_at at time zone ${tz}, 'YYYY-MM-DD') d, sum(total) v from transactions
      where tenant_id = ${ctx.tenantId} and status <> 'cancelled' and created_at >= ${from} and created_at < ${to} group by 1`);
    const byDay = new Map(rows.rows.map((x) => [x.d, Number(x.v)]));
    return Array.from({ length: 12 }, (_, i) => {
      const start = addDays(today, -83 + i * 7);
      let v = 0; for (let k = 0; k < 7; k++) v += byDay.get(addDays(start, k)) ?? 0;
      return { label: start.slice(5), value: Math.round(v * 100) / 100 };
    });
  }
  const from = zonedToUtc(`${year}-01-01`, 0, tz), to = zonedToUtc(`${year + 1}-01-01`, 0, tz);
  const rows = await ctx.db.execute<{ m: number; v: string }>(sql`select extract(month from created_at at time zone ${tz})::int m, sum(total) v from transactions
    where tenant_id = ${ctx.tenantId} and status <> 'cancelled' and created_at >= ${from} and created_at < ${to} group by 1`);
  const by = new Map(rows.rows.map((x) => [x.m, Number(x.v)]));
  const names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return names.map((label, i) => ({ label, value: Math.round((by.get(i + 1) ?? 0) * 100) / 100 }));
}

export type DayBlock = { id: string; staffId: string; service: string; customer: string; startMin: number; endMin: number; status: string };
/** Appointments on one local date, plus the stylists to show as columns. */
export async function daySchedule(ctx: Ctx, date: string) {
  need(ctx, "appointments.view");
  const tz = ctx.tenant.timezone;
  const from = zonedToUtc(date, 0, tz), to = zonedToUtc(addDays(date, 1), 0, tz);
  const rows = await ctx.db.select({ a: appointments, customerName: customers.name, serviceName: services.name })
    .from(appointments).innerJoin(customers, eq(customers.id, appointments.customerId)).innerJoin(services, eq(services.id, appointments.serviceId))
    .where(and(eq(appointments.tenantId, ctx.tenantId), gt(appointments.endsAt, from), lt(appointments.startsAt, to), ne(appointments.status, "cancelled"), ne(appointments.status, "no_show")))
    .orderBy(asc(appointments.startsAt));
  const team = await ctx.db.select({ id: staff.id, name: staff.name, color: staff.color }).from(staff)
    .where(and(eq(staff.tenantId, ctx.tenantId), eq(staff.active, true))).orderBy(asc(staff.name));
  const blocks: DayBlock[] = rows.map(({ a, customerName, serviceName }) => {
    const s = zonedParts(a.startsAt, tz), e = zonedParts(a.endsAt, tz);
    return { id: a.id, staffId: a.staffId, service: serviceName, customer: customerName, startMin: s.date === date ? s.minutes : 0, endMin: e.date === date ? e.minutes || 1440 : 1440, status: a.status };
  });
  return { team, blocks };
}

/** Appointments of one local day for the "Upcoming appointments" panel (soonest first). */
export async function appointmentsOn(ctx: Ctx, date: string) {
  need(ctx, "appointments.view");
  const tz = ctx.tenant.timezone;
  const from = zonedToUtc(date, 0, tz), to = zonedToUtc(addDays(date, 1), 0, tz);
  const rows = await ctx.db.select({ a: appointments, customerName: customers.name, serviceName: services.name, staffName: staff.name })
    .from(appointments).innerJoin(customers, eq(customers.id, appointments.customerId)).innerJoin(services, eq(services.id, appointments.serviceId)).innerJoin(staff, eq(staff.id, appointments.staffId))
    .where(and(eq(appointments.tenantId, ctx.tenantId), gt(appointments.endsAt, from), lt(appointments.startsAt, to), ne(appointments.status, "cancelled"), ne(appointments.status, "no_show")))
    .orderBy(asc(appointments.startsAt));
  return rows.map(({ a, customerName, serviceName, staffName }) => ({
    id: a.id, customer: customerName, service: serviceName, stylist: staffName, startsAt: a.startsAt, endsAt: a.endsAt,
    price: (Number(a.price) - Number(a.discount)).toFixed(2), status: a.status,
  }));
}
