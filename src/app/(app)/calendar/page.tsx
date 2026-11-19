import Link from "next/link";
import { requireCtx } from "@/server/session";
import { listAppointments } from "@/server/services/appointments";
import { bookingOptions } from "@/lib/lists";
import { Calendar, type CalAppt } from "@/components/week-calendar";
import { PageHeader, Card } from "@/components/ui";
import { addDays, fmtTime, hm, zonedParts, zonedToUtc } from "@/lib/time";
import { DAY_NAMES } from "@/lib/constants";

export const metadata = { title: "Calendar" };
export default async function Page({ searchParams }: { searchParams: Promise<{ view?: string; date?: string; staff?: string; service?: string; status?: string }> }) {
  const ctx = await requireCtx("appointments.view", "appointments");
  const sp = await searchParams;
  const tz = ctx.tenant.timezone, h12 = ctx.tenant.timeFormat === "12h";
  const today = zonedParts(new Date(), tz).date;
  const view = sp.view === "day" || sp.view === "month" ? sp.view : "week";
  const date = /^\d{4}-\d{2}-\d{2}$/.test(sp.date ?? "") ? sp.date! : today;
  const wd = zonedParts(zonedToUtc(date, 720, tz), tz).weekday;
  let first = date, count = 1, step = 1;
  if (view === "week") { first = addDays(date, -wd); count = 7; step = 7; }
  if (view === "month") {
    const f = `${date.slice(0, 7)}-01`;
    first = addDays(f, -zonedParts(zonedToUtc(f, 720, tz), tz).weekday); count = 42; step = 30;
  }
  const opts = await bookingOptions(ctx);
  const rows = await listAppointments(ctx, { from: zonedToUtc(first, 0, tz), to: zonedToUtc(addDays(first, count), 0, tz), staffId: sp.staff || undefined, serviceId: sp.service || undefined, status: sp.status || undefined });
  const hrs = Object.values(ctx.tenant.hours).filter(Boolean) as { open: string; close: string }[];
  const startHour = hrs.length ? Math.floor(Math.min(...hrs.map((h) => hm(h.open))) / 60) : 8;
  const endHour = hrs.length ? Math.ceil(Math.max(...hrs.map((h) => hm(h.close))) / 60) : 20;
  const all: CalAppt[] = rows.map((r) => {
    const p = zonedParts(r.a.startsAt, tz), e = zonedParts(r.a.endsAt, tz);
    return { id: r.a.id, date: p.date, startMin: p.minutes, endMin: e.date === p.date ? e.minutes : 1440, title: r.customerName, sub: r.serviceName, color: r.staffColor, status: r.a.status, time: fmtTime(r.a.startsAt, tz, h12) };
  });
  const days = Array.from({ length: view === "month" ? 0 : count }, (_, i) => {
    const d = addDays(first, i);
    const w = zonedParts(zonedToUtc(d, 720, tz), tz).weekday;
    return { date: d, label: `${DAY_NAMES[w].slice(0, 3)} ${d.slice(8)}` };
  });
  const q = (o: Record<string, string>) => {
    const u = new URLSearchParams({ view, date, ...(sp.staff ? { staff: sp.staff } : {}), ...(sp.service ? { service: sp.service } : {}), ...(sp.status ? { status: sp.status } : {}), ...o });
    return `/calendar?${u}`;
  };
  const base = view === "month" ? `${date.slice(0, 7)}-01` : date;
  return (
    <div className="page-in">
      <PageHeader title="Calendar" desc={view === "month" ? date.slice(0, 7) : `${first} → ${addDays(first, count - 1)}`} actions={<>
        <Link className="btn btn-sm" href={q({ date: addDays(base, -step) })} aria-label="Previous">←</Link>
        <Link className="btn btn-sm" href={q({ date: today })}>Today</Link>
        <Link className="btn btn-sm" href={q({ date: addDays(base, step) })} aria-label="Next">→</Link>
        <div className="flex rounded-lg border border-line p-0.5">{["day", "week", "month"].map((v) => <Link key={v} href={q({ view: v })} className={`rounded-md px-3 py-1 text-xs font-semibold capitalize ${v === view ? "bg-brand text-brandfg" : "text-muted"}`}>{v}</Link>)}</div>
      </>} />
      <form className="mb-4 flex flex-wrap gap-2">
        <input type="hidden" name="view" value={view} /><input type="hidden" name="date" value={date} />
        <select name="staff" defaultValue={sp.staff ?? ""} className="input !h-9 w-auto" aria-label="Staff"><option value="">All staff</option>{opts.staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
        <select name="service" defaultValue={sp.service ?? ""} className="input !h-9 w-auto" aria-label="Service"><option value="">All services</option>{opts.services.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
        <select name="status" defaultValue={sp.status ?? ""} className="input !h-9 w-auto" aria-label="Status"><option value="">All statuses</option>{["pending", "confirmed", "checked_in", "in_progress", "completed", "cancelled", "no_show"].map((s) => <option key={s} value={s}>{s.replace("_", " ")}</option>)}</select>
        <button className="btn btn-sm">Apply</button>
      </form>
      {view === "month" ? (
        <Card>
          <div className="grid grid-cols-7 text-center text-xs font-semibold text-muted">{DAY_NAMES.map((d) => <div key={d} className="border-b border-line py-2">{d.slice(0, 3)}</div>)}</div>
          <div className="grid grid-cols-7">
            {Array.from({ length: 42 }, (_, i) => {
              const d = addDays(first, i);
              const n = all.filter((a) => a.date === d).length;
              const inMonth = d.slice(0, 7) === date.slice(0, 7);
              return (
                <Link key={d} href={q({ view: "day", date: d })} className={`min-h-20 border-b border-r border-line p-2 text-xs transition hover:bg-surface2 ${inMonth ? "" : "opacity-40"}`}>
                  <span className={d === today ? "font-bold text-brand" : ""}>{+d.slice(8)}</span>
                  {n > 0 && <span className="mt-1 block rounded-md bg-brand/15 px-1.5 py-0.5 font-semibold text-brand">{n} appt{n > 1 ? "s" : ""}</span>}
                </Link>
              );
            })}
          </div>
        </Card>
      ) : (
        <Calendar days={days} appts={all} startHour={startHour} endHour={endHour} slot={ctx.tenant.slotMinutes} canEdit={ctx.perms.has("appointments.manage")} today={today} options={opts} staffId={sp.staff} />
      )}
    </div>
  );
}
