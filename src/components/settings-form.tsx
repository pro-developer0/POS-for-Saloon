"use client";
import { useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { settingsAction } from "@/app/actions";

const TABS = ["Business", "Locale & tax", "Hours", "Modules", "AI"];
export function SettingsForm({ identity, locale, hours, modules, aiEnabled, aiPlatformOn }: { identity: ReactNode; locale: ReactNode; hours: ReactNode; modules: ReactNode; aiEnabled: boolean; aiPlatformOn: boolean }) {
  const [tab, setTab] = useState(0);
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <form onSubmit={(e) => { e.preventDefault(); const fd = new FormData(e.currentTarget); start(async () => { const r = await settingsAction(fd); if (r.ok) { toast.success("Settings saved"); router.refresh(); } else toast.error(r.error ?? "Failed"); }); }}>
      <div className="mb-5 flex gap-1 overflow-x-auto rounded-xl border border-line bg-surface p-1" role="tablist">
        {TABS.map((t, i) => <button type="button" role="tab" aria-selected={tab === i} key={t} onClick={() => setTab(i)} className={`whitespace-nowrap rounded-lg px-3.5 py-1.5 text-sm font-medium ${tab === i ? "bg-brand text-brandfg" : "text-muted hover:text-ink"}`}>{t}</button>)}
      </div>
      <div className="card p-5 sm:p-6">
        {/* all panels stay mounted (hidden) so one save submits every field */}
        <div hidden={tab !== 0}>{identity}</div><div hidden={tab !== 1}>{locale}</div><div hidden={tab !== 2}>{hours}</div><div hidden={tab !== 3}>{modules}</div>
        <div hidden={tab !== 4} className="space-y-3 text-sm">
          <input type="hidden" name="aiEnabledPresent" value="1" />
          <label className="flex items-center gap-2"><input type="checkbox" name="aiEnabled" defaultChecked={aiEnabled} />Enable AI features for this business</label>
          <p className="text-muted">{aiPlatformOn ? "The platform has AI enabled. AI uses only free or local models and is always optional." : "AI is currently turned off by the platform administrator. Everything else works normally."}</p>
        </div>
      </div>
      <div className="mt-4 flex justify-end"><button className="btn btn-primary" disabled={pending}>{pending ? "Saving…" : "Save settings"}</button></div>
    </form>
  );
}
