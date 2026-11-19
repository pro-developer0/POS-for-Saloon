import Link from "next/link";
import { notFound } from "next/navigation";
import { requireCtx } from "@/server/session";
import { getInvoiceDetail } from "@/server/services/pos";
import { AppError } from "@/server/ctx";
import { StatusBadge, PageHeader, Field, money } from "@/components/ui";
import { ModalForm } from "@/components/forms";
import { PrintButton } from "@/components/print-button";
import { addPaymentAction, voidSaleAction } from "@/app/actions";
import { fmtDateTime } from "@/lib/time";

export const metadata = { title: "Invoice" };
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireCtx("invoices.view");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  let d; try { d = await getInvoiceDetail(ctx, id); } catch (e) { if (e instanceof AppError) notFound(); throw e; }
  const t = ctx.tenant, cur = t.currency, tz = t.timezone;
  const status = d.inv.cancelled ? "cancelled" : d.t.status === "paid" ? "paid" : d.t.status === "partial" ? "partially_paid" : "unpaid";
  const can = ctx.perms.has("invoices.manage");
  const bal = Number(d.balance);
  return (
    <div className="page-in">
      <PageHeader title={`Invoice ${d.inv.number}`} actions={<><Link href="/invoices" className="btn no-print">← Invoices</Link><PrintButton />
        {can && !d.inv.cancelled && bal > 0 && <ModalForm trigger="Record payment" title="Record payment" action={addPaymentAction}>
          <input type="hidden" name="transactionId" value={d.t.id} />
          <Field label="Method"><select name="method" className="input">{t.paymentMethods.map((m) => <option key={m} value={m}>{m.replace(/_/g, " ")}</option>)}</select></Field>
          <Field label={`Amount (balance ${money(d.balance, cur)})`}><input name="amount" type="number" step="0.01" min="0.01" max={d.balance} defaultValue={d.balance} className="input" required /></Field>
          <Field label="Note"><input name="note" className="input" /></Field></ModalForm>}
        {can && !d.inv.cancelled && Number(d.t.paid) === 0 && <ModalForm trigger="Void" triggerClass="btn btn-danger" title="Void this sale" action={voidSaleAction} submitLabel="Void sale">
          <input type="hidden" name="transactionId" value={d.t.id} /><Field label="Reason (required, kept in the audit log)"><input name="reason" required className="input" /></Field>
          <p className="text-xs text-muted">Product stock will be returned. Sales that already have payments cannot be voided.</p></ModalForm>}
      </>} />
      <article className="card mx-auto max-w-3xl p-6 sm:p-10" aria-label="Invoice document">
        <header className="flex flex-wrap items-start justify-between gap-4 border-b border-line pb-6">
          <div className="flex items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {t.logoUrl ? <img src={t.logoUrl} alt="" className="size-14 rounded-xl object-cover" /> : <div className="grid size-14 place-items-center rounded-xl bg-brand text-xl font-bold text-brandfg">{t.name[0]}</div>}
            <div><p className="text-lg font-bold">{t.name}</p><p className="text-xs text-muted">{[t.address, t.phone, t.email].filter(Boolean).join(" · ")}</p></div>
          </div>
          <div className="text-right"><p className="text-2xl font-bold text-brand">INVOICE</p><p className="text-sm font-semibold">{d.inv.number}</p><div className="mt-1"><StatusBadge status={status} /></div></div>
        </header>
        <div className="grid gap-4 py-6 text-sm sm:grid-cols-2">
          <div><p className="label">Billed to</p><p className="font-semibold">{d.customer?.name ?? "Walk-in customer"}</p><p className="text-muted">{d.customer?.phone}</p><p className="text-muted">{d.customer?.email}</p></div>
          <div className="sm:text-right"><p className="label">Issued</p><p>{fmtDateTime(d.inv.createdAt, tz, t.timeFormat === "12h")}</p>{d.inv.dueDate && status !== "paid" && <><p className="label mt-2">Due</p><p>{d.inv.dueDate}</p></>}</div>
        </div>
        <table className="tbl"><thead><tr><th>Item</th><th className="text-right">Qty</th><th className="text-right">Price</th><th className="text-right">Disc.</th><th className="text-right">Tax</th><th className="text-right">Total</th></tr></thead>
          <tbody>{d.items.map((i) => (<tr key={i.id}><td>{i.name}</td><td className="text-right">{i.quantity}</td><td className="text-right">{money(i.unitPrice, cur)}</td><td className="text-right">{Number(i.discount) ? money(i.discount, cur) : "—"}</td><td className="text-right">{Number(i.tax) ? money(i.tax, cur) : "—"}</td><td className="text-right font-medium">{money(i.lineTotal, cur)}</td></tr>))}</tbody></table>
        <dl className="ml-auto mt-5 w-full max-w-xs space-y-1.5 text-sm">
          <div className="flex justify-between"><dt className="text-muted">Subtotal</dt><dd>{money(d.t.subtotal, cur)}</dd></div>
          {Number(d.t.discount) > 0 && <div className="flex justify-between"><dt className="text-muted">Discounts</dt><dd>−{money(d.t.discount, cur)}</dd></div>}
          <div className="flex justify-between"><dt className="text-muted">{t.taxName}</dt><dd>{money(d.t.tax, cur)}</dd></div>
          <div className="flex justify-between border-t border-line pt-2 text-base font-bold"><dt>Total</dt><dd>{money(d.t.total, cur)}</dd></div>
          <div className="flex justify-between"><dt className="text-muted">Paid</dt><dd>{money(d.t.paid, cur)}</dd></div>
          <div className={`flex justify-between font-semibold ${bal > 0 ? "text-warn" : "text-ok"}`}><dt>Balance due</dt><dd>{money(d.balance, cur)}</dd></div>
        </dl>
        {d.payments.length > 0 && <section className="mt-8"><h3 className="label">Payment history</h3><ul className="divide-y divide-line text-sm">{d.payments.map((p) => (<li key={p.id} className="flex justify-between py-2"><span className="capitalize">{p.method.replace(/_/g, " ")} · {fmtDateTime(p.createdAt, tz, t.timeFormat === "12h")}{p.note && <span className="text-muted"> — {p.note}</span>}</span><span className="font-medium">{money(p.amount, cur)}</span></li>))}</ul></section>}
        {t.invoiceFooter && <footer className="mt-8 border-t border-line pt-4 text-center text-xs text-muted">{t.invoiceFooter}</footer>}
      </article>
    </div>
  );
}
