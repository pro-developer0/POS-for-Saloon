"use client";
import { useRef, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { X } from "lucide-react";

export type Result = { ok: boolean; error?: string; message?: string; data?: unknown };

export function ModalForm({
  trigger, title, action, children, submitLabel = "Save", triggerClass = "btn btn-primary", wide, onDone,
}: {
  trigger: ReactNode; title: string; action: (fd: FormData) => Promise<Result>; children: ReactNode;
  submitLabel?: string; triggerClass?: string; wide?: boolean; onDone?: (r: Result) => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  return (
    <>
      <button type="button" className={triggerClass} onClick={() => { setErr(null); ref.current?.showModal(); }}>{trigger}</button>
      <dialog ref={ref} className="modal" style={wide ? { width: "min(760px, calc(100vw - 2rem))" } : undefined}
        onClick={(e) => { if (e.target === ref.current) ref.current?.close(); }} aria-label={title}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            start(async () => {
              const r = await action(fd);
              if (!r.ok) { setErr(r.error ?? "Something went wrong"); return; }
              toast.success(r.message ?? "Saved", (r.data as { sticky?: boolean } | undefined)?.sticky ? { duration: 120000 } : undefined);
              ref.current?.close(); router.refresh(); onDone?.(r);
            });
          }}
        >
          <header className="flex items-center justify-between border-b border-line px-5 py-4">
            <h2 className="font-semibold">{title}</h2>
            <button type="button" className="btn btn-ghost btn-sm" aria-label="Close" onClick={() => ref.current?.close()}><X size={16} /></button>
          </header>
          <div className="max-h-[65vh] space-y-4 overflow-y-auto px-5 py-4">
            {children}
            {err && <p role="alert" className="rounded-lg bg-bad/10 px-3 py-2 text-sm text-bad">{err}</p>}
          </div>
          <footer className="flex justify-end gap-2 border-t border-line px-5 py-3.5">
            <button type="button" className="btn" onClick={() => ref.current?.close()}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={pending}>{pending ? "Saving…" : submitLabel}</button>
          </footer>
        </form>
      </dialog>
    </>
  );
}

export function ActionButton({ action, args = [], children, confirm, className = "btn btn-sm", success }: {
  action: (...a: never[]) => Promise<Result>; args?: unknown[]; children: ReactNode; confirm?: string; className?: string; success?: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button type="button" className={className} disabled={pending} onClick={() => {
      if (confirm && !window.confirm(confirm)) return;
      start(async () => {
        const r = await (action as (...a: unknown[]) => Promise<Result>)(...args);
        if (r.ok) { toast.success(success ?? r.message ?? "Done", (r.data as { sticky?: boolean } | undefined)?.sticky ? { duration: 120000 } : undefined); router.refresh(); } else toast.error(r.error ?? "Failed");
      });
    }}>{children}</button>
  );
}
