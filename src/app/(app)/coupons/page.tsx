import { requireCtx } from "@/server/session";
import { listCoupons } from "@/server/services/coupons";
import { Card, Empty, PageHeader, Field, StatusBadge, money } from "@/components/ui";
import { ActionButton, ModalForm } from "@/components/forms";
import { saveCouponAction, setCouponActiveAction } from "@/app/actions";
import type { coupons } from "@/db/schema";

export const metadata = { title: "Coupons" };
function CouponFields({ c }: { c?: typeof coupons.$inferSelect }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {c && <><input type="hidden" name="id" value={c.id} /><input type="hidden" name="activePresent" value="1" /></>}
      <Field label="Code" hint="Customers type this at checkout"><input name="code" required className="input uppercase" defaultValue={c?.code} placeholder="EID20" /></Field>
      <Field label="Description"><input name="description" className="input" defaultValue={c?.description ?? ""} /></Field>
      <Field label="Type"><select name="type" className="input" defaultValue={c?.type ?? "percent"}><option value="percent">Percent off</option><option value="fixed">Fixed amount off</option></select></Field>
      <Field label="Value"><input name="value" type="number" step="0.01" min="0.01" required className="input" defaultValue={c?.value} /></Field>
      <Field label="Minimum purchase"><input name="minSubtotal" type="number" step="0.01" min="0" className="input" defaultValue={c?.minSubtotal ?? "0"} /></Field>
      <Field label="Maximum uses" hint="Blank = unlimited"><input name="maxUses" type="number" min="1" className="input" defaultValue={c?.maxUses ?? ""} /></Field>
      <Field label="Expires on" hint="Blank = never"><input name="expiresOn" type="date" className="input" defaultValue={c?.expiresOn ?? ""} /></Field>
      {c && <label className="flex items-center gap-2 self-end text-sm"><input type="checkbox" name="active" defaultChecked={c.active} />Active</label>}
    </div>
  );
}
export default async function Page() {
  const ctx = await requireCtx("coupons.manage");
  const rows = await listCoupons(ctx); const cur = ctx.tenant.currency;
  return (
    <div className="page-in">
      <PageHeader title="Coupons" desc="Discount codes checked on the server at checkout. A used or expired code can never be applied." actions={<ModalForm trigger="New coupon" title="New coupon" action={saveCouponAction} wide><CouponFields /></ModalForm>} />
      <Card>
        {rows.length === 0 ? <Empty title="No coupons yet" desc="Create a code such as EID20 for 20% off." /> : (
          <div className="overflow-x-auto"><table className="tbl"><thead><tr><th>Code</th><th>Discount</th><th>Minimum</th><th>Used</th><th>Expires</th><th>Status</th><th /></tr></thead>
            <tbody>{rows.map((c) => {
              const spent = c.maxUses !== null && c.usedCount >= c.maxUses, expired = !!c.expiresOn && c.expiresOn < new Date().toISOString().slice(0, 10);
              return (
                <tr key={c.id}><td className="font-semibold">{c.code}{c.description && <span className="block text-xs font-normal text-muted">{c.description}</span>}</td>
                  <td>{c.type === "percent" ? `${Number(c.value)}% off` : `${money(c.value, cur)} off`}</td><td>{Number(c.minSubtotal) ? money(c.minSubtotal, cur) : "—"}</td>
                  <td>{c.usedCount}{c.maxUses !== null ? ` / ${c.maxUses}` : ""}</td><td>{c.expiresOn ?? "—"}</td>
                  <td><StatusBadge status={!c.active ? "cancelled" : spent || expired ? "pending" : "active"} />{(spent || expired) && c.active && <span className="ml-1 text-xs text-muted">{spent ? "used up" : "expired"}</span>}</td>
                  <td><div className="flex justify-end gap-1.5">
                    <ModalForm trigger="Edit" triggerClass="btn btn-sm" title={`Edit ${c.code}`} action={saveCouponAction} wide><CouponFields c={c} /></ModalForm>
                    <ActionButton action={setCouponActiveAction} args={[c.id, !c.active]}>{c.active ? "Turn off" : "Turn on"}</ActionButton>
                  </div></td></tr>); })}</tbody></table></div>
        )}
      </Card>
    </div>
  );
}
