"use client";
import { useEffect } from "react";

/** Opens the print dialog once the receipt has rendered (used by POS "Print receipt"). */
export function AutoPrint({ enabled }: { enabled: boolean }) {
  useEffect(() => { if (enabled) { const t = setTimeout(() => window.print(), 400); return () => clearTimeout(t); } }, [enabled]);
  return <button type="button" className="no-print" style={{ padding: "6px 14px", border: "1px solid #999", borderRadius: 6, background: "#fff", cursor: "pointer" }} onClick={() => window.print()}>Print receipt</button>;
}
