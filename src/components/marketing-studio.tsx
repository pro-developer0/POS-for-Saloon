"use client";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { generateMarketingAction, saveContentAction, deleteContentAction } from "@/app/actions";

type Saved = { id: string; kind: string; title: string; content: string; createdAt: string };
const PLATFORMS = ["Instagram", "Facebook", "WhatsApp", "SMS", "Email", "TikTok", "Google Business"];
const KINDS = ["social media caption", "Instagram post with hashtags", "Facebook post", "promotional offer", "campaign idea", "WhatsApp message draft", "customer re-engagement message", "service description", "business announcement", "seasonal promotion", "weekly marketing calendar", "hashtag set"];

export function MarketingStudio({ saved, services, preset, aiNote }: { saved: Saved[]; services: string[]; preset?: { kind?: string; audience?: string; promotion?: string }; aiNote?: string }) {
  const [text, setText] = useState("");
  const [meta, setMeta] = useState("");
  const [pending, start] = useTransition();
  const [last, setLast] = useState<FormData | null>(null);
  const router = useRouter();
  const gen = (fd: FormData) => start(async () => {
    const r = await generateMarketingAction(fd); setLast(fd);
    if (!r.ok) { toast.error(r.error); return; }
    setText(r.text); setMeta(`${r.local ? "Local" : "Free cloud"} AI · ${r.provider}`);
  });
  const download = () => { const b = new Blob([text], { type: "text/plain" }); const a = document.createElement("a"); a.href = URL.createObjectURL(b); a.download = "marketing.txt"; a.click(); URL.revokeObjectURL(a.href); };
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <form className="card space-y-3 p-5" onSubmit={(e) => { e.preventDefault(); gen(new FormData(e.currentTarget)); }}>
        {aiNote && <p className="rounded-lg bg-warn/10 px-3 py-2 text-xs text-warn">{aiNote}</p>}
        <div className="grid grid-cols-2 gap-3">
          <div><label className="label">Platform</label><select name="platform" className="input">{PLATFORMS.map((p) => <option key={p}>{p}</option>)}</select></div>
          <div><label className="label">Content type</label><select name="kind" className="input" defaultValue={preset?.kind ?? KINDS[0]}>{KINDS.map((p) => <option key={p}>{p}</option>)}</select></div>
          <div><label className="label">Service (optional)</label><select name="service" className="input"><option value="">Any</option>{services.map((s) => <option key={s}>{s}</option>)}</select></div>
          <div><label className="label">Tone</label><select name="tone" className="input">{["friendly", "luxurious", "playful", "professional", "urgent", "warm"].map((t) => <option key={t}>{t}</option>)}</select></div>
          <div><label className="label">Language</label><input name="language" className="input" defaultValue="English" /></div>
          <div><label className="label">Length</label><select name="length" className="input" defaultValue="medium"><option value="short">Short</option><option value="medium">Medium</option><option value="long">Long</option></select></div>
        </div>
        <div><label className="label">Promotion details (only what is real)</label><input name="promotion" className="input" defaultValue={preset?.promotion} placeholder="e.g. 20% off colour services until Friday" /></div>
        <div><label className="label">Audience</label><input name="audience" className="input" defaultValue={preset?.audience} placeholder="e.g. returning customers, brides-to-be" /></div>
        <div className="flex gap-2"><button className="btn btn-primary" disabled={pending}>{pending ? "Generating…" : "Generate"}</button>{last && <button type="button" className="btn" disabled={pending} onClick={() => gen(last)}>Regenerate</button>}</div>
        <p className="text-xs text-muted">Nothing is ever published or sent automatically. Review and edit before you use it.</p>
      </form>
      <div className="card flex flex-col p-5">
        <div className="mb-2 flex items-center justify-between"><h2 className="text-sm font-semibold">Result (editable)</h2><span className="text-[11px] text-muted">{meta}</span></div>
        <textarea className="input min-h-56 flex-1" value={text} onChange={(e) => setText(e.target.value)} placeholder="Generated content appears here…" aria-label="Generated content" />
        <div className="mt-3 flex flex-wrap gap-2">
          <button className="btn btn-sm" disabled={!text} onClick={() => { navigator.clipboard.writeText(text); toast.success("Copied"); }}>Copy</button>
          <button className="btn btn-sm" disabled={!text} onClick={download}>Export .txt</button>
          <button className="btn btn-sm btn-primary" disabled={!text} onClick={() => start(async () => { const r = await saveContentAction("marketing", text.slice(0, 40), text); if (r.ok) { toast.success("Saved"); router.refresh(); } else toast.error(r.error ?? "Failed"); })}>Save</button>
        </div>
      </div>
      <div className="card lg:col-span-2">
        <h2 className="border-b border-line px-5 py-3.5 text-sm font-semibold">Saved content</h2>
        {saved.length === 0 ? <p className="px-5 py-6 text-sm text-muted">Nothing saved yet.</p> : (
          <ul className="divide-y divide-line">{saved.map((s) => (
            <li key={s.id} className="flex items-start gap-3 px-5 py-3 text-sm"><p className="min-w-0 flex-1 whitespace-pre-wrap break-words">{s.content}</p>
              <button className="btn btn-sm" onClick={() => setText(s.content)}>Edit</button>
              <button className="btn btn-sm btn-danger" onClick={() => start(async () => { await deleteContentAction(s.id); router.refresh(); })}>Delete</button></li>))}</ul>)}
      </div>
    </div>
  );
}
