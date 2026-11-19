import { notFound, redirect } from "next/navigation";
import { requireCtx } from "@/server/session";
import { getInvoiceDetail } from "@/server/services/pos";
import { AppError } from "@/server/ctx";
import { AutoPrint } from "@/components/auto-print";
import { money } from "@/components/ui";
import { fmtDateTime } from "@/lib/time";
import { toCents } from "@/lib/money";

export const metadata = { title: "Receipt" };

// Plain 80 mm receipt for thermal printers. No app chrome; prints exactly what is on screen.
export default async function Page({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ auto?: string }> }) {
  const base = await requireCtx();
  if (!base.perms.has("pos.use") && !base.perms.has("invoices.view")) redirect("/forbidden");
  const ctx = { ...base, perms: new Set([...base.perms, "invoices.view"]) }; // anyone who can sell can print the receipt of that sale
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  let d; try { d = await getInvoiceDetail(ctx, id); } catch (e) { if (e instanceof AppError) notFound(); throw e; }
  const t = ctx.tenant, cur = t.currency, h12 = t.timeFormat === "12h";
  const isNote = d.t.kind === "return";
  const m = (v: string | number) => money(v, cur);
  const sp = await searchParams;
  return (
    <div className="receipt-wrap">
      <style>{`
        @page { size: 80mm auto; margin: 3mm; }
        html, body { background: #fff !important; color: #000 !important; }
        .receipt-wrap { display: flex; flex-direction: column; align-items: center; gap: 12px; padding: 12px; }
        .receipt { width: 76mm; max-width: 100%; font-family: "Courier New", ui-monospace, monospace; font-size: 12px; line-height: 1.35; color: #000; background: #fff; }
        .receipt hr { border: 0; border-top: 1px dashed #000; margin: 6px 0; }
        .receipt .row { display: flex; justify-content: space-between; gap: 8px; }
        .receipt .c { text-align: center; } .receipt .b { font-weight: 700; } .receipt .big { font-size: 14px; }
        @media print { .no-print { display: none !important; } .receipt-wrap { padding: 0; } }
      `}</style>
      <div className="receipt" aria-label="Receipt">
        <div className="c b big">{t.name}</div>
        <div className="c">{[t.address, t.phone].filter(Boolean).join(" · ")}</div>
        <hr />
        <div className="c b">{isNote ? "CREDIT NOTE" : "RECEIPT"}</div>
        <div className="row"><span>No.</span><span>{d.inv.number}</span></div>
        <div className="row"><span>Date</span><span>{fmtDateTime(d.inv.createdAt, t.timezone, h12)}</span></div>
        {d.customer && <div className="row"><span>Customer</span><span>{d.customer.name}</span></div>}
        {isNote && d.refInvoice && <div className="row"><span>For invoice</span><span>{d.refInvoice.number}</span></div>}
        {isNote && d.t.returnReason && <div>Reason: {d.t.returnReason}</div>}
        <hr />
        {d.items.map((i) => (
          <div key={i.id} style={{ marginBottom: 4 }}>
            <div>{i.name}</div>
            <div className="row"><span>{i.quantity} x {m(i.unitPrice)}</span><span>{m(i.lineTotal)}</span></div>
            {Number(i.discount) !== 0 && <div className="row"><span>&nbsp;&nbsp;discount</span><span>{m(-Number(i.discount))}</span></div>}
          </div>
        ))}
        <hr />
        <div className="row"><span>Subtotal</span><span>{m(d.t.subtotal)}</span></div>
        {Number(d.t.discount) !== 0 && <div className="row"><span>Discounts{d.t.couponCode ? ` (${d.t.couponCode})` : ""}</span><span>{m(-Number(d.t.discount))}</span></div>}
        {Number(d.t.tax) !== 0 && <div className="row"><span>{t.taxName}</span><span>{m(d.t.tax)}</span></div>}
        <div className="row b big"><span>TOTAL</span><span>{m(d.t.total)}</span></div>
        <hr />
        {d.payments.map((p) => (<div key={p.id} className="row"><span style={{ textTransform: "capitalize" }}>{p.method.replace(/_/g, " ")}</span><span>{m(p.amount)}</span></div>))}
        {!isNote && toCents(d.balance) > 0 && <div className="row b"><span>BALANCE DUE</span><span>{m(d.balance)}</span></div>}
        <hr />
        <div className="c">{t.invoiceFooter || "Thank you!"}</div>
      </div>
      <AutoPrint enabled={sp.auto === "1"} />
    </div>
  );
}
