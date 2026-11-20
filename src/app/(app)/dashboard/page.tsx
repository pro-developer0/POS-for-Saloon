import Link from "next/link";
import { ArrowDown, ArrowUp } from "lucide-react";
import { requireCtx } from "@/server/session";
import * as rep from "@/server/services/reports";
import { appointmentsOn, dashboardKpis, daySchedule, monthlySales } from "@/server/services/dashboard";
import { Card, Empty, money } from "@/components/ui";
import { SalesChart } from "@/components/charts";
import { SalesModeSelect } from "@/components/sales-mode-select";
import { RangeFilter } from "@/components/range-filter";
import { DaySchedule } from "@/components/day-schedule";
import { UpcomingAppointments } from "@/components/upcoming-appointments";
import { BarsChart } from "@/components/charts";
import { addDays, hm, zonedParts, zonedToUtc } from "@/lib/time";
import type { RangeKey } from "@/lib/time";

export const metadata = { title: "Dashboard" };

function Kpi({ label, value, change }: { label: string; value: string; change: number | null }) {
  const up = (change ?? 0) >= 0;
  return (
    <div className="card p-5">
      <p className="text-3xl font-semibold tracking-tight">{value}</p>
      <div className="mt-5 flex items-center justify-between">
        <span className="text-xs text-muted">{label}</span>
        {change !== null && (
          <span className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-semibold ${up ? "bg-ok/15 text-ok" : "bg-bad/15 text-bad"}`} title="Compared with the previous period">
            {up ? <ArrowUp size={11} /> : <ArrowDown size={11} />}{Math.abs(change)} %
          </span>
        )}
      </div>
    </div>
  );
}

export default async function Dashboard({ searchParams }: { searchParams: Promise<{ range?: RangeKey; from?: string; to?: string; day?: string; sales?: string }> }) {
  const ctx = await requireCtx("dashboard.view");
  const sp = await searchParams;
  const tz = ctx.tenant.timezone, h12 = ctx.tenant.timeFormat === "12h", cur = ctx.tenant.currency;
  const m = (v: string | number) => money(v, cur);
  const r = rep.rangeFor(ctx, (sp.range ?? "30d") as RangeKey, { from: sp.from, to: sp.to });
  const canAppts = ctx.perms.has("appointments.view"), canReports = ctx.perms.has("reports.view");

  const today = zonedParts(new Date(), tz).date;
  const day = sp.day && /^\d{4}-\d{2}-\d{2}$/.test(sp.day) && !isNaN(Date.parse(sp.day)) ? sp.day : today;
  const weekday = zonedParts(zonedToUtc(day, 0, tz), tz).weekday;
  const mode = sp.sales === "weekly" ? "weekly" : "monthly";
  const year = Number(today.slice(0, 4));
  const todayHours = ctx.tenant.hours[String(zonedParts(zonedToUtc(today, 0, tz), tz).weekday) as "0"];

  const [kpi, series, sched, upcoming, sum, low, dormant, popular] = await Promise.all([
    dashboardKpis(ctx, r), monthlySales(ctx, year, mode),
    canAppts ? daySchedule(ctx, today) : null, canAppts ? appointmentsOn(ctx, day) : [],
    rep.salesSummary(ctx, r),
    ctx.perms.has("inventory.view") ? rep.lowStock(ctx) : [], ctx.perms.has("customers.view") ? rep.dormantCustomers(ctx, 60, 50) : [],
    canReports ? rep.popularServices(ctx, r, 5, "service") : [],
  ]);
  const defaultIndex = mode === "weekly" ? series.length - 1 : Number(today.slice(5, 7)) - 1;
  const q = (d: string) => { const p = new URLSearchParams(); for (const k of ["range", "from", "to", "sales"] as const) if (sp[k]) p.set(k, sp[k]!); p.set("day", d); return `/dashboard?${p}`; };
  void addDays;

  return (
    <div className="page-in grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
      <h1 className="sr-only">Dashboard</h1>
      <div className="min-w-0 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-muted">Showing {r.fromDate} → {new Date(r.to.getTime() - 1).toISOString().slice(0, 10)} · {tz}</p>
          <RangeFilter />
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <Kpi label="Total Customers" value={kpi.customers.value.toLocaleString("en")} change={kpi.customers.change} />
          <Kpi label="Total Revenue" value={m(kpi.revenue.value)} change={kpi.revenue.change} />
          <Kpi label="Appointments Today" value={String(kpi.today.value)} change={kpi.today.change} />
        </div>

        {sched && (
          <Card>
            <div className="flex items-center justify-between px-5 pb-3 pt-5"><h2 className="text-sm font-semibold">Day Schedule</h2><Link href="/calendar" className="text-xs font-semibold text-brand">Open calendar →</Link></div>
            <DaySchedule team={sched.team} blocks={sched.blocks} openMin={todayHours ? hm(todayHours.open) : 540} closeMin={todayHours ? hm(todayHours.close) : 1020} h12={h12} />
          </Card>
        )}

        <Card>
          <div className="flex items-center justify-between px-5 pt-5"><h2 className="text-sm font-semibold">Recent Sales</h2><SalesModeSelect /></div>
          <div className="px-3 pb-4 pt-1"><SalesChart data={series} currency={cur} defaultIndex={defaultIndex} /></div>
        </Card>

        <div className="grid gap-4 lg:grid-cols-2">
          <Card title="Alerts & insights" action={ctx.perms.has("ai.use") ? <Link href="/ai" className="text-xs font-semibold text-brand">Ask the AI advisor →</Link> : null}>
            <ul className="divide-y divide-line text-sm">
              {Number(sum.outstanding) > 0 && <li className="px-5 py-3"><Link href="/invoices?status=unpaid" className="hover:underline">💳 {m(sum.outstanding)} in unpaid balances.</Link></li>}
              {low.length > 0 && <li className="px-5 py-3"><Link href="/inventory?low=1" className="hover:underline">📦 {low.length} product{low.length > 1 ? "s" : ""} at or below minimum stock: {low.slice(0, 3).map((p) => p.name).join(", ")}</Link></li>}
              {dormant.length > 0 && <li className="px-5 py-3"><Link href="/customers" className="hover:underline">👥 {dormant.length} client{dormant.length > 1 ? "s" : ""} {"haven't"} visited in 60+ days — a retention message may help.</Link></li>}
              {Number(sum.outstanding) === 0 && !low.length && !dormant.length && <li className="px-5 py-6 text-muted">No alerts. Everything looks healthy.</li>}
            </ul>
          </Card>
          {canReports && (
            <Card title="Popular services">
              {popular.length ? <div className="p-4"><BarsChart data={popular.map((d) => ({ name: d.name.length > 12 ? d.name.slice(0, 11) + "…" : d.name, qty: d.qty }))} x="name" y="qty" label="Popular services by quantity" /></div> : <Empty title="No service sales yet" desc="Complete a sale in POS to see rankings." />}
            </Card>
          )}
        </div>
      </div>

      {canAppts && (
        <aside className="card min-w-0 self-start">
          <UpcomingAppointments day={day} today={today} weekdayOfDay={weekday} rows={upcoming} tz={tz} h12={h12} money={(v) => m(v)} query={q} />
        </aside>
      )}
    </div>
  );
}
