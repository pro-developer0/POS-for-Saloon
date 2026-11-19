import Link from "next/link";
import type { ReactNode } from "react";

export function PageHeader({ title, desc, actions }: { title: string; desc?: string; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">{title}</h1>
        {desc && <p className="mt-1 text-sm text-muted">{desc}</p>}
      </div>
      <div className="flex flex-wrap items-center gap-2">{actions}</div>
    </div>
  );
}

export function Card({ children, className = "", title, action }: { children: ReactNode; className?: string; title?: string; action?: ReactNode }) {
  return (
    <section className={`card ${className}`}>
      {title && (
        <header className="flex items-center justify-between border-b border-line px-5 py-3.5">
          <h2 className="text-sm font-semibold">{title}</h2>{action}
        </header>
      )}
      {children}
    </section>
  );
}

export function Stat({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: string; tone?: "ok" | "bad" | "warn" }) {
  const c = tone === "ok" ? "text-ok" : tone === "bad" ? "text-bad" : tone === "warn" ? "text-warn" : "";
  return (
    <div className="card p-4 transition-transform hover:-translate-y-0.5">
      <p className="text-xs font-medium text-muted">{label}</p>
      <p className={`mt-1.5 text-2xl font-semibold tracking-tight ${c}`}>{value}</p>
      {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
    </div>
  );
}

export function Empty({ title, desc, action }: { title: string; desc?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-14 text-center">
      <div className="mb-1 grid size-12 place-items-center rounded-full bg-surface2 text-xl text-muted">∅</div>
      <p className="font-semibold">{title}</p>
      {desc && <p className="max-w-sm text-sm text-muted">{desc}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

const TONES: Record<string, string> = {
  paid: "bg-ok/15 text-ok", completed: "bg-ok/15 text-ok", confirmed: "bg-ok/15 text-ok", active: "bg-ok/15 text-ok",
  partial: "bg-warn/15 text-warn", partially_paid: "bg-warn/15 text-warn", pending: "bg-warn/15 text-warn", checked_in: "bg-blue-500/15 text-blue-500", in_progress: "bg-blue-500/15 text-blue-500",
  credit_note: "bg-blue-500/15 text-blue-500", unpaid: "bg-bad/15 text-bad", overdue: "bg-bad/15 text-bad", cancelled: "bg-bad/15 text-bad", no_show: "bg-bad/15 text-bad", suspended: "bg-bad/15 text-bad",
};
export function StatusBadge({ status }: { status: string }) {
  return <span className={`badge ${TONES[status] ?? ""}`}>{status.replace(/_/g, " ")}</span>;
}

export function Tabs({ tabs, active }: { tabs: { href: string; label: string; key: string }[]; active: string }) {
  return (
    <div className="mb-5 flex gap-1 overflow-x-auto rounded-xl border border-line bg-surface p-1" role="tablist">
      {tabs.map((t) => (
        <Link key={t.key} href={t.href} role="tab" aria-selected={t.key === active}
          className={`whitespace-nowrap rounded-lg px-3.5 py-1.5 text-sm font-medium transition ${t.key === active ? "bg-brand text-brandfg shadow-sm" : "text-muted hover:text-ink"}`}>
          {t.label}
        </Link>
      ))}
    </div>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className="label">{label}</span>{children}
      {hint && <span className="mt-1 block text-xs text-muted">{hint}</span>}
    </label>
  );
}

export const money = (v: string | number, cur: string) => {
  const n = Number(v);
  try { return new Intl.NumberFormat("en", { style: "currency", currency: cur, maximumFractionDigits: cur === "PKR" ? 0 : 2 }).format(n); } catch { return `${cur} ${n.toFixed(2)}`; }
};
