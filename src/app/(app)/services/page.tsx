import { labelsOf } from "@/lib/verticals";
import { requireCtx } from "@/server/session";
import { listCategories, listServices, listStaff } from "@/server/services/crm";
import { Card, Empty, PageHeader, Field, StatusBadge, money } from "@/components/ui";
import { ActionButton, ModalForm } from "@/components/forms";
import { addCategoryAction, archiveServiceAction, moveServiceAction, saveServiceAction } from "@/app/actions";

export const metadata = { title: "Services" };

type Row = Awaited<ReturnType<typeof listServices>>[number];
function ServiceFields({ s, cats, staff }: { s?: Row; cats: { id: string; name: string }[]; staff: { id: string; name: string }[] }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {s && <input type="hidden" name="id" value={s.s.id} />}
      <div className="sm:col-span-2"><Field label="Service name"><input name="name" required className="input" defaultValue={s?.s.name} /></Field></div>
      <Field label="Category"><select name="categoryId" className="input" defaultValue={s?.s.categoryId ?? ""}><option value="">None</option>{cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
      <Field label="Duration (minutes)"><input name="durationMinutes" type="number" min="5" max="720" step="5" required className="input" defaultValue={s?.s.durationMinutes ?? 30} /></Field>
      <Field label="Price"><input name="price" type="number" min="0" step="0.01" required className="input" defaultValue={s?.s.price ?? ""} /></Field>
      <Field label="Commission % (0 = use staff rate)"><input name="commissionPct" type="number" min="0" max="100" step="0.01" className="input" defaultValue={s?.s.commissionPct ?? "0"} /></Field>
      <div className="sm:col-span-2"><Field label="Description"><textarea name="description" rows={2} className="input" defaultValue={s?.s.description ?? ""} /></Field></div>
      <fieldset className="sm:col-span-2"><legend className="label">Eligible staff (none selected = anyone)</legend>
        <div className="flex flex-wrap gap-3">{staff.map((st) => <label key={st.id} className="flex items-center gap-1.5 text-sm"><input type="checkbox" name="staffIds" value={st.id} defaultChecked={s?.staffIds.includes(st.id)} />{st.name}</label>)}</div></fieldset>
      <div className="flex flex-wrap gap-5 text-sm sm:col-span-2">
        <label className="flex items-center gap-2"><input type="checkbox" name="taxable" defaultChecked={s?.s.taxable ?? true} />Taxable</label>
        <label className="flex items-center gap-2"><input type="checkbox" name="bookable" defaultChecked={s?.s.bookable ?? true} />Available for booking</label>
        <label className="flex items-center gap-2"><input type="checkbox" name="active" defaultChecked={s?.s.active ?? true} />Active</label>
      </div>
    </div>
  );
}

export default async function Page() {
  const ctx = await requireCtx("services.view", "services");
  const [rows, cats, staff] = await Promise.all([listServices(ctx, true), listCategories(ctx), listStaff(ctx)]);
  const can = ctx.perms.has("services.manage"); const cur = ctx.tenant.currency;
  const catName = new Map(cats.map((c) => [c.id, c.name]));
  return (
    <div className="page-in">
      <PageHeader title={labelsOf().services} desc="Your service catalog. Prices are tax-exclusive." actions={can ? <>
        <ModalForm trigger="Add category" triggerClass="btn" title="New category" action={addCategoryAction}><Field label="Name"><input name="name" required className="input" /></Field></ModalForm>
        <ModalForm trigger="Add service" title="New service" action={saveServiceAction} wide><ServiceFields cats={cats} staff={staff} /></ModalForm></> : null} />
      <Card>
        {rows.length === 0 ? <Empty title="No services yet" desc="Add the services your business offers." /> : (
          <div className="overflow-x-auto"><table className="tbl"><thead><tr><th>Service</th><th>Category</th><th>Duration</th><th className="text-right">Price</th><th>Status</th><th /></tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={r.s.id} className={r.s.archived ? "opacity-50" : ""}>
                <td className="font-medium">{r.s.name}{r.s.description && <span className="block text-xs font-normal text-muted">{r.s.description}</span>}</td>
                <td>{r.s.categoryId ? catName.get(r.s.categoryId) : "—"}</td><td>{r.s.durationMinutes} min</td><td className="text-right">{money(r.s.price, cur)}</td>
                <td><StatusBadge status={r.s.archived ? "cancelled" : r.s.active ? "active" : "pending"} /></td>
                <td>{can && <div className="flex justify-end gap-1.5">
                  <ActionButton action={moveServiceAction} args={[r.s.id, -1]} className="btn btn-sm btn-ghost">↑</ActionButton>
                  <ActionButton action={moveServiceAction} args={[r.s.id, 1]} className="btn btn-sm btn-ghost">↓</ActionButton>
                  <ModalForm trigger="Edit" triggerClass="btn btn-sm" title={`Edit ${r.s.name}`} action={saveServiceAction} wide><ServiceFields s={r} cats={cats} staff={staff} /></ModalForm>
                  <ActionButton action={archiveServiceAction} args={[r.s.id, !r.s.archived]} confirm={r.s.archived ? undefined : "Archive this service? Past sales keep their history."}>{r.s.archived ? "Restore" : "Archive"}</ActionButton>
                </div>}</td>
              </tr>))}</tbody></table></div>
        )}
      </Card>
    </div>
  );
}
