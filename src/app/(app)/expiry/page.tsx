import Link from "next/link";
import { requireCtx } from "@/server/session";
import { expiryReport, expirySummary } from "@/server/services/batches";
import { Card, Empty, PageHeader, Stat } from "@/components/ui";
import { ActionButton } from "@/components/forms";
import { writeOffBatchAction } from "@/app/actions";

export const metadata = { title: "Expiry alerts" };
export default async function Page({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  const ctx = await requireCtx("inventory.view", "batches");
  const sp = await searchParams;
  const days = [30, 60, 90].includes(Number(sp.days)) ? Number(sp.days) : 90;
  const all = await expiryReport(ctx, 90);
  const s = expirySummary(all);
  const rows = all.filter((r) => r.daysLeft <= days);
  const can = ctx.perms.has("inventory.manage");
  return (
    <div className="page-in">
      <PageHeader title="Expiry alerts" desc="Batches that are expired or close to expiry. Expired stock can never be sold at the POS." actions={
        <div className="flex rounded-lg border border-line p-0.5">{[30, 60, 90].map((d) => <Link key={d} href={`/expiry?days=${d}`} className={`rounded-md px-3 py-1 text-xs font-semibold ${d === days ? "bg-brand text-brandfg" : "text-muted"}`}>{d} days</Link>)}</div>} />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Expired (still in stock)" value={s.expired} tone={s.expired ? "bad" : undefined} />
        <Stat label="Expire within 30 days" value={s.d30} tone={s.d30 ? "warn" : undefined} />
        <Stat label="31 – 60 days" value={s.d60} /><Stat label="61 – 90 days" value={s.d90} />
      </div>
      <Card>
        {rows.length === 0 ? <Empty title="Nothing expiring in this window" desc="Batches with stock that expire soon will appear here." /> : (
          <div className="overflow-x-auto"><table className="tbl">
            <thead><tr><th>Medicine</th><th>Batch</th><th>Expiry</th><th>Status</th><th className="text-right">Units left</th><th /></tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={r.batchId}>
                <td className="font-medium">{r.name}{(r.genericName || r.strength) && <span className="block text-xs font-normal text-muted">{[r.genericName, r.strength].filter(Boolean).join(" · ")}</span>}</td>
                <td className="text-muted">{r.batchNo}</td><td>{r.expiryDate}</td>
                <td>{r.daysLeft < 0 ? <span className="badge bg-bad/15 text-bad">Expired {-r.daysLeft} day{r.daysLeft === -1 ? "" : "s"} ago</span>
                  : r.daysLeft <= 30 ? <span className="badge bg-warn/15 text-warn">{r.daysLeft} day{r.daysLeft === 1 ? "" : "s"} left</span> : <span className="badge">{r.daysLeft} days left</span>}</td>
                <td className="text-right font-semibold">{r.quantity}</td>
                <td className="text-right">{can && r.daysLeft < 0 && <ActionButton action={writeOffBatchAction} args={[r.batchId]} confirm={`Write off ${r.quantity} expired unit(s) of ${r.name} (batch ${r.batchNo})? This is recorded in stock history.`} className="btn btn-sm btn-danger">Write off</ActionButton>}</td>
              </tr>))}</tbody></table></div>
        )}
      </Card>
    </div>
  );
}
