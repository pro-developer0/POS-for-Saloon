"use client";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { ChevronDown } from "lucide-react";

export function SalesModeSelect() {
  const r = useRouter(), p = usePathname(), sp = useSearchParams();
  const cur = sp.get("sales") === "weekly" ? "weekly" : "monthly";
  return (
    <label className="relative inline-flex items-center">
      <span className="sr-only">Sales grouping</span>
      <select className="h-9 cursor-pointer appearance-none rounded-lg border border-line bg-surface2 py-0 pl-3 pr-8 text-xs font-medium" value={cur}
        onChange={(e) => { const q = new URLSearchParams(sp.toString()); q.set("sales", e.target.value); r.push(`${p}?${q}`, { scroll: false }); }}>
        <option value="monthly">Monthly</option><option value="weekly">Weekly</option>
      </select>
      <ChevronDown size={13} className="pointer-events-none absolute right-2.5 text-muted" />
    </label>
  );
}
