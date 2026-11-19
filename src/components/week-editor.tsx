import type { WeekHours } from "@/db/schema";
import { DAY_NAMES } from "@/lib/constants";

/** Plain (server-renderable) weekly hours inputs: <prefix>{0-6}_open / _close / _off */
export function WeekEditor({ prefix, value }: { prefix: string; value: WeekHours }) {
  return (
    <div className="space-y-2">
      {DAY_NAMES.map((d, i) => {
        const v = value[String(i) as "0"];
        return (
          <div key={i} className="grid grid-cols-[5.5rem_1fr_1fr_auto] items-center gap-2 text-sm">
            <span className="font-medium">{d.slice(0, 3)}</span>
            <input type="time" name={`${prefix}${i}_open`} defaultValue={v?.open ?? "09:00"} className="input" aria-label={`${d} opens`} />
            <input type="time" name={`${prefix}${i}_close`} defaultValue={v?.close ?? "18:00"} className="input" aria-label={`${d} closes`} />
            <label className="flex items-center gap-1.5 text-xs text-muted"><input type="checkbox" name={`${prefix}${i}_off`} defaultChecked={!v} />Closed</label>
          </div>
        );
      })}
    </div>
  );
}
