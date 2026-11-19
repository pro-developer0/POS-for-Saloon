"use client";
import { PRODUCT_NAME } from "@/lib/brand";
import { useActionState } from "react";
import Link from "next/link";
import { loginAction, registerAction, requestResetAction, resetPasswordAction, verifyEmailAction } from "@/app/actions";
import type { Result } from "./forms";
import { BUSINESS_TYPE_OPTIONS } from "@/lib/verticals";

function Shell({ title, sub, children, foot }: { title: string; sub: string; children: React.ReactNode; foot: React.ReactNode }) {
  return (
    <div className="grid min-h-dvh place-items-center p-4">
      <div className="card page-in w-full max-w-md p-7">
        <div className="mb-6">
          <div className="mb-4 grid size-11 place-items-center rounded-xl bg-brand text-lg font-bold text-brandfg">S</div>
          <h1 className="text-xl font-semibold">{title}</h1><p className="mt-1 text-sm text-muted">{sub}</p>
        </div>
        {children}
        <p className="mt-5 text-center text-sm text-muted">{foot}</p>
      </div>
    </div>
  );
}

export function LoginForm() {
  const [state, act, pending] = useActionState<Result | null, FormData>(loginAction, null);
  return (
    <Shell title="Welcome back" sub={`Sign in to your ${PRODUCT_NAME} workspace.`} foot={<>New here? <Link className="font-semibold text-brand" href="/register">Create your business</Link></>}>
      <form action={act} className="space-y-4">
        <div><label className="label" htmlFor="email">Email</label><input id="email" name="email" type="email" required autoComplete="email" className="input" /></div>
        <div><label className="label" htmlFor="password">Password</label><input id="password" name="password" type="password" required autoComplete="current-password" className="input" /><div className="mt-1.5 text-right"><Link href="/forgot-password" className="text-xs font-semibold text-brand">Forgot password?</Link></div></div>
        {state && !state.ok && <p role="alert" className="rounded-lg bg-bad/10 px-3 py-2 text-sm text-bad">{state.error}</p>}
        <button className="btn btn-primary w-full" disabled={pending}>{pending ? "Signing in…" : "Sign in"}</button>
      </form>
    </Shell>
  );
}

export function RegisterForm() {
  const [state, act, pending] = useActionState<Result | null, FormData>(registerAction, null);
  return (
    <Shell title="Create your business" sub="Set up your business in a few minutes." foot={<>Already registered? <Link className="font-semibold text-brand" href="/login">Sign in</Link></>}>
      <form action={act} className="space-y-4">
        <div><label className="label" htmlFor="name">Your name</label><input id="name" name="name" required className="input" autoComplete="name" /></div>
        <div><label className="label" htmlFor="email">Email</label><input id="email" name="email" type="email" required className="input" autoComplete="email" /></div>
        <div><label className="label" htmlFor="password">Password</label><input id="password" name="password" type="password" required minLength={10} className="input" autoComplete="new-password" /><p className="mt-1 text-xs text-muted">At least 10 characters, with letters and numbers.</p></div>
        <div><label className="label" htmlFor="businessName">Business name</label><input id="businessName" name="businessName" required className="input" /></div>
        <div><label className="label" htmlFor="businessType">Business type</label>
          <select id="businessType" name="businessType" className="input" required defaultValue="">
            <option value="" disabled>Select your business type…</option>{BUSINESS_TYPE_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
        {state && !state.ok && <p role="alert" className="rounded-lg bg-bad/10 px-3 py-2 text-sm text-bad">{state.error}</p>}
        <button className="btn btn-primary w-full" disabled={pending}>{pending ? "Creating…" : "Create account"}</button>
      </form>
    </Shell>
  );
}

export function ForgotForm() {
  const [state, act, pending] = useActionState<Result | null, FormData>(requestResetAction, null);
  return (
    <Shell title="Forgot your password?" sub="Enter your email and we will send you a reset link." foot={<Link className="font-semibold text-brand" href="/login">Back to sign in</Link>}>
      {state?.ok ? <p role="status" className="rounded-lg bg-ok/10 px-3 py-3 text-sm text-ok">{state.message}</p> : (
        <form action={act} className="space-y-4">
          <div><label className="label" htmlFor="email">Email</label><input id="email" name="email" type="email" required autoComplete="email" className="input" /></div>
          {state && !state.ok && <p role="alert" className="rounded-lg bg-bad/10 px-3 py-2 text-sm text-bad">{state.error}</p>}
          <button className="btn btn-primary w-full" disabled={pending}>{pending ? 'Sending…' : 'Send reset link'}</button>
        </form>)}
    </Shell>
  );
}

export function ResetForm({ token }: { token: string }) {
  const [state, act, pending] = useActionState<Result | null, FormData>(resetPasswordAction, null);
  return (
    <Shell title="Choose a new password" sub="At least 10 characters, with letters and numbers." foot={<Link className="font-semibold text-brand" href="/login">Back to sign in</Link>}>
      {state?.ok ? (<div className="space-y-4"><p role="status" className="rounded-lg bg-ok/10 px-3 py-3 text-sm text-ok">{state.message}</p><Link href="/login" className="btn btn-primary w-full">Sign in</Link></div>) : (
        <form action={act} className="space-y-4">
          <input type="hidden" name="token" value={token} />
          <div><label className="label" htmlFor="password">New password</label><input id="password" name="password" type="password" required minLength={10} autoComplete="new-password" className="input" /></div>
          <div><label className="label" htmlFor="confirm">Confirm password</label><input id="confirm" name="confirm" type="password" required minLength={10} autoComplete="new-password" className="input" /></div>
          {state && !state.ok && <p role="alert" className="rounded-lg bg-bad/10 px-3 py-2 text-sm text-bad">{state.error}</p>}
          <button className="btn btn-primary w-full" disabled={pending}>{pending ? 'Saving…' : 'Update password'}</button>
        </form>)}
    </Shell>
  );
}

export function VerifyForm({ token }: { token: string }) {
  const [state, act, pending] = useActionState<Result | null, FormData>(verifyEmailAction, null);
  return (
    <Shell title="Confirm your email" sub="One click and you are done." foot={<Link className="font-semibold text-brand" href="/dashboard">Go to dashboard</Link>}>
      {state?.ok ? <p role="status" className="rounded-lg bg-ok/10 px-3 py-3 text-sm text-ok">{state.message}</p> : (
        <form action={act} className="space-y-4"><input type="hidden" name="token" value={token} />
          {state && !state.ok && <p role="alert" className="rounded-lg bg-bad/10 px-3 py-2 text-sm text-bad">{state.error}</p>}
          <button className="btn btn-primary w-full" disabled={pending}>{pending ? 'Confirming…' : 'Confirm my email'}</button></form>)}
    </Shell>
  );
}
