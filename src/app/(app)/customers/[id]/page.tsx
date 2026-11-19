import Link from "next/link";
import { notFound } from "next/navigation";
import { requireCtx } from "@/server/session";
import { getCustomerProfile } from "@/server/services/crm";
import { customerOpenInvoices } from "@/server/services/ledger";
import { AppError } from "@/server/ctx";
import { Card, Empty, PageHeader, Stat, StatusBadge, money } from "@/components/ui";
import { ModalForm } from "@/components/forms";
import { loyaltyAction, receiveCustomerPaymentAction, saveCustomerAction } from "@/app/actions";
import { Field } from "@/components/ui";
import { CustomerFields } from "@/components/customer-fields";
import { fmtDate, fmtDateTime } from "@/lib/time";
import { fromCents, toCents } from "@/lib/money";

export const metadata = { title: "Customer" };
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireCtx("customers.view");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  let p; try { p = await getCustomerProfile(ctx, id); } catch (e) { if (e instanceof AppError) notFound(); throw e; }
  const { customer: c, appointments, sales } = p; const tz = ctx.tenant.timezone, cur = ctx.tenant.currency;
  const spent = fromCents(sales.filter((s) => s.status !== "cancelled").reduce((a, s) => a + toCents(s.paid), 0));
  const visits = appointments.filter((a) => a.a.status === "completed").length;
  const can = ctx.perms.has("customers.manage");
  const open = await customerOpenInvoices(ctx, id);
  const owes = open.reduce((a, o) => a + toCents(o.balance), 0);
  const canPay = ctx.perms.has("invoices.manage");
  return (
    <div className="page-in">
      <PageHeader title={c.name} desc={[c.phone, c.email].filter(Boolean).join(" · ") || "No contact details"} actions={<>
        <Link href="/customers" className="btn">← All customers</Link>
        {canPay && owes > 0 && <ModalForm trigger="Receive payment" triggerClass="btn btn-primary" title="Receive customer payment" action={receiveCustomerPaymentAction}>
          <input type="hidden" name="customerId" value={c.id} />
          <Field label={`Amount (owes ${money(fromCents(owes), cur)})`}><input name="amount" type="number" step="0.01" min="0.01" max={(owes / 100).toFixed(2)} defaultValue={(owes / 100).toFixed(2)} className="input" required /></Field>
          <Field label="Method"><select name="method" className="input">{ctx.tenant.paymentMethods.map((m) => <option key={m} value={m}>{m.replace(/_/g, " ")}</option>)}</select></Field>
          <Field label="Note"><input name="note" className="input" /></Field>
          <p className="text-xs text-muted">Applied to the oldest unpaid invoices first.</p></ModalForm>}
        {can && <ModalForm trigger="Edit" title="Edit customer" action={saveCustomerAction} wide triggerClass="btn"><CustomerFields c={c} /></ModalForm>}
        {can && <ModalForm trigger="Adjust points" title="Adjust loyalty points" action={loyaltyAction} triggerClass="btn">
          <input type="hidden" name="id" value={c.id} /><label className="label">Points to add (negative to subtract)</label><input name="delta" type="number" step="1" required className="input" /></ModalForm>}
      </>} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat label="Total paid" value={money(spent, cur)} /><Stat label="Completed visits" value={visits} />
        <Stat label="Owes (account balance)" value={money(fromCents(owes), cur)} tone={owes > 0 ? "warn" : undefined} hint={c.creditLimit !== null ? `Credit limit ${money(c.creditLimit, cur)}` : "No credit limit"} /><Stat label="Loyalty points" value={c.loyaltyPoints} /><Stat label="Marketing consent" value={c.marketingConsent ? "Yes" : "No"} tone={c.marketingConsent ? "ok" : undefined} />
      </div>
      {(c.notes || c.preferences || c.tags.length > 0) && (
        <Card className="mt-4 p-5 text-sm"><div className="flex flex-wrap gap-1.5">{c.tags.map((t) => <span key={t} className="badge">{t}</span>)}</div>
          {c.preferences && <p className="mt-3"><b>Preferences:</b> {c.preferences}</p>}{c.notes && <p className="mt-2"><b>Notes:</b> {c.notes}</p>}</Card>
      )}
      {open.length > 0 && <Card title="Unpaid invoices" className="mt-4"><div className="overflow-x-auto"><table className="tbl"><tbody>{open.map(({ t: tr, number, balance }) => (<tr key={tr.id}><td><Link href={`/invoices/${tr.id}`} className="font-semibold hover:text-brand">{number}</Link></td><td>{fmtDate(tr.createdAt, tz)}</td><td><StatusBadge status={tr.status === "partial" ? "partially_paid" : "unpaid"} /></td><td className="text-right font-semibold text-warn">{money(balance, cur)}</td></tr>))}</tbody></table></div></Card>}
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card title="Appointment history">
          {appointments.length === 0 ? <Empty title="No appointments yet" /> : <div className="overflow-x-auto"><table className="tbl"><tbody>{appointments.map(({ a, serviceName, staffName }) => (
            <tr key={a.id}><td>{fmtDateTime(a.startsAt, tz)}<span className="block text-xs text-muted">{serviceName} · {staffName}</span></td><td><StatusBadge status={a.status} /></td></tr>))}</tbody></table></div>}
        </Card>
        <Card title="Purchase history">
          {sales.length === 0 ? <Empty title="No purchases yet" /> : <div className="overflow-x-auto"><table className="tbl"><tbody>{sales.map((s) => (
            <tr key={s.id}><td><Link href={`/invoices/${s.id}`} className="font-medium hover:text-brand">{fmtDate(s.createdAt, tz)}</Link></td><td><StatusBadge status={s.status} /></td><td className="text-right font-semibold">{money(s.total, cur)}</td></tr>))}</tbody></table></div>}
        </Card>
      </div>
    </div>
  );
}
