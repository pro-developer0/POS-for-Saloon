"use client";
import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Minus, Plus, Trash2, Search } from "lucide-react";
import { checkoutAction } from "@/app/actions";

type Item = { id: string; name: string; price: string; taxable: boolean; stock?: number; category?: string | null };
type Line = { kind: "service" | "product"; id: string; name: string; unit: number; taxable: boolean; qty: number; discount: number; stock?: number };
type Pay = { method: string; amount: string };

const c = (v: string | number) => Math.round(Number(v || 0) * 100);

export function Pos({ services, products, customers, staff, methods, taxRate, currency, pre, showServices = true, showStaff = true, noteLabel = "Payment notes (optional)", productLabel = "Products" }: {
  services: Item[]; products: Item[]; customers: { id: string; name: string; phone?: string | null }[]; staff: { id: string; name: string }[];
  methods: string[]; taxRate: string; currency: string; pre?: { appointmentId: string; customerId: string; staffId: string; serviceId: string; discount: string };
  showServices?: boolean; showStaff?: boolean; noteLabel?: string; productLabel?: string;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<"service" | "product">(showServices ? "service" : "product");
  const [q, setQ] = useState("");
  const [cart, setCart] = useState<Line[]>(() => {
    if (!pre) return [];
    const s = services.find((x) => x.id === pre.serviceId);
    return s ? [{ kind: "service", id: s.id, name: s.name, unit: c(s.price), taxable: s.taxable, qty: 1, discount: c(pre.discount) }] : [];
  });
  const [customerId, setCustomerId] = useState(pre?.customerId ?? "");
  const [staffId, setStaffId] = useState(pre?.staffId ?? "");
  const [orderDisc, setOrderDisc] = useState("");
  const [pays, setPays] = useState<Pay[]>([{ method: methods[0] ?? "cash", amount: "" }]);
  const [credit, setCredit] = useState(false);
  const [notes, setNotes] = useState("");
  const [key, setKey] = useState(() => crypto.randomUUID());
  const [pending, start] = useTransition();
  const [done, setDone] = useState<{ id: string; number: string } | null>(null);

  const fmt = (cents: number) => new Intl.NumberFormat("en", { style: "currency", currency, maximumFractionDigits: currency === "PKR" ? 0 : 2 }).format(cents / 100);
  const t = useMemo(() => {
    const nets = cart.map((l) => l.unit * l.qty - l.discount);
    const sub = nets.reduce((a, b) => a + b, 0);
    const od = Math.min(c(orderDisc), sub);
    let left = od;
    const tax = cart.reduce((sum, l, i) => {
      const share = i === cart.length - 1 ? left : sub ? Math.min(left, Math.round((od * nets[i]) / sub)) : 0;
      left -= share;
      return sum + (l.taxable ? Math.round(((nets[i] - share) * Math.round(Number(taxRate) * 100)) / 10000) : 0);
    }, 0);
    const total = sub - od + tax;
    const paid = pays.reduce((a, p) => a + c(p.amount), 0);
    return { sub, od, tax, total, paid, due: total - paid };
  }, [cart, orderDisc, pays, taxRate]);

  const list = (tab === "service" ? services : products).filter((i) => i.name.toLowerCase().includes(q.toLowerCase()));
  const add = (kind: "service" | "product", i: Item) => setCart((cs) => {
    const ex = cs.find((l) => l.kind === kind && l.id === i.id);
    if (ex) return cs.map((l) => (l === ex ? { ...l, qty: Math.min(l.qty + 1, kind === "product" ? i.stock ?? 999 : 999) } : l));
    if (kind === "product" && i.stock !== undefined && i.stock < 1) { toast.error(`${i.name} is out of stock`); return cs; }
    return [...cs, { kind, id: i.id, name: i.name, unit: c(i.price), taxable: i.taxable, qty: 1, discount: 0, stock: i.stock }];
  });

  function pay() {
    start(async () => {
      const r = await checkoutAction({
        customerId: customerId || null, staffId: staffId || null, appointmentId: pre?.appointmentId ?? null, idempotencyKey: key, creditSale: credit,
        items: cart.map((l) => ({ kind: l.kind, id: l.id, quantity: l.qty, discount: l.discount / 100 })), discount: t.od / 100,
        payments: pays.filter((p) => c(p.amount) > 0).map((p) => ({ method: p.method, amount: Number(p.amount) })), notes,
      });
      if (!r.ok) { toast.error(r.error ?? "Checkout failed"); return; }
      const d = r.data as { transactionId: string; invoiceNumber: string };
      toast.success(r.message ?? "Sale completed");
      setDone({ id: d.transactionId, number: d.invoiceNumber });
      setCart([]); setPays([{ method: methods[0] ?? "cash", amount: "" }]); setOrderDisc(""); setCredit(false); setNotes(""); setKey(crypto.randomUUID()); router.refresh();
    });
  }

  if (done) return (
    <div className="card page-in mx-auto max-w-md p-8 text-center">
      <div className="mx-auto mb-4 grid size-14 place-items-center rounded-full bg-ok/15 text-2xl text-ok">✓</div>
      <h2 className="text-lg font-semibold">Sale complete</h2><p className="mt-1 text-sm text-muted">Receipt {done.number}</p>
      <div className="mt-6 flex justify-center gap-2"><Link className="btn btn-primary" href={`/invoices/${done.id}?print=1`}>View / print receipt</Link><button className="btn" onClick={() => setDone(null)}>New sale</button></div>
    </div>
  );

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_24rem]">
      <section className="card p-4">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <div className="flex rounded-lg border border-line p-0.5">
            {(showServices ? (["service", "product"] as const) : (["product"] as const)).map((k) => <button key={k} onClick={() => setTab(k)} className={`rounded-md px-3.5 py-1.5 text-sm font-semibold ${tab === k ? "bg-brand text-brandfg" : "text-muted"}`}>{k === "service" ? "Services" : productLabel}</button>)}
          </div>
          <div className="relative min-w-40 flex-1"><Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" /><input className="input pl-9" placeholder={`Search ${tab === "service" ? "services" : productLabel.toLowerCase()}…`} value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search items" /></div>
        </div>
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-4">
          {list.map((i) => {
            const out = tab === "product" && i.stock !== undefined && i.stock < 1;
            return (
              <button key={i.id} disabled={out} onClick={() => add(tab, i)} className="card p-3 text-left transition hover:-translate-y-0.5 hover:border-brand active:scale-[.98] disabled:opacity-40">
                <p className="line-clamp-2 text-sm font-semibold">{i.name}</p>
                <p className="mt-1 text-sm text-brand">{fmt(c(i.price))}</p>
                {tab === "product" && i.stock !== undefined && <p className={`mt-0.5 text-xs ${out ? "text-bad" : "text-muted"}`}>{out ? "Out of stock" : `${i.stock} in stock`}</p>}
              </button>
            );
          })}
          {list.length === 0 && <p className="col-span-full py-10 text-center text-sm text-muted">Nothing found.</p>}
        </div>
      </section>

      <aside className="card flex flex-col p-4 lg:sticky lg:top-20 lg:max-h-[calc(100dvh-6rem)] lg:overflow-y-auto">
        <div className="grid grid-cols-2 gap-2">
          <select className="input" value={customerId} onChange={(e) => setCustomerId(e.target.value)} aria-label="Customer"><option value="">Walk-in customer</option>{customers.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
          {showStaff ? <select className="input" value={staffId} onChange={(e) => setStaffId(e.target.value)} aria-label="Staff"><option value="">Staff…</option>{staff.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select> : <span />}
        </div>
        <ul className="my-3 flex-1 space-y-2">
          {cart.length === 0 && <li className="py-8 text-center text-sm text-muted">Cart is empty. Tap a service or product.</li>}
          {cart.map((l, i) => (
            <li key={l.kind + l.id} className="rounded-xl border border-line p-2.5 text-sm">
              <div className="flex items-start justify-between gap-2"><span className="font-medium">{l.name}</span><button aria-label={`Remove ${l.name}`} className="text-muted hover:text-bad" onClick={() => setCart(cart.filter((_, j) => j !== i))}><Trash2 size={15} /></button></div>
              <div className="mt-2 flex items-center justify-between">
                <div className="flex items-center gap-1">
                  <button aria-label="Decrease" className="btn btn-sm !px-2" onClick={() => setCart(cart.map((x, j) => (j === i ? { ...x, qty: Math.max(1, x.qty - 1) } : x)))}><Minus size={13} /></button>
                  <span className="w-7 text-center font-semibold">{l.qty}</span>
                  <button aria-label="Increase" className="btn btn-sm !px-2" onClick={() => setCart(cart.map((x, j) => (j === i ? { ...x, qty: Math.min(x.qty + 1, x.stock ?? 999) } : x)))}><Plus size={13} /></button>
                </div>
                <input aria-label={`Discount for ${l.name}`} className="input !h-8 w-20 text-right" type="number" min="0" step="0.01" placeholder="Disc." value={l.discount ? l.discount / 100 : ""} onChange={(e) => setCart(cart.map((x, j) => (j === i ? { ...x, discount: c(e.target.value) } : x)))} />
                <span className="w-20 text-right font-semibold">{fmt(l.unit * l.qty - l.discount)}</span>
              </div>
            </li>
          ))}
        </ul>
        <div className="space-y-1.5 border-t border-line pt-3 text-sm">
          <Row k="Subtotal" v={fmt(t.sub)} />
          <div className="flex items-center justify-between"><span className="text-muted">Order discount</span><input aria-label="Order discount" className="input !h-8 w-24 text-right" type="number" min="0" step="0.01" value={orderDisc} onChange={(e) => setOrderDisc(e.target.value)} /></div>
          <Row k={`Tax (${Number(taxRate)}%)`} v={fmt(t.tax)} />
          <div className="flex items-center justify-between pt-1 text-lg font-bold"><span>Total</span><span>{fmt(t.total)}</span></div>
        </div>
        <div className="mt-3 space-y-2">
          {pays.map((p, i) => (
            <div key={i} className="flex gap-2">
              <select className="input" value={p.method} aria-label="Payment method" onChange={(e) => setPays(pays.map((x, j) => (j === i ? { ...x, method: e.target.value } : x)))}>{methods.map((m) => <option key={m} value={m}>{m.replace(/_/g, " ")}</option>)}</select>
              <input className="input text-right" type="number" min="0" step="0.01" placeholder="Amount" aria-label="Payment amount" value={p.amount} onChange={(e) => setPays(pays.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)))} />
              {pays.length > 1 && <button className="btn btn-sm btn-ghost" aria-label="Remove payment" onClick={() => setPays(pays.filter((_, j) => j !== i))}>✕</button>}
            </div>
          ))}
          <div className="flex items-center justify-between text-xs">
            <button className="font-semibold text-brand" onClick={() => setPays([...pays, { method: methods[0] ?? "cash", amount: "" }])}>+ Split payment</button>
            <button className="font-semibold text-brand" onClick={() => setPays([{ ...pays[0], amount: (t.total / 100).toFixed(2) }])}>Pay full amount</button>
          </div>
          <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={credit} onChange={(e) => setCredit(e.target.checked)} />Leave balance on invoice (partial / pay later)</label>
          <input className="input" placeholder={noteLabel} value={notes} onChange={(e) => setNotes(e.target.value)} aria-label="Notes" />
          <div className={`flex justify-between text-sm font-semibold ${t.due > 0 ? "text-warn" : t.due < 0 ? "text-bad" : "text-ok"}`}><span>{t.due < 0 ? "Overpaid" : "Balance due"}</span><span>{fmt(Math.abs(t.due))}</span></div>
        </div>
        <button className="btn btn-primary mt-3 h-11 w-full text-base" disabled={pending || cart.length === 0 || t.due < 0 || (t.due > 0 && !credit)} onClick={pay}>{pending ? "Processing…" : `Charge ${fmt(t.paid || t.total)}`}</button>
      </aside>
    </div>
  );
}
const Row = ({ k, v }: { k: string; v: string }) => <div className="flex justify-between"><span className="text-muted">{k}</span><span>{v}</span></div>;
