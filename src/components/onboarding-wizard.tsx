"use client";
import { useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { toast } from "sonner";
import { Check } from "lucide-react";
import { finishOnboardingAction, onboardingBusinessAction, onboardingStaffServiceAction } from "@/app/actions";

const STEPS = ["Brand", "Locale & tax", "Hours", "Services & team"];

export function OnboardingWizard({ identity, locale, hours }: { identity: ReactNode; locale: ReactNode; hours: ReactNode }) {
  const [step, setStep] = useState(0);
  const [pending, start] = useTransition();
  const router = useRouter();
  const reduce = useReducedMotion();
  const [err, setErr] = useState<string | null>(null);

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); setErr(null);
    const fd = new FormData(e.currentTarget);
    start(async () => {
      const r = step < 3 ? await onboardingBusinessAction(fd) : await onboardingStaffServiceAction(fd);
      if (!r.ok) return setErr(r.error ?? "Something went wrong");
      if (step < 3) return setStep(step + 1);
      const f = await finishOnboardingAction();
      if (!f.ok) return setErr(f.error ?? "Failed");
      toast.success("Your workspace is ready!"); router.replace("/dashboard"); router.refresh();
    });
  }

  return (
    <div className="mx-auto max-w-2xl p-4 py-8 sm:py-12">
      <h1 className="text-2xl font-semibold">Set up your workspace</h1>
      <p className="mt-1 text-sm text-muted">A few quick steps. You can change everything later in Settings.</p>
      <ol className="my-6 flex items-center gap-2" aria-label="Progress">
        {STEPS.map((s, i) => (
          <li key={s} className="flex flex-1 items-center gap-2">
            <span className={`grid size-7 shrink-0 place-items-center rounded-full text-xs font-bold transition-colors ${i <= step ? "bg-brand text-brandfg" : "bg-surface2 text-muted"}`} aria-current={i === step ? "step" : undefined}>{i < step ? <Check size={14} /> : i + 1}</span>
            <span className="hidden text-xs font-medium sm:block">{s}</span>
            {i < STEPS.length - 1 && <span className={`h-px flex-1 ${i < step ? "bg-brand" : "bg-line"}`} />}
          </li>
        ))}
      </ol>
      <form onSubmit={submit} className="card p-6">
        <AnimatePresence mode="wait">
          <motion.div key={step} initial={{ opacity: 0, x: reduce ? 0 : 24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: reduce ? 0 : -24 }} transition={{ duration: reduce ? 0 : 0.2 }}>
            {/* all step fields stay mounted-per-step; only the active step's inputs are submitted */}
            {step === 0 && identity}
            {step === 1 && locale}
            {step === 2 && hours}
            {step === 3 && (
              <div className="space-y-4">
                <div><label className="label" htmlFor="svc">Services — one per line: name, minutes, price</label>
                  <textarea id="svc" name="services" rows={5} className="input" placeholder={"Haircut, 30, 20\nColor, 90, 80"} /></div>
                <div><label className="label" htmlFor="stf">Team members — one name per line</label>
                  <textarea id="stf" name="staff" rows={4} className="input" placeholder={"Alex\nSam"} /></div>
                <p className="text-xs text-muted">Optional. New staff inherit your business hours; you can assign services and adjust schedules later.</p>
              </div>
            )}
          </motion.div>
        </AnimatePresence>
        {err && <p role="alert" className="mt-4 rounded-lg bg-bad/10 px-3 py-2 text-sm text-bad">{err}</p>}
        <div className="mt-6 flex justify-between">
          <button type="button" className="btn" disabled={step === 0 || pending} onClick={() => setStep(step - 1)}>Back</button>
          <button className="btn btn-primary" disabled={pending}>{pending ? "Saving…" : step === 3 ? "Finish setup" : "Continue"}</button>
        </div>
      </form>
    </div>
  );
}
