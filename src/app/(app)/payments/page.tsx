import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { requireCtx } from "@/server/session";
import { payments, transactions, invoices, customers } from "@/db/schema";
import { Card, Empty, PageHeader, money } from "@/components/ui";
import { fmtDateTime } from "@/lib/time";

export const metadata = { title: "Payments" };
export default async function Page() {
  const ctx = await requireCtx("invoices.view");
  const rows = await ctx.db.select({ p: payments, inv: invoices.number, tid: transactions.id, customer: customers.name }).from(payments)
    .innerJoin(transactions, eq(transactions.id, payments.transactionId)).innerJoin(invoices, eq(invoices.transactionId, transactions.id)).leftJoin(customers, eq(customers.id, transactions.customerId))
    .where(eq(payments.tenantId, ctx.tenantId)).orderBy(desc(payments.createdAt)).limit(300);
  return (
    <div className="page-in">
      <PageHeader title="Payments" desc="Every payment received, newest first." />
      <Card>{rows.length === 0 ? <Empty title="No payments yet" /> : <div className="overflow-x-auto"><table className="tbl"><thead><tr><th>Date</th><th>Invoice</th><th>Customer</th><th>Method</th><th className="text-right">Amount</th></tr></thead>
        <tbody>{rows.map((r) => (<tr key={r.p.id}><td>{fmtDateTime(r.p.createdAt, ctx.tenant.timezone, ctx.tenant.timeFormat === "12h")}</td><td><Link className="font-medium hover:text-brand" href={`/invoices/${r.tid}`}>{r.inv}</Link></td><td>{r.customer ?? "Walk-in"}</td><td className="capitalize">{r.p.method.replace(/_/g, " ")}</td><td className="text-right font-semibold">{money(r.p.amount, ctx.tenant.currency)}</td></tr>))}</tbody></table></div>}</Card>
    </div>
  );
}
