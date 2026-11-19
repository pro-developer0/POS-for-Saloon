import type { WeekHours } from "@/db/schema";

const dtfCache = new Map<string, Intl.DateTimeFormat>();
function dtf(tz: string) {
  let f = dtfCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-CA", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", weekday: "short" });
    dtfCache.set(tz, f);
  }
  return f;
}
const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function zonedParts(d: Date, tz: string) {
  const p: Record<string, string> = {};
  for (const x of dtf(tz).formatToParts(d)) p[x.type] = x.value;
  const hh = +p.hour % 24;
  return { date: `${p.year}-${p.month}-${p.day}`, hh, mm: +p.minute, minutes: hh * 60 + +p.minute, weekday: WD.indexOf(p.weekday) };
}

/** Convert a local wall-clock date ("YYYY-MM-DD") + minutes-from-midnight in tz to a UTC Date. */
export function zonedToUtc(date: string, minutes: number, tz: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  const guess = Date.UTC(y, m - 1, d, 0, minutes);
  let t = guess;
  for (let i = 0; i < 3; i++) {
    const p = zonedParts(new Date(t), tz);
    const [py, pm, pd] = p.date.split("-").map(Number);
    t += guess - Date.UTC(py, pm - 1, pd, p.hh, p.mm);
  }
  return new Date(t);
}
export const hm = (s: string) => { const [h, m] = s.split(":").map(Number); return h * 60 + m; };
export const minToHm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

export function defaultWeek(open = "09:00", close = "18:00", closedDays: number[] = [0]): WeekHours {
  const w: Record<string, unknown> = {};
  for (let i = 0; i < 7; i++) w[String(i)] = closedDays.includes(i) ? null : { open, close };
  return w as WeekHours;
}

export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

export function fmtDateTime(d: Date | string, tz: string, h12 = true) {
  return new Intl.DateTimeFormat("en", { timeZone: tz, dateStyle: "medium", timeStyle: "short", hour12: h12 }).format(new Date(d));
}
export function fmtTime(d: Date | string, tz: string, h12 = true) {
  return new Intl.DateTimeFormat("en", { timeZone: tz, timeStyle: "short", hour12: h12 }).format(new Date(d));
}
export function fmtDate(d: Date | string, tz: string) {
  return new Intl.DateTimeFormat("en", { timeZone: tz, dateStyle: "medium" }).format(new Date(d));
}

export type RangeKey = "today" | "yesterday" | "7d" | "30d" | "month" | "lastmonth" | "year" | "custom";
/** Resolve a named range to [from, to) UTC instants using the tenant's timezone. */
export function resolveRange(key: RangeKey, tz: string, custom?: { from?: string; to?: string }) {
  const today = zonedParts(new Date(), tz).date;
  let from = today, to = addDays(today, 1);
  const [y, m] = today.split("-").map(Number);
  const mm = (n: number) => String(n).padStart(2, "0");
  switch (key) {
    case "yesterday": from = addDays(today, -1); to = today; break;
    case "7d": from = addDays(today, -6); break;
    case "30d": from = addDays(today, -29); break;
    case "month": from = `${y}-${mm(m)}-01`; break;
    case "lastmonth": {
      const py = m === 1 ? y - 1 : y, pm = m === 1 ? 12 : m - 1;
      from = `${py}-${mm(pm)}-01`; to = `${y}-${mm(m)}-01`; break;
    }
    case "year": from = `${y}-01-01`; break;
    case "custom": if (custom?.from) { from = custom.from; to = addDays(custom.to || custom.from, 1); } break;
  }
  return { fromDate: from, toDate: to, from: zonedToUtc(from, 0, tz), to: zonedToUtc(to, 0, tz) };
}
