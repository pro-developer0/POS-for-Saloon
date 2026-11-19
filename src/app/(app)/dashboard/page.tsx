import { modulesOf } from "@/lib/verticals";
import { expiryReport, expirySummary } from "@/server/services/batches";
import Link from "next/link";
import { requireCtx } from "@/server/session";
import * as rep from "@/server/services/reports";
import { Card, Empty, PageHeader, Stat, StatusBadge, money } from "@/components/ui";
import { RevenueChart, BarsChart } from "@/components/charts";
import { RangeFilter } from "@/components/range-filter";
import { fmtDateTime } from "@/lib/time";
import type { RangeKey } from "@/lib/time";

export const metadata = { title: "Dashboard" };
export default async function Dashboard({ searchParams }: { searchParams: Promise<{ range?: RangeKey; from?: string; to?: string }> }) {
  const ctx = await requireCtx("dashboard.view");
  const sp = await searchParams;
  const key = (sp.range ?? "30d") as RangeKey;
  const r = rep.rangeFor(ctx, key, { from: sp.from, to: sp.to });
  const canReports = ctx.perms.has("reports.view");
  const mods = modulesOf(ctx.tenant);
  const cur = ctx.tenant.currency, m = (v: string | number) => money(v, cur);
  const [sum, series, appt, cust, recent, low, dormant, popular, staffPerf] = await Promise.all([
    rep.salesSummary(ctx, r), rep.revenueSeries(ctx, r), rep.appointmentStats(ctx, r), rep.customerStats(ctx, r), rep.recentTransactions(ctx),
    ctx.perms.has("inventory.view") ? rep.lowStock(ctx) : [], ctx.perms.has("customers.view") ? rep.dormantCustomers(ctx, 60, 50) : [],
    canReports ? rep.popularServices(ctx, r, 5, mods.has("services") ? "service" : "any") : [], canReports ? rep.staffPerformance(ctx, r) : [],
  ]);
  const by = appt.byStatus;
  const exp = mods.has("batches") && ctx.perms.has("inventory.view") ? expirySummary(await expiryReport(ctx, 30)) : null;
  const profit = Number(sum.netProfit);
  return (
    <div className="page-in">
      <PageHeader title="Dashboard" desc={`Figures for ${r.fromDate} → ${new Date(r.to.getTime() - 1).toISOString().slice(0, 10)} · ${ctx.tenant.timezone}`} actions={<RangeFilter />} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Sales (incl. tax)" value={m(sum.sales)} hint={`${sum.transactions} transactions`} />
        <Stat label="Collected" value={m(sum.collected)} hint="Payments received" />
        <Stat label="Outstanding" value={m(sum.outstanding)} tone={Number(sum.outstanding) > 0 ? "warn" : undefined} hint="Unpaid balances (all time)" />
        <Stat label="Expenses" value={m(sum.expenses)} />
        <Stat label="Net profit" value={m(sum.netProfit)} tone={profit < 0 ? "bad" : "ok"} hint="Net sales − expenses" />
        <Stat label="Avg. transaction" value={m(sum.avgTransaction)} />
        {mods.has("appointments") && <Stat label="Appointments" value={appt.total} hint={`${appt.upcoming} upcoming`} />}
        <Stat label="New / returning customers" value={`${cust.newCustomers} / ${cust.returning}`} />
      </div>
      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        <Card title="Revenue" className={mods.has("appointments") ? "xl:col-span-2" : "xl:col-span-3"}><div className="p-4"><RevenueChart data={series} currency={cur} /></div></Card>
        {mods.has("appointments") && <Card title="Appointment overview">
          <div className="space-y-2.5 p-5 text-sm">
            {(["completed", "confirmed", "pending", "cancelled", "no_show"] as const).map((s) => (
              <div key={s} className="flex items-center justify-between"><StatusBadge status={s} /><span className="font-semibold">{by[s] ?? 0}</span></div>
            ))}
          </div>
        </Card>}
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card title="Business alerts & insights" action={ctx.perms.has("ai.use") ? <Link href="/ai" className="text-xs font-semibold text-brand">Ask the AI advisor →</Link> : null}>
          <ul className="divide-y divide-line text-sm">
            {Number(sum.outstanding) > 0 && <li className="px-5 py-3"><Link href="/invoices?status=unpaid" className="hover:underline">💳 {m(sum.outstanding)} in unpaid balances.</Link></li>}
            {low.length > 0 && <li className="px-5 py-3"><Link href="/inventory?low=1" className="hover:underline">📦 {low.length} product{low.length > 1 ? "s" : ""} at or below minimum stock: {low.slice(0, 3).map((p) => p.name).join(", ")}</Link></li>}
            {exp && exp.expired > 0 && <li className="px-5 py-3"><Link href="/expiry" className="font-medium text-bad hover:underline">🚫 {exp.expired} expired batch{exp.expired > 1 ? "es" : ""} still in stock — remove from shelves and write off.</Link></li>}
            {exp && exp.d30 > 0 && <li className="px-5 py-3"><Link href="/expiry" className="hover:underline">⏳ {exp.d30} batch{exp.d30 > 1 ? "es" : ""} expire within 30 days.</Link></li>}
            {dormant.length > 0 && <li className="px-5 py-3"><Link href="/customers" className="hover:underline">👥 {dormant.length} customer{dormant.length > 1 ? "s" : ""} {"haven't"} completed a visit in 60+ days — a retention message may help.</Link></li>}
            {Number(sum.outstanding) === 0 && !low.length && !dormant.length && !(exp && (exp.expired || exp.d30)) && <li className="px-5 py-6 text-muted">No alerts. Everything looks healthy.</li>}
          </ul>
        </Card>
        {canReports && (
          <Card title={mods.has("services") ? "Popular services" : "Top sellers"}>
            {popular.length ? <BarsChartWrap data={popular} /> : <Empty title="No service sales yet" desc="Complete a sale in POS to see rankings." />}
          </Card>
        )}
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        {canReports && mods.has("staff") && (
          <Card title="Staff performance">
            <div className="overflow-x-auto"><table className="tbl"><thead><tr><th>Staff</th><th>Services</th><th className="text-right">Revenue</th></tr></thead>
              <tbody>{staffPerf.map((s) => <tr key={s.id}><td className="font-medium">{s.name}</td><td>{s.services}</td><td className="text-right">{m(s.revenue)}</td></tr>)}</tbody></table></div>
          </Card>
        )}
        <Card title="Recent transactions" action={<Link href="/invoices" className="text-xs font-semibold text-brand">All →</Link>}>
          {recent.length ? <div className="overflow-x-auto"><table className="tbl"><tbody>
            {recent.map(({ t, customerName }) => (<tr key={t.id}><td><span className="font-medium">{customerName ?? "Walk-in"}</span><span className="block text-xs text-muted">{fmtDateTime(t.createdAt, ctx.tenant.timezone, ctx.tenant.timeFormat === "12h")}</span></td><td><StatusBadge status={t.status} /></td><td className="text-right font-semibold">{m(t.total)}</td></tr>))}
          </tbody></table></div> : <Empty title="No transactions yet" action={<Link className="btn btn-primary" href="/pos">Open POS</Link>} />}
        </Card>
      </div>
    </div>
  );
}
function BarsChartWrap({ data }: { data: { name: string; qty: number }[] }) {
  return <div className="p-4"><BarsChart data={data.map((d) => ({ name: d.name.length > 12 ? d.name.slice(0, 11) + "…" : d.name, qty: d.qty }))} x="name" y="qty" label="Popular services by quantity" /></div>;
}
