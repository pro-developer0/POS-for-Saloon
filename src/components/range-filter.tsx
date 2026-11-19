"use client";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
const OPTS = [["today", "Today"], ["yesterday", "Yesterday"], ["7d", "Last 7 days"], ["30d", "Last 30 days"], ["month", "This month"], ["lastmonth", "Last month"], ["year", "This year"], ["custom", "Custom"]];
export function RangeFilter() {
  const r = useRouter(), p = usePathname(), sp = useSearchParams();
  const cur = sp.get("range") ?? "30d";
  const go = (k: string, from?: string, to?: string) => { const q = new URLSearchParams(sp.toString()); q.set("range", k); if (from) q.set("from", from); else q.delete("from"); if (to) q.set("to", to); else q.delete("to"); r.push(`${p}?${q}`); };
  return (
    <div className="flex flex-wrap items-center gap-2">
      <select className="input !h-9 w-auto" aria-label="Date range" value={cur} onChange={(e) => go(e.target.value, sp.get("from") ?? undefined, sp.get("to") ?? undefined)}>
        {OPTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
      {cur === "custom" && (<>
        <input type="date" className="input !h-9 w-auto" aria-label="From" defaultValue={sp.get("from") ?? ""} onChange={(e) => go("custom", e.target.value, sp.get("to") ?? e.target.value)} />
        <input type="date" className="input !h-9 w-auto" aria-label="To" defaultValue={sp.get("to") ?? ""} onChange={(e) => go("custom", sp.get("from") ?? e.target.value, e.target.value)} />
      </>)}
    </div>
  );
}
