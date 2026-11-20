import { minToHm } from "@/lib/time";
import type { DayBlock } from "@/server/services/dashboard";

const HOUR_PX = 52;
const MAX_COLS = 4;

/** Today's bookings as colored blocks, one column per stylist. Pure server-rendered markup. */
export function DaySchedule({ team, blocks, openMin, closeMin, h12 }: {
  team: { id: string; name: string; color: string }[]; blocks: DayBlock[]; openMin: number; closeMin: number; h12: boolean;
}) {
  // busiest stylists first so the visible columns are the ones with something on
  const count = (id: string) => blocks.filter((b) => b.staffId === id).length;
  const cols = [...team].sort((a, b) => count(b.id) - count(a.id) || a.name.localeCompare(b.name)).slice(0, MAX_COLS);
  const lo = Math.floor(Math.min(openMin, ...blocks.map((b) => b.startMin)) / 60);
  const hi = Math.ceil(Math.max(closeMin, ...blocks.map((b) => b.endMin)) / 60);
  const hours = Array.from({ length: Math.max(1, hi - lo) }, (_, i) => lo + i);
  const label = (h: number) => (h12 ? `${((h + 11) % 12) + 1}:00 ${h < 12 || h === 24 ? "AM" : "PM"}` : minToHm(h * 60));
  const total = hours.length * HOUR_PX;

  if (!cols.length) return <p className="grid h-40 place-items-center text-sm text-muted">Add stylists to see the day schedule.</p>;
  return (
    <div>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 px-5 pb-3 text-xs text-muted" aria-label="Stylists">
        {cols.map((c) => <span key={c.id} className="inline-flex items-center gap-1.5"><span className="size-2 rounded-full" style={{ background: c.color }} />{c.name}</span>)}
      </div>
      <div className="max-h-[420px] overflow-y-auto px-5 pb-5">
        <div className="relative flex" style={{ height: total }}>
          <div className="w-16 shrink-0" aria-hidden>
            {hours.map((h) => <div key={h} className="text-[11px] text-muted" style={{ height: HOUR_PX }}>{label(h)}</div>)}
          </div>
          <div className="relative grid flex-1 gap-2.5" style={{ gridTemplateColumns: `repeat(${cols.length}, minmax(0, 1fr))` }}>
            {hours.map((h, i) => <div key={h} className="pointer-events-none absolute inset-x-0 border-t border-line/70" style={{ top: i * HOUR_PX + 7 }} />)}
            {cols.map((c) => (
              <div key={c.id} className="relative">
                {blocks.filter((b) => b.staffId === c.id).map((b) => {
                  const top = ((b.startMin - lo * 60) / 60) * HOUR_PX + 7, height = Math.max(26, ((b.endMin - b.startMin) / 60) * HOUR_PX - 4);
                  return (
                    <div key={b.id} title={`${b.service} · ${b.customer} · ${minToHm(b.startMin)}–${minToHm(b.endMin)}`}
                      className="absolute inset-x-0 overflow-hidden rounded-lg border px-2 py-1 text-center text-[11px] font-medium leading-tight"
                      style={{ top, height, background: `color-mix(in srgb, ${c.color} 22%, var(--surface))`, borderColor: `color-mix(in srgb, ${c.color} 60%, transparent)`, color: `color-mix(in srgb, ${c.color} 35%, var(--text))` }}>
                      <span className="block truncate">{b.service}</span>
                      {height > 44 && <span className="block truncate text-[10px] opacity-75">{b.customer}</span>}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
