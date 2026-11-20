import { labelsOf } from "@/lib/verticals";
import { requireCtx } from "@/server/session";
import { listAppointments } from "@/server/services/appointments";
import { bookingOptions } from "@/lib/lists";
import { Card, Empty, PageHeader, StatusBadge, money } from "@/components/ui";
import { BookingModal } from "@/components/booking-modal-wrap";
import { ApptActions } from "@/components/appt-actions";
import { addDays, fmtDate, fmtTime, zonedParts, zonedToUtc, minToHm } from "@/lib/time";
import { APPT_STATUSES } from "@/server/services/appointments";
import { fromCents, toCents } from "@/lib/money";

export const metadata = { title: "Appointments" };
export default async function Page({ searchParams }: { searchParams: Promise<{ from?: string; days?: string; status?: string; staff?: string; service?: string; q?: string }> }) {
  const ctx = await requireCtx("appointments.view", "appointments");
  const sp = await searchParams; const tz = ctx.tenant.timezone, h12 = ctx.tenant.timeFormat === "12h";
  const today = zonedParts(new Date(), tz).date;
  const from = sp.from || today, days = Math.min(90, Math.max(1, Number(sp.days) || 7));
  const opts = await bookingOptions(ctx);
  const rows = await listAppointments(ctx, { from: zonedToUtc(from, 0, tz), to: zonedToUtc(addDays(from, days), 0, tz), status: sp.status || undefined, staffId: sp.staff || undefined, serviceId: sp.service || undefined, q: sp.q || undefined });
  const can = ctx.perms.has("appointments.manage");
  return (
    <div className="page-in">
      <PageHeader title={labelsOf().appointments} desc="Bookings are validated against business hours, staff schedules, breaks, time off and conflicts."
        actions={can ? <BookingModal customers={opts.customers} services={opts.services} staff={opts.staff} today={today} /> : null} />
      <form className="card mb-4 grid grid-cols-2 gap-3 p-4 sm:grid-cols-3 lg:grid-cols-6">
        <input name="q" defaultValue={sp.q} placeholder="Search customer…" className="input col-span-2 sm:col-span-1" aria-label="Search" />
        <input type="date" name="from" defaultValue={from} className="input" aria-label="From date" />
        <select name="days" defaultValue={String(days)} className="input" aria-label="Range">{[1, 7, 14, 30, 90].map((d) => <option key={d} value={d}>{d === 1 ? "1 day" : `${d} days`}</option>)}</select>
        <select name="status" defaultValue={sp.status ?? ""} className="input" aria-label="Status"><option value="">All statuses</option>{APPT_STATUSES.map((s) => <option key={s} value={s}>{s.replace("_", " ")}</option>)}</select>
        <select name="staff" defaultValue={sp.staff ?? ""} className="input" aria-label="Staff"><option value="">All staff</option>{opts.staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
        <button className="btn">Filter</button>
      </form>
      <Card>
        {rows.length === 0 ? <Empty title="No appointments in this range" desc="Try a different range or book a new appointment." /> : (
          <div className="overflow-x-auto"><table className="tbl">
            <thead><tr><th>When</th><th>Customer</th><th>Service</th><th>Staff</th><th>Status</th><th className="text-right">Price</th><th /></tr></thead>
            <tbody>{rows.map((r) => {
              const p = zonedParts(r.a.startsAt, tz);
              return (<tr key={r.a.id}>
                <td className="whitespace-nowrap"><span className="font-medium">{fmtDate(r.a.startsAt, tz)}</span><span className="block text-xs text-muted">{fmtTime(r.a.startsAt, tz, h12)} – {fmtTime(r.a.endsAt, tz, h12)}</span></td>
                <td><span className="font-medium">{r.customerName}</span>{r.customerPhone && <span className="block text-xs text-muted">{r.customerPhone}</span>}</td>
                <td>{r.serviceName}<span className="block text-xs text-muted">{r.a.durationMinutes} min</span></td>
                <td><span className="inline-flex items-center gap-1.5"><span className="size-2 rounded-full" style={{ background: r.staffColor }} />{r.staffName}</span></td>
                <td><StatusBadge status={r.a.status} /></td>
                <td className="text-right">{money(fromCents(toCents(r.a.price) - toCents(r.a.discount)), ctx.tenant.currency)}</td>
                <td>{can && <ApptActions id={r.a.id} status={r.a.status} date={p.date} time={minToHm(p.minutes)} staffId={r.a.staffId} staff={opts.staff} billed={!!r.a.transactionId} />}</td>
              </tr>);
            })}</tbody></table></div>
        )}
      </Card>
    </div>
  );
}
