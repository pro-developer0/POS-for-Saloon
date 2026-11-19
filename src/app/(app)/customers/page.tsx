import { labelsOf } from "@/lib/verticals";
import Link from "next/link";
import { requireCtx } from "@/server/session";
import { listCustomers } from "@/server/services/crm";
import { Card, Empty, PageHeader, money } from "@/components/ui";
import { ActionButton, ModalForm } from "@/components/forms";
import { archiveCustomerAction, saveCustomerAction } from "@/app/actions";
import { fmtDate } from "@/lib/time";
import { CustomerFields } from "@/components/customer-fields";

export const metadata = { title: "Customers" };

export default async function Page({ searchParams }: { searchParams: Promise<{ q?: string; tag?: string; archived?: string }> }) {
  const ctx = await requireCtx("customers.view");
  const sp = await searchParams;
  const rows = await listCustomers(ctx, { q: sp.q, tag: sp.tag, archived: sp.archived === "1" });
  const can = ctx.perms.has("customers.manage"), tz = ctx.tenant.timezone;
  return (
    <div className="page-in">
      <PageHeader title={labelsOf(ctx.tenant).customers} desc="Profiles, visit history, loyalty and marketing consent." actions={can ? <ModalForm trigger="Add customer" title="New customer" action={saveCustomerAction} wide><CustomerFields /></ModalForm> : null} />
      <form className="card mb-4 flex flex-wrap gap-3 p-4">
        <input name="q" defaultValue={sp.q} className="input max-w-xs" placeholder="Search name, phone, email…" aria-label="Search" />
        <input name="tag" defaultValue={sp.tag} className="input max-w-[10rem]" placeholder="Tag" aria-label="Tag" />
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="archived" value="1" defaultChecked={sp.archived === "1"} />Archived</label>
        <button className="btn">Search</button>
      </form>
      <Card>
        {rows.length === 0 ? <Empty title="No customers found" desc="Add your first customer or adjust the filters." /> : (
          <div className="overflow-x-auto"><table className="tbl">
            <thead><tr><th>Name</th><th>Contact</th><th>Last visit</th><th>Next appt</th><th>Points</th><th className="text-right">Spent</th><th className="text-right">Owes</th><th /></tr></thead>
            <tbody>{rows.map(({ c, lastVisit, nextAppt, spent, balance }) => (
              <tr key={c.id}>
                <td><Link href={`/customers/${c.id}`} className="font-medium hover:text-brand">{c.name}</Link><div className="mt-0.5 flex gap-1">{c.tags.map((t) => <span key={t} className="badge">{t}</span>)}</div></td>
                <td className="text-muted">{c.phone ?? "—"}<span className="block text-xs">{c.email}</span></td>
                <td>{lastVisit ? fmtDate(lastVisit, tz) : "—"}</td><td>{nextAppt ? fmtDate(nextAppt, tz) : "—"}</td>
                <td>{c.loyaltyPoints}</td><td className="text-right">{money(spent, ctx.tenant.currency)}</td><td className="text-right">{Number(balance) > 0 ? <Link href={`/customers/${c.id}`} className="font-semibold text-warn hover:underline">{money(balance, ctx.tenant.currency)}</Link> : <span className="text-muted">—</span>}</td>
                <td className="text-right"><div className="flex justify-end gap-1.5">
                  {can && <ModalForm trigger="Edit" triggerClass="btn btn-sm" title={`Edit ${c.name}`} action={saveCustomerAction} wide><CustomerFields c={c} /></ModalForm>}
                  {can && <ActionButton action={archiveCustomerAction} args={[c.id, !c.archived]} confirm={c.archived ? undefined : `Archive ${c.name}? History is kept.`}>{c.archived ? "Restore" : "Archive"}</ActionButton>}
                </div></td>
              </tr>))}</tbody></table></div>
        )}
      </Card>
    </div>
  );
}
