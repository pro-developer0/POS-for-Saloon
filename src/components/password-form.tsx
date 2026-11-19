"use client";
import { useActionState } from "react";
import Link from "next/link";
import { changePasswordAction } from "@/app/actions";
import type { Result } from "./forms";

export function PasswordForm({ forced }: { forced: boolean }) {
  const [state, act, pending] = useActionState<Result | null, FormData>(changePasswordAction, null);
  return (
    <form action={act} className="space-y-4">
      <div><label className="label" htmlFor="current">{forced ? "Temporary password you were given" : "Current password"}</label><input id="current" name="current" type="password" required autoComplete="current-password" className="input" /></div>
      <div><label className="label" htmlFor="password">New password</label><input id="password" name="password" type="password" required minLength={10} autoComplete="new-password" className="input" /><p className="mt-1 text-xs text-muted">At least 10 characters, with letters and numbers.</p></div>
      <div><label className="label" htmlFor="confirm">Confirm new password</label><input id="confirm" name="confirm" type="password" required minLength={10} autoComplete="new-password" className="input" /></div>
      {state && !state.ok && <p role="alert" className="rounded-lg bg-bad/10 px-3 py-2 text-sm text-bad">{state.error}</p>}
      {state?.ok && <p role="status" className="rounded-lg bg-ok/10 px-3 py-2 text-sm text-ok">{state.message}</p>}
      {state?.ok
        ? <Link href="/dashboard" className="btn btn-primary w-full">Continue</Link>
        : <button className="btn btn-primary w-full" disabled={pending}>{pending ? "Saving…" : "Change password"}</button>}
    </form>
  );
}
