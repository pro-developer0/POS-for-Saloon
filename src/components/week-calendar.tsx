"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { dragRescheduleAction } from "@/app/actions";
import { BookingModal } from "./booking-form";

export type CalAppt = { id: string; date: string; startMin: number; endMin: number; title: string; sub: string; color: string; status: string; time: string };
type Opt = { id: string; name: string; extra?: string; minutes?: number; price?: string; staffIds?: string[] };
const PX = 56; // px per hour

export function Calendar({ days, appts, startHour, endHour, slot, canEdit, today, options, staffId }: {
  days: { date: string; label: string }[]; appts: CalAppt[]; startHour: number; endHour: number; slot: number; canEdit: boolean; today: string;
  options: { customers: Opt[]; services: Opt[]; staff: Opt[] }; staffId?: string;
}) {
  const router = useRouter();
  const [, start] = useTransition();
  const [drag, setDrag] = useState<string | null>(null);
  const [pick, setPick] = useState<{ date: string; time: string } | null>(null);
  const hours = Array.from({ length: endHour - startHour }, (_, i) => startHour + i);
  const hh = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

  function posToMin(e: React.DragEvent | React.MouseEvent, el: HTMLElement) {
    const y = e.clientY - el.getBoundingClientRect().top;
    return Math.max(startHour * 60, Math.min(endHour * 60 - slot, startHour * 60 + Math.round(((y / PX) * 60) / slot) * slot));
  }
  return (
    <div>
      <div className="card overflow-x-auto">
        <div className="min-w-[640px]">
          <div className="grid border-b border-line" style={{ gridTemplateColumns: `3.5rem repeat(${days.length}, 1fr)` }}>
            <div />{days.map((d) => <div key={d.date} className={`px-2 py-2.5 text-center text-xs font-semibold ${d.date === today ? "text-brand" : "text-muted"}`}>{d.label}</div>)}
          </div>
          <div className="relative grid" style={{ gridTemplateColumns: `3.5rem repeat(${days.length}, 1fr)`, height: hours.length * PX }}>
            <div>{hours.map((h) => <div key={h} className="pr-2 text-right text-[11px] text-muted" style={{ height: PX }}>{hh(h * 60)}</div>)}</div>
            {days.map((d) => (
              <div key={d.date} className="relative border-l border-line" style={{ backgroundImage: "linear-gradient(var(--border) 1px, transparent 1px)", backgroundSize: `100% ${PX}px` }}
                onDragOver={(e) => { if (canEdit && drag) e.preventDefault(); }}
                onDrop={(e) => {
                  if (!drag) return;
                  e.preventDefault();
                  const id = drag; setDrag(null); const min = posToMin(e, e.currentTarget);
                  start(async () => { const r = await dragRescheduleAction(id, d.date, min); if (r.ok) { toast.success("Appointment moved"); router.refresh(); } else toast.error(r.error ?? "Cannot move there"); });
                }}
                onClick={(e) => { if (canEdit && e.target === e.currentTarget) setPick({ date: d.date, time: hh(posToMin(e, e.currentTarget)) }); }}>
                {appts.filter((a) => a.date === d.date).map((a) => (
                  <div key={a.id} draggable={canEdit && !["completed", "cancelled", "no_show"].includes(a.status)} onDragStart={() => setDrag(a.id)} onDragEnd={() => setDrag(null)}
                    className="absolute inset-x-0.5 cursor-grab overflow-hidden rounded-lg border-l-4 px-1.5 py-1 text-[11px] leading-tight shadow-sm transition-transform hover:z-10 hover:scale-[1.02]"
                    style={{ top: ((a.startMin - startHour * 60) / 60) * PX, height: Math.max(22, ((a.endMin - a.startMin) / 60) * PX - 2), borderColor: a.color, background: `color-mix(in srgb, ${a.color} 16%, var(--surface))`, opacity: ["cancelled", "no_show"].includes(a.status) ? 0.45 : 1 }}
                    title={`${a.time} · ${a.title} · ${a.sub} · ${a.status}`}>
                    <p className="truncate font-semibold">{a.title}</p><p className="truncate text-muted">{a.time} · {a.sub}</p>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
      {canEdit && <p className="mt-2 text-xs text-muted">Drag an appointment to reschedule it (validated on the server). Click an empty area to book.</p>}
      {pick && canEdit && (
        <div className="card mt-3 flex flex-wrap items-center gap-3 p-3 text-sm">
          <span>Selected: <b>{pick.date}</b> at <b>{pick.time}</b></span>
          <BookingModal key={pick.date + pick.time} customers={options.customers} services={options.services} staff={options.staff} today={today} label="Book this time" initial={{ date: pick.date, time: pick.time, staffId }} />
          <button className="btn btn-sm btn-ghost" onClick={() => setPick(null)}>Clear</button>
        </div>
      )}
    </div>
  );
}
