"use client";
import { useState } from "react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ReferenceDot, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis, Cell } from "recharts";

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

/** Smooth sales curve with a pinned point + value pill that follows the pointer (resets to `defaultIndex`). */
export function SalesChart({ data, currency, defaultIndex }: { data: { label: string; value: number }[]; currency: string; defaultIndex: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const idx = Math.min(Math.max(hover ?? defaultIndex, 0), data.length - 1);
  const point = data[idx];
  const compact = (v: number) => new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(v);
  const full = new Intl.NumberFormat("en", { style: "currency", currency, maximumFractionDigits: 0 });
  return (
    <div className="h-64 w-full" role="img" aria-label="Sales over time">
      <ResponsiveContainer>
        <AreaChart data={data} margin={{ left: 0, right: 16, top: 34, bottom: 0 }}
          onMouseMove={(st) => { const i = Number((st as { activeTooltipIndex?: number | string | null }).activeTooltipIndex); if (Number.isFinite(i)) setHover(i); }} onMouseLeave={() => setHover(null)}>
          <defs><linearGradient id="salesFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--brand)" stopOpacity={0.28} /><stop offset="100%" stopColor="var(--brand)" stopOpacity={0.02} /></linearGradient></defs>
          <CartesianGrid stroke="var(--border)" strokeDasharray="0" vertical={false} />
          <XAxis dataKey="label" stroke="var(--muted)" fontSize={11} tickLine={false} axisLine={false} interval={0}
            tick={({ x, y, payload, index }: { x?: number | string; y?: number | string; payload?: { value?: string | number }; index?: number }) => (
              <text x={Number(x)} y={Number(y) + 14} textAnchor="middle" fontSize={11} fontWeight={index === idx ? 700 : 400} fill={index === idx ? "var(--brand)" : "var(--muted)"}>{payload?.value}</text>)} />
          <YAxis stroke="var(--muted)" fontSize={11} tickLine={false} axisLine={false} width={44} tickFormatter={compact} />
          <Tooltip content={() => null} cursor={false} />
          <Area type="monotone" dataKey="value" stroke="var(--brand)" strokeWidth={2} fill="url(#salesFill)" isAnimationActive={false} dot={false} activeDot={false} />
          {point && <>
            <ReferenceLine segment={[{ x: point.label, y: 0 }, { x: point.label, y: point.value }]} stroke="var(--brand)" strokeWidth={1} />
            <ReferenceDot x={point.label} y={point.value} r={4.5} fill="var(--surface)" stroke="var(--brand)" strokeWidth={2}
              label={({ viewBox }: { viewBox?: { x?: number; y?: number } }) => {
                const t = full.format(point.value), w = Math.max(48, t.length * 7 + 16), cx = viewBox?.x ?? 0, cy = viewBox?.y ?? 0;
                return (<g><rect x={cx - w / 2} y={cy - 32} width={w} height={22} rx={6} fill="var(--brand)" /><text x={cx} y={cy - 17} textAnchor="middle" fontSize={11} fontWeight={700} fill="var(--brand-fg)">{t}</text></g>);
              }} />
          </>}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
