import Link from "next/link";
import { requireCtx } from "@/server/session";
import { listInvoices } from "@/server/services/pos";
import { Card, Empty, PageHeader, StatusBadge, money } from "@/components/ui";
import { fmtDate } from "@/lib/time";

export const metadata = { title: "Invoices" };
export default async function Page({ searchParams }: { searchParams: Promise<{ status?: string; q?: string }> }) {
  const ctx = await requireCtx("invoices.view");
  const sp = await searchParams;
  const rows = await listInvoices(ctx, { status: sp.status || undefined, q: sp.q || undefined });
  const cur = ctx.tenant.currency, tz = ctx.tenant.timezone;
  return (
    <div className="page-in">
      <PageHeader title="Invoices" desc="Every sale creates a numbered invoice. Paid records are never silently edited." />
      <form className="card mb-4 flex flex-wrap gap-3 p-4">
        <input name="q" defaultValue={sp.q} className="input max-w-xs" placeholder="Invoice # or customer…" aria-label="Search" />
        <select name="status" defaultValue={sp.status ?? ""} className="input max-w-[12rem]" aria-label="Status"><option value="">All statuses</option>{["unpaid", "partially_paid", "paid", "overdue", "cancelled", "credit_note"].map((s) => <option key={s} value={s}>{s.replace("_", " ")}</option>)}</select>
        <button className="btn">Filter</button>
      </form>
      <Card>
        {rows.length === 0 ? <Empty title="No invoices found" /> : (
          <div className="overflow-x-auto"><table className="tbl"><thead><tr><th>Invoice</th><th>Date</th><th>Customer</th><th>Status</th><th className="text-right">Total</th><th className="text-right">Balance</th></tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={r.inv.id}><td><Link className="font-semibold hover:text-brand" href={`/invoices/${r.t.id}`}>{r.inv.number}</Link></td><td>{fmtDate(r.inv.createdAt, tz)}</td>
                <td>{r.customerName ?? "Walk-in"}</td><td><StatusBadge status={r.status} /></td><td className="text-right">{money(r.t.total, cur)}</td>
                <td className={`text-right ${Number(r.balance) > 0 && r.status !== "cancelled" ? "font-semibold text-warn" : "text-muted"}`}>{r.status === "cancelled" ? "—" : money(r.balance, cur)}</td></tr>))}</tbody></table></div>
        )}
      </Card>
    </div>
  );
}
