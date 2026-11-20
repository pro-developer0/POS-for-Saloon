import { requireCtx } from "@/server/session";
import { listProducts, listSuppliers, stockValuation, stockHistory } from "@/server/services/inventory";
import { Card, Empty, PageHeader, Field, Stat, money } from "@/components/ui";
import { ModalForm } from "@/components/forms";
import { adjustStockAction, saveProductAction } from "@/app/actions";
import { fmtDateTime } from "@/lib/time";

export const metadata = { title: "Inventory" };
type P = Awaited<ReturnType<typeof listProducts>>[number]["p"];

function ProductFields({ p, suppliers }: { p?: P; suppliers: { id: string; name: string }[] }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {p && <><input type="hidden" name="id" value={p.id} /><input type="hidden" name="activePresent" value="1" /></>}
      <div className="sm:col-span-2"><Field label="Product name"><input name="name" required className="input" defaultValue={p?.name} /></Field></div>
      <Field label="SKU"><input name="sku" className="input" defaultValue={p?.sku ?? ""} /></Field>
      <Field label="Category"><input name="category" className="input" defaultValue={p?.category ?? ""} /></Field>
      <Field label="Supplier"><select name="supplierId" className="input" defaultValue={p?.supplierId ?? ""}><option value="">None</option>{suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
      <Field label="Cost price"><input name="costPrice" type="number" step="0.01" min="0" className="input" defaultValue={p?.costPrice ?? "0"} /></Field>
      <Field label="Selling price"><input name="sellPrice" type="number" step="0.01" min="0" className="input" defaultValue={p?.sellPrice ?? "0"} /></Field>
      <Field label="Low-stock alert at"><input name="minStock" type="number" min="0" className="input" defaultValue={p?.minStock ?? 5} /></Field>
      {!p && <Field label="Opening quantity"><input name="initialQuantity" type="number" min="0" className="input" defaultValue="0" /></Field>}
      <div className="sm:col-span-2"><Field label="Description"><input name="description" className="input" defaultValue={p?.description ?? ""} /></Field></div>
      <div className="flex gap-5 text-sm sm:col-span-2"><label className="flex items-center gap-2"><input type="checkbox" name="taxable" defaultChecked={p?.taxable ?? true} />Taxable</label>{p && <label className="flex items-center gap-2"><input type="checkbox" name="active" defaultChecked={p.active} />Active</label>}</div>
    </div>
  );
}

export default async function Page({ searchParams }: { searchParams: Promise<{ q?: string; low?: string; history?: string }> }) {
  const ctx = await requireCtx("inventory.view", "inventory");
  const sp = await searchParams;
  const [rows, suppliers, val] = await Promise.all([listProducts(ctx, { q: sp.q, lowOnly: sp.low === "1" }), listSuppliers(ctx), stockValuation(ctx)]);
  const ok = (v?: string) => (v && /^[0-9a-f-]{36}$/.test(v) ? v : null);
  const hist = ok(sp.history) ? await stockHistory(ctx, sp.history!) : null;
  const can = ctx.perms.has("inventory.manage"), cur = ctx.tenant.currency;
  const q = (sp.q ?? "").toLowerCase();
  const shown = q ? rows.filter((r) => r.p.name.toLowerCase().includes(q) || (r.p.sku ?? "").toLowerCase().includes(q)) : rows;
  const lowCount = shown.filter((r) => r.p.quantity <= r.p.minStock).length;
  return (
    <div className="page-in">
      <PageHeader title="Inventory" desc="Every stock change is recorded in the movement history." actions={can ? <ModalForm trigger="Add product" title="New product" action={saveProductAction} wide><ProductFields suppliers={suppliers} /></ModalForm> : null} />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4"><Stat label="Products" value={shown.length} /><Stat label="Low stock" value={lowCount} tone={lowCount ? "warn" : undefined} /><Stat label="Stock value (cost)" value={money(val.cost, cur)} /><Stat label="Stock value (retail)" value={money(val.retail, cur)} /></div>
      <form className="card mb-4 flex flex-wrap gap-3 p-4"><input name="q" defaultValue={sp.q} className="input max-w-xs" placeholder="Search name or SKU…" aria-label="Search" /><label className="flex items-center gap-2 text-sm"><input type="checkbox" name="low" value="1" defaultChecked={sp.low === "1"} />Low stock only</label><button className="btn">Filter</button></form>
      <Card>
        {shown.length === 0 ? <Empty title="No products" desc="Add products to sell at the POS and track stock." /> : (
          <div className="overflow-x-auto"><table className="tbl"><thead><tr><th>Product</th><th>Supplier</th><th className="text-right">Cost</th><th className="text-right">Price</th><th className="text-right">Stock</th><th /></tr></thead>
            <tbody>{shown.map(({ p, supplierName }) => {
              const low = p.quantity <= p.minStock;
              return (
                <tr key={p.id} className={p.active ? "" : "opacity-50"}>
                  <td className="font-medium">{p.name}<span className="block text-xs font-normal text-muted">{p.category ?? ""}</span></td>
                  <td className="text-muted">{supplierName ?? "—"}</td>
                  <td className="text-right">{money(p.costPrice, cur)}</td><td className="text-right">{money(p.sellPrice, cur)}</td>
                  <td className="text-right"><span className={`badge ${low ? "bg-bad/15 text-bad" : ""}`}>{p.quantity}{low ? " · low" : ""}</span></td>
                  <td><div className="flex justify-end gap-1.5">
                    <a className="btn btn-sm" href={`/inventory?history=${p.id}`}>History</a>
                    {can && <ModalForm trigger="Adjust" triggerClass="btn btn-sm" title={`Adjust stock — ${p.name}`} action={adjustStockAction}>
                      <input type="hidden" name="productId" value={p.id} />
                      <Field label="Change in quantity (+ add / − remove)"><input name="delta" type="number" step="1" required className="input" /></Field>
                      <Field label="Reason"><select name="reason" className="input"><option value="adjustment">Stock count / adjustment</option><option value="purchase">Received stock</option><option value="damage">Damaged / lost</option></select></Field><Field label="Note"><input name="note" className="input" /></Field></ModalForm>}
                    {can && <ModalForm trigger="Edit" triggerClass="btn btn-sm" title={`Edit ${p.name}`} action={saveProductAction} wide><ProductFields p={p} suppliers={suppliers} /></ModalForm>}
                  </div></td></tr>); })}</tbody></table></div>
        )}
      </Card>
      {hist && (
        <Card title="Stock history" className="mt-4">
          {hist.length === 0 ? <p className="px-5 py-6 text-sm text-muted">No movements.</p> : <div className="overflow-x-auto"><table className="tbl"><thead><tr><th>When</th><th>Reason</th><th className="text-right">Change</th><th className="text-right">Balance</th><th>Note</th></tr></thead>
            <tbody>{hist.map((m) => (<tr key={m.id}><td>{fmtDateTime(m.createdAt, ctx.tenant.timezone)}</td><td className="capitalize">{m.reason}</td><td className={`text-right font-semibold ${m.delta < 0 ? "text-bad" : "text-ok"}`}>{m.delta > 0 ? "+" : ""}{m.delta}</td><td className="text-right">{m.balanceAfter}</td><td className="text-muted">{m.note}</td></tr>))}</tbody></table></div>}
        </Card>
      )}
    </div>
  );
}
