"use client";
import { useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Minus, Plus, Trash2, Search } from "lucide-react";
import { checkoutAction, previewCouponAction } from "@/app/actions";

type Item = {
  id: string; name: string; price: string; taxable: boolean; stock?: number; category?: string | null;
  generic?: string | null; strength?: string | null; unitLabel?: string; packLabel?: string | null; unitsPerPack?: number; packPrice?: string | null;
  nearest?: string | null; expired?: number; // pharmacy: nearest in-date expiry, units that are expired and cannot be sold
};
type Line = { kind: "service" | "product"; id: string; name: string; unit: number; taxable: boolean; qty: number; discount: number; stock?: number; pack?: boolean; perPack?: number };
type Pay = { method: string; amount: string };

const c = (v: string | number) => Math.round(Number(v || 0) * 100);

export function Pos({ services, products, customers, staff, methods, taxRate, currency, pre, showServices = true, showStaff = true, noteLabel = "Payment notes (optional)", productLabel = "Products" }: {
  services: Item[]; products: Item[]; customers: { id: string; name: string; phone?: string | null; balance?: string; limit?: string | null }[]; staff: { id: string; name: string }[];
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
  const [couponInput, setCouponInput] = useState("");
  const [coupon, setCoupon] = useState<{ code: string; cents: number } | null>(null);
  const [key, setKey] = useState(() => crypto.randomUUID());
  const [pending, start] = useTransition();
  const [done, setDone] = useState<{ id: string; number: string } | null>(null);

  const fmt = (cents: number) => new Intl.NumberFormat("en", { style: "currency", currency, maximumFractionDigits: currency === "PKR" ? 0 : 2 }).format(cents / 100);
  const t = useMemo(() => {
    const nets = cart.map((l) => l.unit * l.qty - l.discount);
    const sub = nets.reduce((a, b) => a + b, 0);
    const manual = Math.min(c(orderDisc), sub);
    const od = manual + Math.min(coupon?.cents ?? 0, sub - manual); // manual + coupon discount (the server re-checks the coupon)
    let left = od;
    const tax = cart.reduce((sum, l, i) => {
      const share = i === cart.length - 1 ? left : sub ? Math.min(left, Math.round((od * nets[i]) / sub)) : 0;
      left -= share;
      return sum + (l.taxable ? Math.round(((nets[i] - share) * Math.round(Number(taxRate) * 100)) / 10000) : 0);
    }, 0);
    const total = sub - od + tax;
    const paid = pays.reduce((a, p) => a + c(p.amount), 0);
    return { sub, od, manual, cp: od - manual, tax, total, paid, due: total - paid };
  }, [cart, orderDisc, pays, taxRate, coupon]);

  // keep an applied coupon honest when the cart changes
  useEffect(() => {
    if (!coupon) return;
    let live = true;
    previewCouponAction(coupon.code, t.sub).then((r) => {
      if (!live) return;
      if (!r.ok) { setCoupon(null); toast.error(r.error); } else setCoupon({ code: r.code, cents: c(r.discount) });
    });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t.sub, coupon?.code]);
  const selected = customers.find((x) => x.id === customerId);
  useEffect(() => { if (!customerId) setCredit(false); }, [customerId]);
  async function applyCoupon() {
    if (!couponInput.trim()) return;
    const r = await previewCouponAction(couponInput, t.sub);
    if (!r.ok) { toast.error(r.error); return; }
    setCoupon({ code: r.code, cents: c(r.discount) }); setCouponInput(""); toast.success(`Coupon ${r.code} applied (${r.label})`);
  }

  const list = (tab === "service" ? services : products).filter((i) => `${i.name} ${i.generic ?? ""} ${i.strength ?? ""}`.toLowerCase().includes(q.toLowerCase()));
  const add = (kind: "service" | "product", i: Item, pack = false) => setCart((cs) => {
    const per = pack ? i.unitsPerPack ?? 1 : 1;
    const used = cs.filter((l) => l.kind === kind && l.id === i.id).reduce((a, l) => a + l.qty * (l.pack ? l.perPack ?? 1 : 1), 0);
    if (kind === "product" && i.stock !== undefined && used + per > i.stock) { toast.error(i.stock < 1 ? `${i.name} is out of stock` : `Not enough ${i.name} in stock`); return cs; }
    const ex = cs.find((l) => l.kind === kind && l.id === i.id && !!l.pack === pack);
    if (ex) return cs.map((l) => (l === ex ? { ...l, qty: l.qty + 1 } : l));
    const unit = pack ? (i.packPrice != null ? c(i.packPrice) : c(i.price) * per) : c(i.price);
    const name = pack ? `${i.name} (${i.packLabel || "pack"} of ${per})` : i.name;
    return [...cs, { kind, id: i.id, name, unit, taxable: i.taxable, qty: 1, discount: 0, stock: i.stock, pack, perPack: per }];
  });

  function pay() {
    start(async () => {
      const r = await checkoutAction({
        customerId: customerId || null, staffId: staffId || null, appointmentId: pre?.appointmentId ?? null, idempotencyKey: key, creditSale: credit,
        items: cart.map((l) => ({ kind: l.kind, id: l.id, quantity: l.qty, pack: !!l.pack, discount: l.discount / 100 })), discount: t.manual / 100, couponCode: coupon?.code ?? null,
        payments: pays.filter((p) => c(p.amount) > 0).map((p) => ({ method: p.method, amount: Number(p.amount) })), notes,
      });
      if (!r.ok) { toast.error(r.error ?? "Checkout failed"); return; }
      const d = r.data as { transactionId: string; invoiceNumber: string };
      toast.success(r.message ?? "Sale completed");
      setDone({ id: d.transactionId, number: d.invoiceNumber });
      setCart([]); setPays([{ method: methods[0] ?? "cash", amount: "" }]); setOrderDisc(""); setCredit(false); setNotes(""); setCoupon(null); setCouponInput(""); setKey(crypto.randomUUID()); router.refresh();
    });
  }

  if (done) return (
    <div className="card page-in mx-auto max-w-md p-8 text-center">
      <div className="mx-auto mb-4 grid size-14 place-items-center rounded-full bg-ok/15 text-2xl text-ok">✓</div>
      <h2 className="text-lg font-semibold">Sale complete</h2><p className="mt-1 text-sm text-muted">Receipt {done.number}</p>
      <div className="mt-6 flex justify-center gap-2"><Link className="btn btn-primary" href={`/invoices/${done.id}?print=1`}>View receipt</Link><a className="btn" href={`/receipt/${done.id}?auto=1`} target="_blank" rel="noopener noreferrer">Print thermal receipt</a><button className="btn" onClick={() => setDone(null)}>New sale</button></div>
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
              <div key={i.id} className={`card flex flex-col transition hover:-translate-y-0.5 hover:border-brand ${out ? "opacity-50" : ""}`}>
                <button disabled={out} onClick={() => add(tab, i)} className="flex-1 p-3 text-left active:scale-[.98] disabled:cursor-not-allowed" aria-label={`Add ${i.name}${i.strength ? " " + i.strength : ""}`}>
                  <p className="line-clamp-2 text-sm font-semibold">{i.name}</p>
                  {(i.strength || i.generic) && <p className="line-clamp-1 text-[11px] text-muted">{[i.generic, i.strength].filter(Boolean).join(" · ")}</p>}
                  <p className="mt-1 text-sm text-brand">{fmt(c(i.price))}{i.unitLabel && i.unitLabel !== "unit" ? <span className="text-xs text-muted"> / {i.unitLabel}</span> : null}</p>
                  {tab === "product" && i.stock !== undefined && <p className={`mt-0.5 text-xs ${out ? "text-bad" : "text-muted"}`}>{out ? "Out of stock" : `${i.stock} ${i.unitLabel && i.unitLabel !== "unit" ? i.unitLabel + "s" : "in stock"}`}</p>}
                  {tab === "product" && i.nearest && <p className="text-[11px] text-muted">Exp {i.nearest}</p>}
                  {tab === "product" && !!i.expired && <p className="text-[11px] font-semibold text-bad">{i.expired} expired — not sellable</p>}
                </button>
                {tab === "product" && (i.unitsPerPack ?? 1) > 1 && !out && (
                  <button onClick={() => add(tab, i, true)} className="border-t border-line px-3 py-1.5 text-left text-xs font-semibold text-brand hover:bg-surface2" aria-label={`Add one ${i.packLabel || "pack"} of ${i.name}`}>
                    + {i.packLabel || "pack"} of {i.unitsPerPack} · {fmt(i.packPrice != null ? c(i.packPrice) : c(i.price) * (i.unitsPerPack ?? 1))}
                  </button>
                )}
              </div>
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
        {selected && Number(selected.balance ?? 0) > 0 && <p className="mt-2 rounded-lg bg-warn/10 px-3 py-1.5 text-xs text-warn">{selected.name} already owes {fmt(c(selected.balance ?? 0))}{selected.limit ? ` (limit ${fmt(c(selected.limit))})` : ""}</p>}
        <ul className="my-3 flex-1 space-y-2">
          {cart.length === 0 && <li className="py-8 text-center text-sm text-muted">Cart is empty. Tap a service or product.</li>}
          {cart.map((l, i) => (
            <li key={l.kind + l.id + (l.pack ? "-pack" : "")} className="rounded-xl border border-line p-2.5 text-sm">
              <div className="flex items-start justify-between gap-2"><span className="font-medium">{l.name}</span><button aria-label={`Remove ${l.name}`} className="text-muted hover:text-bad" onClick={() => setCart(cart.filter((_, j) => j !== i))}><Trash2 size={15} /></button></div>
              <div className="mt-2 flex items-center justify-between">
                <div className="flex items-center gap-1">
                  <button aria-label="Decrease" className="btn btn-sm !px-2" onClick={() => setCart(cart.map((x, j) => (j === i ? { ...x, qty: Math.max(1, x.qty - 1) } : x)))}><Minus size={13} /></button>
                  <span className="w-7 text-center font-semibold">{l.qty}</span>
                  <button aria-label="Increase" className="btn btn-sm !px-2" onClick={() => setCart(cart.map((x, j) => (j === i ? { ...x, qty: Math.min(x.qty + 1, x.stock !== undefined ? Math.max(1, Math.floor(x.stock / (x.pack ? x.perPack ?? 1 : 1))) : 999) } : x)))}><Plus size={13} /></button>
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
          {coupon ? (
            <div className="flex items-center justify-between"><span className="text-muted">Coupon <b className="text-ink">{coupon.code}</b> <button className="text-xs font-semibold text-bad" onClick={() => setCoupon(null)} aria-label="Remove coupon">remove</button></span><span>−{fmt(t.cp)}</span></div>
          ) : (
            <div className="flex gap-2"><input className="input !h-8" placeholder="Coupon code" aria-label="Coupon code" value={couponInput} onChange={(e) => setCouponInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); applyCoupon(); } }} /><button className="btn btn-sm" onClick={applyCoupon} disabled={!cart.length}>Apply</button></div>
          )}
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
          <label className={`flex items-center gap-2 text-xs ${customerId ? "" : "opacity-60"}`}><input type="checkbox" checked={credit} disabled={!customerId} onChange={(e) => setCredit(e.target.checked)} />Leave balance on the customer account (credit){!customerId && " — choose a customer first"}</label>
          <input className="input" placeholder={noteLabel} value={notes} onChange={(e) => setNotes(e.target.value)} aria-label="Notes" />
          <div className={`flex justify-between text-sm font-semibold ${t.due > 0 ? "text-warn" : t.due < 0 ? "text-bad" : "text-ok"}`}><span>{t.due < 0 ? "Overpaid" : "Balance due"}</span><span>{fmt(Math.abs(t.due))}</span></div>
        </div>
        <button className="btn btn-primary mt-3 h-11 w-full text-base" disabled={pending || cart.length === 0 || t.due < 0 || (t.due > 0 && !credit)} onClick={pay}>{pending ? "Processing…" : `Charge ${fmt(t.paid || t.total)}`}</button>
      </aside>
    </div>
  );
}
const Row = ({ k, v }: { k: string; v: string }) => <div className="flex justify-between"><span className="text-muted">{k}</span><span>{v}</span></div>;
