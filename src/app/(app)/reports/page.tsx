import { requireCtx } from "@/server/session";
import * as rep from "@/server/services/reports";
import { Card, Empty, PageHeader, Stat, money, Tabs } from "@/components/ui";
import { RangeFilter } from "@/components/range-filter";
import { BarsChart, RevenueChart } from "@/components/charts";
import { PrintButton } from "@/components/print-button";
import { listProducts } from "@/server/services/inventory";
import { debtors } from "@/server/services/ledger";
import Link from "next/link";
import type { RangeKey } from "@/lib/time";

export const metadata = { title: "Reports" };
const TABS = [["sales", "Sales & revenue"], ["services", "Services"], ["staff", "Staff & commission"], ["customers", "Customers"], ["inventory", "Inventory"], ["finance", "Payments, expenses & tax"]];

export default async function Page({ searchParams }: { searchParams: Promise<{ tab?: string; range?: RangeKey; from?: string; to?: string }> }) {
  const ctx = await requireCtx("reports.view");
  const sp = await searchParams; const tab = TABS.some(([k]) => k === sp.tab) ? sp.tab! : "sales";
  const range = (sp.range ?? "30d") as RangeKey;
  const r = rep.rangeFor(ctx, range, { from: sp.from, to: sp.to });
  const cur = ctx.tenant.currency, m = (v: string | number) => money(v, cur);
  const qs = new URLSearchParams({ range, ...(sp.from ? { from: sp.from } : {}), ...(sp.to ? { to: sp.to } : {}) }).toString();
  const csv = (name: string) => <a className="btn btn-sm" href={`/api/export/${name}?${qs}`}>Export CSV</a>;
  return (
    <div className="page-in">
      <PageHeader title="Reports & analytics" desc={`${r.fromDate} → ${new Date(r.to.getTime() - 1).toISOString().slice(0, 10)} · all figures calculated from your database`} actions={<><RangeFilter /><PrintButton /></>} />
      <Tabs active={tab} tabs={TABS.map(([k, l]) => ({ key: k, label: l, href: `/reports?tab=${k}&${qs}` }))} />
      {tab === "sales" && await (async () => {
        const [s, series, appt, pm] = await Promise.all([rep.salesSummary(ctx, r), rep.revenueSeries(ctx, r), rep.appointmentStats(ctx, r), rep.busiestDays(ctx, r)]);
        return (<div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4"><Stat label="Sales" value={m(s.sales)} /><Stat label="Net sales (excl. tax)" value={m(s.netSales)} /><Stat label="Discounts given" value={m(s.discounts)} /><Stat label="Net profit" value={m(s.netProfit)} tone={Number(s.netProfit) < 0 ? "bad" : "ok"} hint="Net sales − expenses (COGS not deducted)" /></div>
          <Card title="Revenue by day" action={csv("sales")}><div className="p-4"><RevenueChart data={series} currency={cur} /></div></Card>
          <div className="grid gap-4 lg:grid-cols-2"><Card title="Appointments by status"><div className="space-y-2 p-5 text-sm">{Object.entries(appt.byStatus).map(([k, v]) => <div key={k} className="flex justify-between capitalize"><span>{k.replace("_", " ")}</span><b>{v}</b></div>)}{!appt.total && <p className="text-muted">No appointments in range.</p>}</div></Card>
            <Card title="Busiest weekdays"><div className="p-4"><BarsChart data={pm.map((x) => ({ day: x.day.slice(0, 3), count: x.count }))} x="day" y="count" label="Appointments per weekday" /></div></Card></div></div>);
      })()}
      {tab === "services" && await (async () => {
        const p = await rep.popularServices(ctx, r, 20);
        return <Card title="Service performance" action={csv("services")}>{p.length === 0 ? <Empty title="No service sales in range" /> : <div className="overflow-x-auto"><table className="tbl"><thead><tr><th>Service</th><th className="text-right">Sold</th><th className="text-right">Revenue</th></tr></thead><tbody>{p.map((x) => <tr key={x.name}><td className="font-medium">{x.name}</td><td className="text-right">{x.qty}</td><td className="text-right">{m(x.revenue)}</td></tr>)}</tbody></table></div>}</Card>;
      })()}
      {tab === "staff" && await (async () => {
        const p = await rep.staffPerformance(ctx, r);
        return <Card title="Staff revenue & commission" action={csv("staff")}><div className="overflow-x-auto"><table className="tbl"><thead><tr><th>Staff</th><th className="text-right">Services</th><th className="text-right">Revenue</th><th className="text-right">Commission</th></tr></thead><tbody>{p.map((x) => <tr key={x.id}><td className="font-medium">{x.name}</td><td className="text-right">{x.services}</td><td className="text-right">{m(x.revenue)}</td><td className="text-right">{m(x.commission)}</td></tr>)}</tbody></table></div></Card>;
      })()}
      {tab === "customers" && await (async () => {
        const [c, d] = await Promise.all([rep.customerStats(ctx, r), rep.dormantCustomers(ctx, 60, 50)]);
        return (<div className="space-y-4"><div className="grid grid-cols-2 gap-3 lg:grid-cols-3"><Stat label="New customers" value={c.newCustomers} /><Stat label="Returning customers" value={c.returning} /><Stat label="Lapsed (60+ days)" value={d.length} tone={d.length ? "warn" : undefined} /></div>
          <Card title="Customer retention — lapsed customers" action={csv("customers")}>{d.length === 0 ? <Empty title="No lapsed customers" /> : <div className="overflow-x-auto"><table className="tbl"><thead><tr><th>Customer</th><th>Phone</th><th>Last visit</th><th>Marketing consent</th></tr></thead><tbody>{d.map((x) => <tr key={x.id}><td className="font-medium">{x.name}</td><td>{x.phone}</td><td>{String(x.last).slice(0, 10)}</td><td>{x.marketing_consent ? "Yes" : "No"}</td></tr>)}</tbody></table></div>}</Card></div>);
      })()}
      {tab === "inventory" && await (async () => {
        const [prods, sold] = await Promise.all([listProducts(ctx), rep.productSales(ctx, r)]);
        return (<div className="space-y-4"><Card title="Stock levels" action={csv("inventory")}><div className="overflow-x-auto"><table className="tbl"><thead><tr><th>Product</th><th className="text-right">Qty</th><th className="text-right">Min</th><th className="text-right">Value (cost)</th></tr></thead><tbody>{prods.map(({ p }) => <tr key={p.id}><td className="font-medium">{p.name}</td><td className={`text-right ${p.quantity <= p.minStock ? "font-semibold text-bad" : ""}`}>{p.quantity}</td><td className="text-right">{p.minStock}</td><td className="text-right">{m((p.quantity * Number(p.costPrice)).toFixed(2))}</td></tr>)}</tbody></table></div></Card>
          <Card title="Product sales in range">{sold.length === 0 ? <Empty title="No product sales" /> : <div className="overflow-x-auto"><table className="tbl"><tbody>{sold.map((x) => <tr key={x.name}><td className="font-medium">{x.name}</td><td className="text-right">{x.qty} sold</td><td className="text-right">{m(x.revenue)}</td></tr>)}</tbody></table></div>}</Card></div>);
      })()}
      {tab === "finance" && await (async () => {
        const [pay, exp, tax, owed] = await Promise.all([rep.paymentsByMethod(ctx, r), rep.expenseByCategory(ctx, r), rep.taxReport(ctx, r), debtors(ctx, 15)]);
        return (<div className="grid gap-4 lg:grid-cols-3">
          <Card title="Payments by method" action={csv("payments")}><table className="tbl"><tbody>{pay.map((x) => <tr key={x.method}><td className="capitalize">{x.method.replace(/_/g, " ")}</td><td className="text-right text-muted">{x.n}×</td><td className="text-right font-semibold">{m(x.total)}</td></tr>)}{!pay.length && <tr><td className="text-muted">No payments</td></tr>}</tbody></table></Card>
          <Card title="Expenses by category" action={csv("expenses")}><table className="tbl"><tbody>{exp.map((x) => <tr key={x.category}><td>{x.category}</td><td className="text-right font-semibold">{m(x.total)}</td></tr>)}{!exp.length && <tr><td className="text-muted">No expenses</td></tr>}</tbody></table></Card>
          <Card title="Customers who owe money" className="lg:col-span-3">{owed.length === 0 ? <p className="px-5 py-6 text-sm text-muted">Nobody owes anything.</p> : <div className="overflow-x-auto"><table className="tbl"><thead><tr><th>Customer</th><th>Phone</th><th className="text-right">Credit limit</th><th className="text-right">Owes</th></tr></thead><tbody>{owed.map((x) => <tr key={x.id}><td><Link className="font-medium hover:text-brand" href={`/customers/${x.id}`}>{x.name}</Link></td><td>{x.phone}</td><td className="text-right">{x.limit ? m(x.limit) : "—"}</td><td className="text-right font-semibold text-warn">{m(x.balance)}</td></tr>)}</tbody></table></div>}</Card>
          {Number(ctx.tenant.taxRate) > 0 && (<Card title={`Tax report (${ctx.tenant.taxName})`}><dl className="space-y-2 p-5 text-sm"><div className="flex justify-between"><dt className="text-muted">Taxable base (after discounts)</dt><dd>{m(tax.taxable)}</dd></div><div className="flex justify-between font-semibold"><dt>Tax collected</dt><dd>{m(tax.tax)}</dd></div></dl></Card>)}</div>);
      })()}
    </div>
  );
}
