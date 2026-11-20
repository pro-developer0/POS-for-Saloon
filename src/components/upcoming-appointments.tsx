import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { addDays } from "@/lib/time";
import { fmtTime } from "@/lib/time";

type Row = { id: string; customer: string; service: string; stylist: string; startsAt: Date; endsAt: Date; price: string; status: string };
const DOW = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];

const initials = (n: string) => n.split(/\s+/).slice(0, 2).map((x) => x[0]).join("").toUpperCase();
const HUES = [265, 215, 340, 160, 30, 190];
const hue = (s: string) => HUES[[...s].reduce((a, c) => a + c.charCodeAt(0), 0) % HUES.length];

/** Week strip (Mon–Sun) + the selected day's appointments. The selected day lives in the URL (?day=YYYY-MM-DD). */
export function UpcomingAppointments({ day, today, weekdayOfDay, rows, tz, h12, money, query }: {
  day: string; today: string; weekdayOfDay: number; rows: Row[]; tz: string; h12: boolean; money: (v: string) => string; query: (day: string) => string;
}) {
  const monday = addDays(day, -((weekdayOfDay + 6) % 7));
  const days = Array.from({ length: 7 }, (_, i) => addDays(monday, i));
  const month = new Intl.DateTimeFormat("en", { month: "long", timeZone: "UTC" }).format(new Date(`${day}T12:00:00Z`));
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between px-5 pt-5">
        <h2 className="text-sm font-semibold">Upcoming Appointments</h2>
        <div className="flex items-center gap-1">
          <Link href={query(addDays(day, -7))} scroll={false} aria-label="Previous week" className="btn btn-ghost btn-sm !px-1.5"><ChevronLeft size={15} /></Link>
          <span className="rounded-lg bg-surface2 px-2.5 py-1 text-xs font-medium">{month}</span>
          <Link href={query(addDays(day, 7))} scroll={false} aria-label="Next week" className="btn btn-ghost btn-sm !px-1.5"><ChevronRight size={15} /></Link>
        </div>
      </div>
      <nav aria-label="Pick a day" className="mt-4 grid grid-cols-7 gap-1.5 border-b border-line px-4 pb-4">
        {days.map((d, i) => {
          const on = d === day;
          return (
            <Link key={d} href={query(d)} scroll={false} aria-current={on ? "date" : undefined} title={d}
              className={`flex flex-col items-center gap-1.5 rounded-xl px-1 py-2 text-center transition-colors ${on ? "bg-brand text-brandfg" : "bg-surface2 text-muted hover:text-ink"}`}>
              <span className="text-[9px] font-semibold tracking-wide opacity-80">{DOW[i]}</span>
              <span className="text-sm font-semibold">{d.slice(8)}</span>
              {d === today && !on && <span className="-mt-1 size-1 rounded-full bg-brand" />}
            </Link>
          );
        })}
      </nav>
      <ul className="flex-1 space-y-2.5 overflow-y-auto p-4" style={{ maxHeight: 560 }}>
        {rows.length === 0 && <li className="py-12 text-center text-sm text-muted">No appointments on this day.</li>}
        {rows.map((r) => (
          <li key={r.id}>
            <Link href="/appointments" className="flex items-center gap-3 rounded-xl bg-surface2 p-3 transition-colors hover:bg-line/60">
              <span className="grid size-10 shrink-0 place-items-center rounded-lg text-xs font-bold text-white" style={{ background: `hsl(${hue(r.customer)} 45% 38%)` }} aria-hidden>{initials(r.customer)}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold">{r.customer}</span>
                <span className="block truncate text-[11px] text-muted">{r.service}</span>
                <span className="block text-[11px] text-muted">{fmtTime(r.startsAt, tz, h12)} to {fmtTime(r.endsAt, tz, h12)} · {r.stylist}</span>
              </span>
              <span className="shrink-0 text-sm font-semibold text-brand">{money(r.price)}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
