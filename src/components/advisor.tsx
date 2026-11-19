"use client";
import { Fragment, useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { Copy, RotateCcw, ThumbsDown, ThumbsUp, Square, Plus, Trash2, Pencil, Send } from "lucide-react";
import { askAdvisorAction, deleteConversationAction, feedbackAction, loadConversationAction, renameConversationAction } from "@/app/actions";

type Msg = { id: string; role: string; content: string; feedback?: string | null; createdAt?: string; meta?: Record<string, unknown> | null };
type Conv = { id: string; title: string; updatedAt: string };

const PROMPTS = ["Analyze my business performance.", "Show my sales this month.", "Compare my revenue with last month.", "Find my most popular services.", "Give me marketing ideas.", "Help me increase customer retention.", "Identify inventory risks.", "Help me plan next week."];

function Md({ text }: { text: string }) {
  // minimal, XSS-safe renderer: React text nodes only (no innerHTML)
  const parts = text.split(/```/);
  return (
    <div className="prose-chat text-sm leading-relaxed">
      {parts.map((p, i) => i % 2 ? <pre key={i}>{p.replace(/^\w*\n/, "")}</pre> : (
        <Fragment key={i}>{p.split("\n").map((line, j) => <p key={j}>{line.split(/(\*\*[^*]+\*\*|_[^_]+_)/).map((s, k) => s.startsWith("**") ? <strong key={k}>{s.slice(2, -2)}</strong> : s.startsWith("_") && s.endsWith("_") && s.length > 2 ? <em key={k}>{s.slice(1, -1)}</em> : s)}</p>)}</Fragment>
      ))}
    </div>
  );
}

export function Advisor({ conversations: initial, enabled, reason }: { conversations: Conv[]; enabled: boolean; reason?: string }) {
  const [convs, setConvs] = useState(initial);
  const [active, setActive] = useState<string | null>(null);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [, start] = useTransition();
  const cancelled = useRef(false);
  const end = useRef<HTMLDivElement>(null);
  const lastQ = useRef("");
  useEffect(() => { end.current?.scrollIntoView({ behavior: "smooth" }); }, [msgs, busy]);

  async function send(q: string) {
    if (!q.trim() || busy) return;
    lastQ.current = q; cancelled.current = false; setInput("");
    setMsgs((m) => [...m, { id: "tmp" + Date.now(), role: "user", content: q, createdAt: new Date().toISOString() }]); setBusy(true);
    const r = await askAdvisorAction(active, q);
    setBusy(false);
    if (cancelled.current) return;
    if (!r.ok) { toast.error(r.error); return; }
    if (!active) { setActive(r.conversationId); setConvs((c) => [{ id: r.conversationId, title: q.slice(0, 50), updatedAt: new Date().toISOString() }, ...c]); }
    setMsgs((m) => [...m, { id: r.message.id, role: "assistant", content: r.message.content, meta: r.message.meta, createdAt: new Date().toISOString() }]);
  }
  async function open(id: string) { setActive(id); setMsgs([]); setMsgs(await loadConversationAction(id)); }
  const newChat = () => { setActive(null); setMsgs([]); };

  return (
    <div className="grid gap-4 lg:grid-cols-[16rem_1fr]">
      <aside className="card flex max-h-[70vh] flex-col p-3">
        <button className="btn btn-primary mb-2" onClick={newChat}><Plus size={16} />New conversation</button>
        <ul className="flex-1 space-y-1 overflow-y-auto">
          {convs.length === 0 && <li className="px-2 py-4 text-xs text-muted">No conversations yet.</li>}
          {convs.map((c) => (
            <li key={c.id} className={`group flex items-center gap-1 rounded-lg px-2 py-1.5 text-sm ${active === c.id ? "bg-brand/10" : "hover:bg-surface2"}`}>
              <button className="min-w-0 flex-1 truncate text-left" onClick={() => open(c.id)}>{c.title}</button>
              <button aria-label="Rename" className="opacity-0 group-hover:opacity-100 focus:opacity-100" onClick={() => { const t = prompt("Rename conversation", c.title); if (t) start(async () => { await renameConversationAction(c.id, t); setConvs((x) => x.map((y) => y.id === c.id ? { ...y, title: t } : y)); }); }}><Pencil size={13} /></button>
              <button aria-label="Delete" className="opacity-0 group-hover:opacity-100 focus:opacity-100" onClick={() => { if (confirm("Delete this conversation?")) start(async () => { await deleteConversationAction(c.id); setConvs((x) => x.filter((y) => y.id !== c.id)); if (active === c.id) newChat(); }); }}><Trash2 size={13} /></button>
            </li>))}
        </ul>
      </aside>
      <section className="card flex min-h-[60vh] flex-col">
        {!enabled && <p className="m-3 rounded-lg bg-warn/10 px-3 py-2 text-sm text-warn">{reason} You can still ask questions — you will receive verified figures without an AI narrative.</p>}
        <div className="flex-1 space-y-4 overflow-y-auto p-4" aria-live="polite">
          {msgs.length === 0 && (
            <div className="py-6 text-center"><p className="font-semibold">Ask about your business</p><p className="mx-auto mt-1 max-w-md text-sm text-muted">Totals are computed by the app from your own data. The AI only explains them, and never changes data.</p>
              <div className="mt-5 flex flex-wrap justify-center gap-2">{PROMPTS.map((p) => <button key={p} className="btn btn-sm" onClick={() => send(p)}>{p}</button>)}</div></div>)}
          {msgs.map((m, i) => (
            <div key={m.id} className={`flex ${m.role === "user" ? "justify-end" : ""}`}>
              <div className={`max-w-[92%] rounded-2xl px-4 py-3 ${m.role === "user" ? "bg-brand text-brandfg" : "bg-surface2"}`}>
                {m.role === "user" ? <p className="text-sm">{m.content}</p> : <Md text={m.content} />}
                {m.role === "assistant" && (
                  <div className="mt-2 flex items-center gap-1 text-muted">
                    {m.meta && <span className="mr-auto text-[11px]">{m.meta.ai ? `${m.meta.local ? "Local" : "Free cloud"} AI · ${String(m.meta.provider)}` : "Verified data only (no AI)"}</span>}
                    <button aria-label="Copy" className="btn btn-ghost btn-sm !px-2" onClick={() => { navigator.clipboard.writeText(m.content); toast.success("Copied"); }}><Copy size={14} /></button>
                    {i === msgs.length - 1 && <button aria-label="Retry" className="btn btn-ghost btn-sm !px-2" onClick={() => send(lastQ.current || msgs[i - 1]?.content)}><RotateCcw size={14} /></button>}
                    <button aria-label="Helpful" className={`btn btn-ghost btn-sm !px-2 ${m.feedback === "up" ? "text-ok" : ""}`} onClick={() => start(async () => { await feedbackAction(m.id, "up"); setMsgs((x) => x.map((y) => y.id === m.id ? { ...y, feedback: "up" } : y)); })}><ThumbsUp size={14} /></button>
                    <button aria-label="Not helpful" className={`btn btn-ghost btn-sm !px-2 ${m.feedback === "down" ? "text-bad" : ""}`} onClick={() => start(async () => { await feedbackAction(m.id, "down"); setMsgs((x) => x.map((y) => y.id === m.id ? { ...y, feedback: "down" } : y)); })}><ThumbsDown size={14} /></button>
                  </div>)}
                {m.createdAt && <p className="mt-1 text-[10px] opacity-60">{new Date(m.createdAt).toLocaleString()}</p>}
              </div>
            </div>))}
          {busy && <div className="flex items-center gap-3"><div className="skeleton h-10 w-64" aria-busy="true" /><button className="btn btn-sm" onClick={() => { cancelled.current = true; setBusy(false); }}><Square size={12} />Stop</button></div>}
          <div ref={end} />
        </div>
        <form className="flex gap-2 border-t border-line p-3" onSubmit={(e) => { e.preventDefault(); send(input); }}>
          <input className="input" placeholder="e.g. How much did I earn today?" value={input} maxLength={1500} onChange={(e) => setInput(e.target.value)} aria-label="Question" />
          <button className="btn btn-primary" disabled={busy || !input.trim()} aria-label="Send"><Send size={16} /></button>
        </form>
      </section>
    </div>
  );
}
