import { requireCtx } from "@/server/session";
import { listProducts, listPurchases, listSuppliers } from "@/server/services/inventory";
import { Card, Empty, PageHeader, Field, StatusBadge, money } from "@/components/ui";
import { ActionButton, ModalForm } from "@/components/forms";
import { cancelPurchaseAction, createPurchaseAction, receivePurchaseAction } from "@/app/actions";
import { fmtDate } from "@/lib/time";

export const metadata = { title: "Purchases" };
export default async function Page() {
  const ctx = await requireCtx("inventory.view", "purchases");
  const [rows, sups, prods] = await Promise.all([listPurchases(ctx), listSuppliers(ctx), listProducts(ctx)]);
  const can = ctx.perms.has("suppliers.manage"), cur = ctx.tenant.currency;
  return (
    <div className="page-in">
      <PageHeader title="Purchases" desc="Purchase orders. Receiving an order adds stock and records a movement." actions={can ? (
        <ModalForm trigger="New purchase order" title="New purchase order" action={createPurchaseAction}>
          <Field label="Supplier"><select name="supplierId" required className="input"><option value="">Select…</option>{sups.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
          <Field label="Product"><select name="productId" required className="input"><option value="">Select…</option>{prods.map(({ p }) => <option key={p.id} value={p.id}>{p.name} (stock {p.quantity})</option>)}</select></Field>
          <div className="grid grid-cols-2 gap-3"><Field label="Quantity"><input name="quantity" type="number" min="1" required className="input" /></Field><Field label="Unit cost"><input name="unitCost" type="number" min="0" step="0.01" required className="input" /></Field></div>
          <Field label="Reference"><input name="reference" className="input" /></Field>
        </ModalForm>) : null} />
      <Card>{rows.length === 0 ? <Empty title="No purchase orders" /> : <div className="overflow-x-auto"><table className="tbl"><thead><tr><th>Ordered</th><th>Supplier</th><th>Reference</th><th>Status</th><th className="text-right">Total</th><th /></tr></thead>
        <tbody>{rows.map(({ p, supplierName }) => (<tr key={p.id}><td>{fmtDate(p.orderedAt, ctx.tenant.timezone)}</td><td className="font-medium">{supplierName}</td><td className="text-muted">{p.reference}</td><td><StatusBadge status={p.status === "ordered" ? "pending" : p.status === "received" ? "completed" : "cancelled"} /></td><td className="text-right">{money(p.total, cur)}</td>
          <td><div className="flex justify-end gap-1.5">{can && p.status === "ordered" && <><ActionButton className="btn btn-sm btn-primary" action={receivePurchaseAction} args={[p.id]} success="Stock received">Receive stock</ActionButton><ActionButton action={cancelPurchaseAction} args={[p.id]} confirm="Cancel this purchase order?">Cancel</ActionButton></>}</div></td></tr>))}</tbody></table></div>}</Card>
    </div>
  );
}
