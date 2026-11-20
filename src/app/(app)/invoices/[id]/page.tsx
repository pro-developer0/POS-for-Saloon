import Link from "next/link";
import { notFound } from "next/navigation";
import { requireCtx } from "@/server/session";
import { getInvoiceDetail } from "@/server/services/pos";
import { listCreditNotes, returnableLines } from "@/server/services/returns";
import { AppError } from "@/server/ctx";
import { StatusBadge, PageHeader, Field, money } from "@/components/ui";
import { ModalForm } from "@/components/forms";
import { PrintButton } from "@/components/print-button";
import { addPaymentAction, createReturnAction, voidSaleAction } from "@/app/actions";
import { fmtDateTime } from "@/lib/time";
import { toCents, fromCents } from "@/lib/money";

export const metadata = { title: "Invoice" };
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireCtx("invoices.view");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  let d; try { d = await getInvoiceDetail(ctx, id); } catch (e) { if (e instanceof AppError) notFound(); throw e; }
  const t = ctx.tenant, cur = t.currency, tz = t.timezone;
  const isNote = d.t.kind === "return";
  const [lines, notes] = isNote ? [[], []] : await Promise.all([returnableLines(ctx, id), listCreditNotes(ctx, id)]);
  const returnable = lines.filter((l) => l.returnable > 0);
  const status = isNote ? "credit_note" : d.inv.cancelled ? "cancelled" : Number(d.balance) === 0 ? "paid" : toCents(d.t.paid) > 0 ? "partially_paid" : "unpaid";
  const can = ctx.perms.has("invoices.manage"), canRefund = ctx.perms.has("sales.refund");
  const bal = Number(d.balance);
  const title = isNote ? `Credit note ${d.inv.number}` : `Invoice ${d.inv.number}`;
  const returnedTotal = notes.reduce((a, n) => a + toCents(n.t.total), 0); // negative
  return (
    <div className="page-in">
      <PageHeader title={title} actions={<><Link href="/invoices" className="btn no-print">← Invoices</Link><PrintButton />
        <a className="btn no-print" href={`/receipt/${d.t.id}`} target="_blank" rel="noopener noreferrer">Thermal receipt</a>
        {canRefund && !isNote && !d.inv.cancelled && returnable.length > 0 && (
          <ModalForm trigger="Return items" triggerClass="btn" title="Return / refund items" action={createReturnAction} submitLabel="Issue credit note" wide>
            <input type="hidden" name="saleId" value={d.t.id} /><input type="hidden" name="idempotencyKey" value={crypto.randomUUID()} />
            <div className="overflow-x-auto"><table className="tbl"><thead><tr><th>Item</th><th className="text-right">Sold</th><th className="text-right">Returned</th><th className="text-right">Return qty</th><th>Back to stock</th></tr></thead>
              <tbody>{lines.map(({ item, returned, returnable: rb }) => (
                <tr key={item.id}><td>{item.name}</td><td className="text-right">{item.quantity}</td><td className="text-right">{returned}</td>
                  <td className="text-right"><input name={`qty_${item.id}`} type="number" min="0" max={rb} defaultValue="0" disabled={rb === 0} className="input !h-8 w-20 text-right" aria-label={`Return quantity for ${item.name}`} /></td>
                  <td>{item.kind === "product" ? <label className="flex items-center gap-1.5 text-xs"><input type="checkbox" name={`restock_${item.id}`} defaultChecked />Restock</label> : <span className="text-xs text-muted">—</span>}</td></tr>))}</tbody></table></div>
            <p className="text-xs text-muted">The refund amount is worked out from what the customer actually paid for each item (discount and tax included). If the customer still owes money on this sale, that is cancelled first and only the rest is paid back.</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Refund paid by"><select name="refundMethod" className="input">{t.paymentMethods.map((m) => <option key={m} value={m}>{m.replace(/_/g, " ")}</option>)}</select></Field>
              <Field label="Reason (required)"><input name="reason" required minLength={3} className="input" placeholder="e.g. wrong item, unhappy with service" /></Field>
            </div>
          </ModalForm>
        )}
        {can && !isNote && !d.inv.cancelled && bal > 0 && <ModalForm trigger="Record payment" title="Record payment" action={addPaymentAction}>
          <input type="hidden" name="transactionId" value={d.t.id} />
          <Field label="Method"><select name="method" className="input">{t.paymentMethods.map((m) => <option key={m} value={m}>{m.replace(/_/g, " ")}</option>)}</select></Field>
          <Field label={`Amount (balance ${money(d.balance, cur)})`}><input name="amount" type="number" step="0.01" min="0.01" max={d.balance} defaultValue={d.balance} className="input" required /></Field>
          <Field label="Note"><input name="note" className="input" /></Field></ModalForm>}
        {can && !isNote && !d.inv.cancelled && Number(d.t.paid) === 0 && notes.length === 0 && <ModalForm trigger="Void" triggerClass="btn btn-danger" title="Void this sale" action={voidSaleAction} submitLabel="Void sale">
          <input type="hidden" name="transactionId" value={d.t.id} /><Field label="Reason (required, kept in the audit log)"><input name="reason" required className="input" /></Field>
          <p className="text-xs text-muted">Product stock will be returned. Sales that already have payments cannot be voided; use Return items instead.</p></ModalForm>}
      </>} />
      <article className="card mx-auto max-w-3xl p-6 sm:p-10" aria-label="Invoice document">
        <header className="flex flex-wrap items-start justify-between gap-4 border-b border-line pb-6">
          <div className="flex items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {t.logoUrl ? <img src={t.logoUrl} alt="" className="size-14 rounded-xl object-cover" /> : <div className="grid size-14 place-items-center rounded-xl bg-brand text-xl font-bold text-brandfg">{t.name[0]}</div>}
            <div><p className="text-lg font-bold">{t.name}</p><p className="text-xs text-muted">{[t.address, t.phone, t.email].filter(Boolean).join(" · ")}</p></div>
          </div>
          <div className="text-right"><p className="text-2xl font-bold text-brand">{isNote ? "CREDIT NOTE" : "INVOICE"}</p><p className="text-sm font-semibold">{d.inv.number}</p><div className="mt-1"><StatusBadge status={status} /></div>
            {isNote && d.refInvoice && <p className="mt-1 text-xs text-muted">For invoice <Link className="font-semibold text-brand" href={`/invoices/${d.refInvoice.id}`}>{d.refInvoice.number}</Link></p>}</div>
        </header>
        <div className="grid gap-4 py-6 text-sm sm:grid-cols-2">
          <div><p className="label">{isNote ? "Refunded to" : "Billed to"}</p><p className="font-semibold">{d.customer?.name ?? "Walk-in customer"}</p><p className="text-muted">{d.customer?.phone}</p><p className="text-muted">{d.customer?.email}</p></div>
          <div className="sm:text-right"><p className="label">Issued</p><p>{fmtDateTime(d.inv.createdAt, tz, t.timeFormat === "12h")}</p>{d.inv.dueDate && status !== "paid" && !isNote && <><p className="label mt-2">Due</p><p>{d.inv.dueDate}</p></>}
            {isNote && d.t.returnReason && <><p className="label mt-2">Reason</p><p>{d.t.returnReason}</p></>}</div>
        </div>
        <table className="tbl"><thead><tr><th>Item</th><th className="text-right">Qty</th><th className="text-right">Price</th><th className="text-right">Disc.</th><th className="text-right">Tax</th><th className="text-right">Total</th></tr></thead>
          <tbody>{d.items.map((i) => (<tr key={i.id}><td>{i.name}</td><td className="text-right">{i.quantity}</td><td className="text-right">{money(i.unitPrice, cur)}</td><td className="text-right">{Number(i.discount) ? money(i.discount, cur) : "—"}</td><td className="text-right">{Number(i.tax) ? money(i.tax, cur) : "—"}</td><td className="text-right font-medium">{money(i.lineTotal, cur)}</td></tr>))}</tbody></table>
        <dl className="ml-auto mt-5 w-full max-w-xs space-y-1.5 text-sm">
          <div className="flex justify-between"><dt className="text-muted">Subtotal</dt><dd>{money(d.t.subtotal, cur)}</dd></div>
          {Number(d.t.discount) !== 0 && <div className="flex justify-between"><dt className="text-muted">Discounts{d.t.couponCode ? ` (coupon ${d.t.couponCode})` : ""}</dt><dd>{money(-Number(d.t.discount), cur)}</dd></div>}
          <div className="flex justify-between"><dt className="text-muted">{t.taxName}</dt><dd>{money(d.t.tax, cur)}</dd></div>
          <div className="flex justify-between border-t border-line pt-2 text-base font-bold"><dt>Total</dt><dd>{money(d.t.total, cur)}</dd></div>
          {isNote ? (
            <>
              <div className="flex justify-between"><dt className="text-muted">Refunded in cash/card</dt><dd>{money(-Number(d.t.paid), cur)}</dd></div>
              {toCents(d.t.total) - toCents(d.t.paid) !== 0 && <div className="flex justify-between"><dt className="text-muted">Taken off customer balance</dt><dd>{money(-(toCents(d.t.total) - toCents(d.t.paid)) / 100, cur)}</dd></div>}
            </>
          ) : (
            <>
              <div className="flex justify-between"><dt className="text-muted">Paid</dt><dd>{money(d.t.paid, cur)}</dd></div>
              {returnedTotal !== 0 && <div className="flex justify-between"><dt className="text-muted">Returned</dt><dd>{money(fromCents(returnedTotal), cur)}</dd></div>}
              <div className={`flex justify-between font-semibold ${bal > 0 ? "text-warn" : "text-ok"}`}><dt>Balance due</dt><dd>{money(d.balance, cur)}</dd></div>
            </>
          )}
        </dl>
        {d.payments.length > 0 && <section className="mt-8"><h3 className="label">Payment history</h3><ul className="divide-y divide-line text-sm">{d.payments.map((p) => (<li key={p.id} className="flex justify-between py-2"><span className="capitalize">{p.method.replace(/_/g, " ")} · {fmtDateTime(p.createdAt, tz, t.timeFormat === "12h")}{p.note && <span className="text-muted"> — {p.note}</span>}</span><span className={`font-medium ${Number(p.amount) < 0 ? "text-bad" : ""}`}>{money(p.amount, cur)}</span></li>))}</ul></section>}
        {notes.length > 0 && <section className="mt-8 no-print"><h3 className="label">Credit notes (returns)</h3><ul className="divide-y divide-line text-sm">{notes.map((n) => (<li key={n.t.id} className="flex justify-between py-2"><Link className="font-semibold text-brand" href={`/invoices/${n.t.id}`}>{n.number}</Link><span className="text-muted">{n.t.returnReason}</span><span className="font-medium text-bad">{money(n.t.total, cur)}</span></li>))}</ul></section>}
        {t.invoiceFooter && <footer className="mt-8 border-t border-line pt-4 text-center text-xs text-muted">{t.invoiceFooter}</footer>}
      </article>
    </div>
  );
}
