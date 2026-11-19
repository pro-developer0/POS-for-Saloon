"use client";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis, Cell } from "recharts";

const tip = { contentStyle: { background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10, fontSize: 12, color: "var(--text)" }, cursor: { stroke: "var(--border)" } };
const axis = { stroke: "var(--muted)", fontSize: 11, tickLine: false, axisLine: false } as const;

export function RevenueChart({ data, currency }: { data: { date: string; revenue: number }[]; currency: string }) {
  if (!data.length) return <p className="grid h-64 place-items-center text-sm text-muted">No sales in this period yet.</p>;
  return (
    <div className="h-64 w-full" role="img" aria-label="Revenue over time">
      <ResponsiveContainer>
        <AreaChart data={data} margin={{ left: -10, right: 8, top: 8 }}>
          <defs><linearGradient id="rev" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--brand)" stopOpacity={0.35} /><stop offset="100%" stopColor="var(--brand)" stopOpacity={0} /></linearGradient></defs>
          <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="date" {...axis} tickFormatter={(d: string) => d.slice(5)} />
          <YAxis {...axis} width={56} tickFormatter={(v: number) => new Intl.NumberFormat("en", { notation: "compact" }).format(v)} />
          <Tooltip {...tip} formatter={(v) => [new Intl.NumberFormat("en", { style: "currency", currency, maximumFractionDigits: 0 }).format(Number(v)), "Revenue"]} />
          <Area type="monotone" dataKey="revenue" stroke="var(--brand)" strokeWidth={2.5} fill="url(#rev)" isAnimationActive />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export function BarsChart({ data, x, y, label }: { data: Record<string, string | number>[]; x: string; y: string; label: string }) {
  if (!data.length) return <p className="grid h-56 place-items-center text-sm text-muted">No data for this period.</p>;
  return (
    <div className="h-56 w-full" role="img" aria-label={label}>
      <ResponsiveContainer>
        <BarChart data={data} margin={{ left: -10, right: 8, top: 8 }}>
          <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey={x} {...axis} /><YAxis {...axis} width={40} allowDecimals={false} />
          <Tooltip {...tip} />
          <Bar dataKey={y} radius={[6, 6, 0, 0]}>{data.map((_, i) => <Cell key={i} fill={i % 2 ? "var(--accent)" : "var(--brand)"} />)}</Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
