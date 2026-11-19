import { requireCtx } from "@/server/session";
import { closePreview, listCloses } from "@/server/services/dayclose";
import { Card, Empty, PageHeader, Stat, money } from "@/components/ui";
import { ModalForm } from "@/components/forms";
import { CloseFields } from "@/components/close-form";
import { closeShiftAction } from "@/app/actions";
import { fmtDateTime } from "@/lib/time";
import { fromCents } from "@/lib/money";

export const metadata = { title: "Day close" };
export default async function Page() {
  const ctx = await requireCtx("pos.use");
  const [pre, history] = await Promise.all([closePreview(ctx), listCloses(ctx)]);
  const cur = ctx.tenant.currency, tz = ctx.tenant.timezone, h12 = ctx.tenant.timeFormat === "12h";
  const m = (cents: number) => money(fromCents(cents), cur);
  const x = pre.totals;
  return (
    <div className="page-in">
      <PageHeader title="Day close" desc={`Since ${fmtDateTime(pre.periodStart, tz, h12)}${pre.hasPrevious ? " (the last close)" : " (start of today)"}. Each close starts where the previous one ended.`}
        actions={<ModalForm trigger="Close the till" title="Close shift / day" action={closeShiftAction} submitLabel="Save close">
          <CloseFields defaultFloat={pre.lastCounted} cashIn={x.cashIn} cashExpenses={x.cashExpenses} currency={cur} />
        </ModalForm>} />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Sales" value={x.salesCount} hint={`${m(x.grossSales)} gross`} /><Stat label="Returns / refunds" value={m(x.returns)} tone={x.returns ? "warn" : undefined} />
        <Stat label="Net sales" value={m(x.netSales)} /><Stat label="Cash movement" value={m(x.cashIn - x.cashExpenses)} hint={`${m(x.cashIn)} in · ${m(x.cashExpenses)} cash expenses`} />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Payments by method (refunds subtracted)">
          {x.byMethod.length === 0 ? <p className="px-5 py-6 text-sm text-muted">No payments in this period.</p> : <table className="tbl"><tbody>{x.byMethod.map((p) => <tr key={p.method}><td className="capitalize">{p.method.replace(/_/g, " ")}</td><td className="text-right font-semibold">{m(p.total)}</td></tr>)}</tbody></table>}
        </Card>
        <Card title="Other totals"><dl className="space-y-2 p-5 text-sm"><div className="flex justify-between"><dt className="text-muted">Discounts given</dt><dd>{m(x.discounts)}</dd></div><div className="flex justify-between"><dt className="text-muted">{ctx.tenant.taxName} collected (net of returns)</dt><dd>{m(x.tax)}</dd></div></dl></Card>
      </div>
      <Card title="Previous closes" className="mt-4">
        {history.length === 0 ? <Empty title="No closes yet" desc="Close the till at the end of each shift or day to keep a cash record." /> : (
          <div className="overflow-x-auto"><table className="tbl"><thead><tr><th>Closed</th><th className="text-right">Expected</th><th className="text-right">Counted</th><th className="text-right">Difference</th><th>Note</th></tr></thead>
            <tbody>{history.map((h) => { const diff = Number(h.difference); return (
              <tr key={h.id}><td>{fmtDateTime(h.closedAt, tz, h12)}</td><td className="text-right">{money(h.expectedCash, cur)}</td><td className="text-right">{money(h.countedCash, cur)}</td>
                <td className={`text-right font-semibold ${diff === 0 ? "text-ok" : "text-bad"}`}>{diff === 0 ? "Balanced" : money(h.difference, cur)}</td><td className="text-muted">{h.note}</td></tr>); })}</tbody></table></div>
        )}
      </Card>
    </div>
  );
}
