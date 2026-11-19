import { requireCtx } from "@/server/session";
import { listExpenses, listSuppliers } from "@/server/services/inventory";
import { expenseByCategory, rangeFor } from "@/server/services/reports";
import { Card, Empty, PageHeader, Field, Stat, money } from "@/components/ui";
import { ActionButton, ModalForm } from "@/components/forms";
import { RangeFilter } from "@/components/range-filter";
import { deleteExpenseAction, saveExpenseAction } from "@/app/actions";
import { zonedParts } from "@/lib/time";
import { fromCents, toCents } from "@/lib/money";
import type { RangeKey } from "@/lib/time";

export const metadata = { title: "Expenses" };
export default async function Page({ searchParams }: { searchParams: Promise<{ range?: RangeKey; from?: string; to?: string }> }) {
  const ctx = await requireCtx("expenses.view");
  const sp = await searchParams;
  const r = rangeFor(ctx, (sp.range ?? "month") as RangeKey, { from: sp.from, to: sp.to });
  const [rows, sups] = await Promise.all([listExpenses(ctx, r.fromDate, r.toDate), listSuppliers(ctx)]);
  const cats = ctx.perms.has("reports.view") ? await expenseByCategory(ctx, r) : [];
  const can = ctx.perms.has("expenses.manage"), cur = ctx.tenant.currency;
  const total = fromCents(rows.reduce((a, e) => a + toCents(e.amount), 0));
  return (
    <div className="page-in">
      <PageHeader title="Expenses" actions={<><RangeFilter />{can && <ModalForm trigger="Add expense" title="New expense" action={saveExpenseAction}>
        <Field label="Name"><input name="name" required className="input" /></Field>
        <div className="grid grid-cols-2 gap-3"><Field label="Amount"><input name="amount" type="number" step="0.01" min="0.01" required className="input" /></Field><Field label="Date"><input name="spentOn" type="date" required defaultValue={zonedParts(new Date(), ctx.tenant.timezone).date} className="input" /></Field>
          <Field label="Category"><input name="category" list="cats" className="input" defaultValue="General" /><datalist id="cats">{[...new Set([...cats.map((c) => c.category), ...rows.map((x) => x.category), "Rent", "Utilities", "Supplies", "Marketing", "Salaries"])].map((c) => <option key={c} value={c} />)}</datalist></Field>
          <Field label="Payment method"><select name="paymentMethod" className="input">{ctx.tenant.paymentMethods.map((m) => <option key={m} value={m}>{m.replace(/_/g, " ")}</option>)}</select></Field></div>
        <Field label="Supplier"><select name="supplierId" className="input"><option value="">None</option>{sups.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
        <Field label="Description"><input name="description" className="input" /></Field>
        <Field label="Receipt (image or PDF, max 2 MB)"><input type="file" name="receipt" accept="image/png,image/jpeg,image/webp,application/pdf" className="input pt-1.5" /></Field></ModalForm>}</>} />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4"><Stat label="Total expenses" value={money(total, cur)} hint={`${rows.length} records`} />{cats.slice(0, 3).map((c) => <Stat key={c.category} label={c.category} value={money(c.total, cur)} />)}</div>
      <Card>{rows.length === 0 ? <Empty title="No expenses in this period" /> : <div className="overflow-x-auto"><table className="tbl"><thead><tr><th>Date</th><th>Name</th><th>Category</th><th>Method</th><th className="text-right">Amount</th><th /></tr></thead>
        <tbody>{rows.map((e) => (<tr key={e.id}><td>{e.spentOn}</td><td className="font-medium">{e.name}{e.description && <span className="block text-xs font-normal text-muted">{e.description}</span>}</td><td><span className="badge">{e.category}</span></td><td className="capitalize">{e.paymentMethod.replace(/_/g, " ")}</td><td className="text-right font-semibold">{money(e.amount, cur)}</td>
          <td><div className="flex justify-end gap-1.5">{e.receiptUrl && <a className="btn btn-sm" href={e.receiptUrl} target="_blank" rel="noopener noreferrer">Receipt</a>}{can && <ActionButton action={deleteExpenseAction} args={[e.id]} confirm="Delete this expense? This is recorded in the audit log." className="btn btn-sm btn-danger">Delete</ActionButton>}</div></td></tr>))}</tbody></table></div>}</Card>
    </div>
  );
}
