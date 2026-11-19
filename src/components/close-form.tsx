"use client";
import { useState } from "react";

const c = (v: string) => Math.round(Number(v || 0) * 100);

/** Inputs for closing the till, with a live "expected vs counted" check. Lives inside a ModalForm. */
export function CloseFields({ defaultFloat, cashIn, cashExpenses, currency }: { defaultFloat: number; cashIn: number; cashExpenses: number; currency: string }) {
  const [float, setFloat] = useState((defaultFloat / 100).toFixed(2));
  const [counted, setCounted] = useState("");
  const fmt = (cents: number) => new Intl.NumberFormat("en", { style: "currency", currency, maximumFractionDigits: currency === "PKR" ? 0 : 2 }).format(cents / 100);
  const expected = c(float) + cashIn - cashExpenses;
  const diff = c(counted) - expected;
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        <div><label className="label" htmlFor="openingFloat">Opening float (cash already in the drawer)</label><input id="openingFloat" name="openingFloat" type="number" min="0" step="0.01" className="input" value={float} onChange={(e) => setFloat(e.target.value)} /></div>
        <div><label className="label" htmlFor="countedCash">Cash counted now</label><input id="countedCash" name="countedCash" type="number" min="0" step="0.01" required className="input" value={counted} onChange={(e) => setCounted(e.target.value)} /></div>
      </div>
      <div className="rounded-xl bg-surface2 p-3 text-sm">
        <div className="flex justify-between"><span className="text-muted">Expected cash</span><b>{fmt(expected)}</b></div>
        {counted !== "" && <div className={`mt-1 flex justify-between font-semibold ${diff === 0 ? "text-ok" : "text-bad"}`}><span>{diff === 0 ? "Balanced" : diff > 0 ? "Over" : "Short"}</span><span>{fmt(diff)}</span></div>}
      </div>
      <div><label className="label" htmlFor="note">Note (optional)</label><input id="note" name="note" className="input" placeholder="e.g. 500 taken to bank" /></div>
    </>
  );
}
