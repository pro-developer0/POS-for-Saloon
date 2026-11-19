import { requireCtx } from "@/server/session";
import { listSuppliers } from "@/server/services/inventory";
import { Card, Empty, PageHeader, Field } from "@/components/ui";
import { ModalForm } from "@/components/forms";
import { saveSupplierAction } from "@/app/actions";
import type { suppliers } from "@/db/schema";

export const metadata = { title: "Suppliers" };
function SupplierFields({ s }: { s?: typeof suppliers.$inferSelect }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {s && <input type="hidden" name="id" value={s.id} />}
      <div className="sm:col-span-2"><Field label="Supplier name"><input name="name" required className="input" defaultValue={s?.name} /></Field></div>
      <Field label="Contact person"><input name="contactName" className="input" defaultValue={s?.contactName ?? ""} /></Field>
      <Field label="Phone"><input name="phone" className="input" defaultValue={s?.phone ?? ""} /></Field>
      <Field label="Email"><input name="email" type="email" className="input" defaultValue={s?.email ?? ""} /></Field>
      <Field label="Address"><input name="address" className="input" defaultValue={s?.address ?? ""} /></Field>
      <div className="sm:col-span-2"><Field label="Notes"><textarea name="notes" rows={2} className="input" defaultValue={s?.notes ?? ""} /></Field></div>
    </div>
  );
}
export default async function Page() {
  const ctx = await requireCtx("inventory.view");
  const rows = await listSuppliers(ctx);
  const can = ctx.perms.has("suppliers.manage");
  return (
    <div className="page-in">
      <PageHeader title="Suppliers" actions={can ? <ModalForm trigger="Add supplier" title="New supplier" action={saveSupplierAction} wide><SupplierFields /></ModalForm> : null} />
      <Card>{rows.length === 0 ? <Empty title="No suppliers yet" /> : <div className="overflow-x-auto"><table className="tbl"><thead><tr><th>Name</th><th>Contact</th><th>Phone</th><th>Email</th><th /></tr></thead>
        <tbody>{rows.map((s) => (<tr key={s.id}><td className="font-medium">{s.name}</td><td>{s.contactName}</td><td>{s.phone}</td><td>{s.email}</td><td className="text-right">{can && <ModalForm trigger="Edit" triggerClass="btn btn-sm" title={`Edit ${s.name}`} action={saveSupplierAction} wide><SupplierFields s={s} /></ModalForm>}</td></tr>))}</tbody></table></div>}</Card>
    </div>
  );
}
