import { requireCtx } from "@/server/session";
import { listProducts, listSuppliers, stockValuation, stockHistory } from "@/server/services/inventory";
import { batchesByProduct, batchesOn, listBatches, sellableMap, todayLocal } from "@/server/services/batches";
import { Card, Empty, PageHeader, Field, Stat, money } from "@/components/ui";
import { ActionButton, ModalForm } from "@/components/forms";
import { adjustStockAction, saveProductAction, writeOffBatchAction } from "@/app/actions";
import { fmtDateTime } from "@/lib/time";

export const metadata = { title: "Inventory" };
type P = Awaited<ReturnType<typeof listProducts>>[number]["p"];

function ProductFields({ p, suppliers, batched }: { p?: P; suppliers: { id: string; name: string }[]; batched: boolean }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <input type="hidden" name="trackStockPresent" value="1" />
      {p && <><input type="hidden" name="id" value={p.id} /><input type="hidden" name="activePresent" value="1" /></>}
      <div className="sm:col-span-2"><Field label="Product name (brand)"><input name="name" required className="input" defaultValue={p?.name} /></Field></div>
      {batched && <>
        <Field label="Generic / salt name"><input name="genericName" className="input" defaultValue={p?.genericName ?? ""} placeholder="e.g. Paracetamol" /></Field>
        <Field label="Strength"><input name="strength" className="input" defaultValue={p?.strength ?? ""} placeholder="e.g. 500 mg" /></Field>
        <Field label="Form"><input name="dosageForm" list="forms" className="input" defaultValue={p?.dosageForm ?? ""} placeholder="Tablet, Syrup…" /><datalist id="forms">{["Tablet", "Capsule", "Syrup", "Injection", "Ointment", "Cream", "Drops", "Inhaler", "Sachet"].map((f) => <option key={f} value={f} />)}</datalist></Field>
      </>}
      <Field label="SKU"><input name="sku" className="input" defaultValue={p?.sku ?? ""} /></Field>
      <Field label="Category"><input name="category" className="input" defaultValue={p?.category ?? ""} /></Field>
      <Field label="Supplier"><select name="supplierId" className="input" defaultValue={p?.supplierId ?? ""}><option value="">None</option>{suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
      <Field label="Cost price (per unit)"><input name="costPrice" type="number" step="0.01" min="0" className="input" defaultValue={p?.costPrice ?? "0"} /></Field>
      <Field label="Selling price (per unit)"><input name="sellPrice" type="number" step="0.01" min="0" className="input" defaultValue={p?.sellPrice ?? "0"} /></Field>
      <Field label="Minimum stock (units)"><input name="minStock" type="number" min="0" className="input" defaultValue={p?.minStock ?? 5} /></Field>
      <fieldset className="grid gap-4 rounded-xl border border-line p-3 sm:col-span-2 sm:grid-cols-4">
        <legend className="px-1 text-xs font-semibold text-muted">Units and packs (optional) — stock is always counted in single units</legend>
        <Field label="Unit name"><input name="unitLabel" className="input" defaultValue={p?.unitLabel ?? "unit"} placeholder="tablet, bottle…" /></Field>
        <Field label="Pack name"><input name="packLabel" className="input" defaultValue={p?.packLabel ?? ""} placeholder="strip, box…" /></Field>
        <Field label="Units per pack"><input name="unitsPerPack" type="number" min="1" className="input" defaultValue={p?.unitsPerPack ?? 1} /></Field>
        <Field label="Pack price" hint="Blank = unit price × units"><input name="packPrice" type="number" step="0.01" min="0" className="input" defaultValue={p?.packPrice ?? ""} /></Field>
      </fieldset>
      {!p && <Field label="Opening quantity (units)"><input name="initialQuantity" type="number" min="0" className="input" defaultValue="0" /></Field>}
      {!p && batched && <>
        <Field label="Opening batch number" hint="Required if opening quantity > 0"><input name="batchNo" className="input" /></Field>
        <Field label="Opening batch expiry" hint="Required if opening quantity > 0"><input name="openingExpiry" type="date" className="input" /></Field>
      </>}
      <div className="sm:col-span-2"><Field label="Description"><input name="description" className="input" defaultValue={p?.description ?? ""} /></Field></div>
      <div className="flex gap-5 text-sm sm:col-span-2"><label className="flex items-center gap-2"><input type="checkbox" name="taxable" defaultChecked={p?.taxable ?? true} />Taxable</label><label className="flex items-center gap-2"><input type="checkbox" name="trackStock" defaultChecked={p?.trackStock ?? true} />Track stock</label>{p && <label className="flex items-center gap-2"><input type="checkbox" name="active" defaultChecked={p.active} />Active</label>}</div>
    </div>
  );
}

export default async function Page({ searchParams }: { searchParams: Promise<{ q?: string; low?: string; history?: string; batches?: string }> }) {
  const ctx = await requireCtx("inventory.view", "inventory");
  const sp = await searchParams;
  const batched = batchesOn(ctx);
  const [rows, suppliers, val] = await Promise.all([listProducts(ctx, { q: sp.q, lowOnly: sp.low === "1" }), listSuppliers(ctx), stockValuation(ctx)]);
  const sm = batched ? await sellableMap(ctx) : new Map<string, { sellable: number; expired: number; nearest: string | null }>();
  const byProd = batched ? await batchesByProduct(ctx) : new Map();
  const ok = (v?: string) => (v && /^[0-9a-f-]{36}$/.test(v) ? v : null);
  const hist = ok(sp.history) ? await stockHistory(ctx, sp.history!) : null;
  const batchRows = ok(sp.batches) && batched ? await listBatches(ctx, sp.batches!) : null;
  const can = ctx.perms.has("inventory.manage"), cur = ctx.tenant.currency, today = todayLocal(ctx);
  const q = (sp.q ?? "").toLowerCase();
  const shown = q ? rows.filter((r) => `${r.p.name} ${r.p.genericName ?? ""} ${r.p.strength ?? ""}`.toLowerCase().includes(q) || (r.p.sku ?? "").toLowerCase().includes(q)) : rows;
  const lowCount = shown.filter((r) => r.p.trackStock && r.p.quantity <= r.p.minStock).length;
  return (
    <div className="page-in">
      <PageHeader title="Inventory" desc="Every stock change is recorded in the movement history." actions={can ? <ModalForm trigger="Add product" title="New product" action={saveProductAction} wide><ProductFields suppliers={suppliers} batched={batched} /></ModalForm> : null} />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4"><Stat label="Products" value={shown.length} /><Stat label="Low stock" value={lowCount} tone={lowCount ? "warn" : undefined} /><Stat label="Stock value (cost)" value={money(val.cost, cur)} /><Stat label="Stock value (retail)" value={money(val.retail, cur)} /></div>
      <form className="card mb-4 flex flex-wrap gap-3 p-4"><input name="q" defaultValue={sp.q} className="input max-w-xs" placeholder="Search name, generic, strength, SKU…" aria-label="Search" /><label className="flex items-center gap-2 text-sm"><input type="checkbox" name="low" value="1" defaultChecked={sp.low === "1"} />Low stock only</label><button className="btn">Filter</button></form>
      <Card>
        {shown.length === 0 ? <Empty title="No products" desc="Add products to sell at the POS and track stock." /> : (
          <div className="overflow-x-auto"><table className="tbl"><thead><tr><th>Product</th><th>Supplier</th><th className="text-right">Cost</th><th className="text-right">Price</th><th className="text-right">Stock</th>{batched && <th>Nearest expiry</th>}<th /></tr></thead>
            <tbody>{shown.map(({ p, supplierName }) => {
              const low = p.trackStock && p.quantity <= p.minStock; const b = sm.get(p.id); const exp = b?.nearest;
              return (
                <tr key={p.id} className={p.active ? "" : "opacity-50"}>
                  <td className="font-medium">{p.name}{p.strength ? ` ${p.strength}` : ""}<span className="block text-xs font-normal text-muted">{[p.genericName, p.dosageForm, p.category].filter(Boolean).join(" · ")}{p.unitsPerPack > 1 ? ` · ${p.packLabel || "pack"} of ${p.unitsPerPack}` : ""}</span></td>
                  <td className="text-muted">{supplierName ?? "—"}</td>
                  <td className="text-right">{money(p.costPrice, cur)}</td><td className="text-right">{money(p.sellPrice, cur)}</td>
                  <td className="text-right">{p.trackStock ? <span className={`badge ${low ? "bg-bad/15 text-bad" : ""}`}>{p.quantity}{low ? " · low" : ""}</span> : <span className="badge">not tracked</span>}
                    {!!b?.expired && <span className="mt-1 block text-[11px] font-semibold text-bad">{b.expired} expired</span>}</td>
                  {batched && <td className="whitespace-nowrap text-sm">{exp ? <span className={exp <= today || Date.parse(exp) - Date.parse(today) <= 30 * 864e5 ? "font-semibold text-warn" : ""}>{exp}</span> : <span className="text-muted">—</span>}</td>}
                  <td><div className="flex justify-end gap-1.5">
                    {batched && <a className="btn btn-sm" href={`/inventory?batches=${p.id}`}>Batches</a>}
                    <a className="btn btn-sm" href={`/inventory?history=${p.id}`}>History</a>
                    {can && <ModalForm trigger="Adjust" triggerClass="btn btn-sm" title={`Adjust stock — ${p.name}`} action={adjustStockAction}>
                      <input type="hidden" name="productId" value={p.id} />
                      <Field label="Change in units (+ add / − remove)"><input name="delta" type="number" step="1" required className="input" /></Field>
                      {batched && p.trackStock && <>
                        <Field label="Batch"><select name="batchId" className="input"><option value="">New batch (fill in below)</option>{(byProd.get(p.id) ?? []).map((x: { id: string; batchNo: string; expiryDate: string; quantity: number }) => <option key={x.id} value={x.id}>{x.batchNo} · exp {x.expiryDate} · {x.quantity} left</option>)}</select></Field>
                        <div className="grid grid-cols-2 gap-3"><Field label="New batch number"><input name="batchNo" className="input" /></Field><Field label="New batch expiry"><input name="expiryDate" type="date" className="input" /></Field></div>
                        <p className="text-xs text-muted">Removing stock: choose the batch. Adding stock: choose a batch, or enter a new batch number and expiry date.</p>
                      </>}
                      <Field label="Reason"><select name="reason" className="input"><option value="adjustment">Stock count / adjustment</option><option value="purchase">Received stock</option><option value="damage">Damaged / lost</option></select></Field><Field label="Note"><input name="note" className="input" /></Field></ModalForm>}
                    {can && <ModalForm trigger="Edit" triggerClass="btn btn-sm" title={`Edit ${p.name}`} action={saveProductAction} wide><ProductFields p={p} suppliers={suppliers} batched={batched} /></ModalForm>}
                  </div></td></tr>); })}</tbody></table></div>
        )}
      </Card>
      {batchRows && (
        <Card title="Batches" className="mt-4">
          {batchRows.length === 0 ? <p className="px-5 py-6 text-sm text-muted">No batches for this product.</p> : <div className="overflow-x-auto"><table className="tbl"><thead><tr><th>Batch</th><th>Expiry</th><th>Status</th><th className="text-right">Units left</th><th /></tr></thead>
            <tbody>{batchRows.map((b) => { const expired = b.expiryDate < today; const days = Math.round((Date.parse(b.expiryDate) - Date.parse(today)) / 864e5); return (
              <tr key={b.id}><td className="font-medium">{b.batchNo}</td><td>{b.expiryDate}</td>
                <td>{b.quantity === 0 ? <span className="badge">empty</span> : expired ? <span className="badge bg-bad/15 text-bad">Expired</span> : days <= 30 ? <span className="badge bg-warn/15 text-warn">{days} days left</span> : <span className="badge bg-ok/15 text-ok">In date</span>}</td>
                <td className="text-right font-semibold">{b.quantity}</td>
                <td className="text-right">{can && expired && b.quantity > 0 && <ActionButton action={writeOffBatchAction} args={[b.id]} confirm={`Write off ${b.quantity} expired unit(s) of batch ${b.batchNo}?`} className="btn btn-sm btn-danger">Write off</ActionButton>}</td></tr>); })}</tbody></table></div>}
        </Card>
      )}
      {hist && (
        <Card title="Stock history" className="mt-4">
          {hist.length === 0 ? <p className="px-5 py-6 text-sm text-muted">No movements.</p> : <div className="overflow-x-auto"><table className="tbl"><thead><tr><th>When</th><th>Reason</th><th className="text-right">Change</th><th className="text-right">Balance</th><th>Note</th></tr></thead>
            <tbody>{hist.map((m) => (<tr key={m.id}><td>{fmtDateTime(m.createdAt, ctx.tenant.timezone)}</td><td className="capitalize">{m.reason}</td><td className={`text-right font-semibold ${m.delta < 0 ? "text-bad" : "text-ok"}`}>{m.delta > 0 ? "+" : ""}{m.delta}</td><td className="text-right">{m.balanceAfter}</td><td className="text-muted">{m.note}</td></tr>))}</tbody></table></div>}
        </Card>
      )}
    </div>
  );
}
