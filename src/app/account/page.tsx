import Link from "next/link";
import { requireUser } from "@/server/session";
import { PasswordForm } from "@/components/password-form";
import { logoutAction } from "@/app/actions";

export const metadata = { title: "Account" };
export default async function Page() {
  const u = await requireUser();
  return (
    <div className="grid min-h-dvh place-items-center p-4">
      <div className="card page-in w-full max-w-md p-7">
        <h1 className="text-xl font-semibold">{u.mustChangePassword ? "Choose your own password" : "Your account"}</h1>
        <p className="mt-1 text-sm text-muted">{u.name} · {u.email}</p>
        {u.mustChangePassword && <p role="status" className="mt-4 rounded-lg bg-warn/10 px-3 py-2 text-sm text-warn">You signed in with a temporary password. Please choose a new one to continue.</p>}
        <div className="mt-5"><PasswordForm forced={u.mustChangePassword} /></div>
        <div className="mt-5 flex items-center justify-between text-sm">
          {u.mustChangePassword ? <span /> : <Link href={u.isPlatformAdmin ? "/admin" : "/dashboard"} className="font-semibold text-brand">← Back</Link>}
          <form action={logoutAction}><button className="text-muted hover:text-ink">Sign out</button></form>
        </div>
        {u.mustChangePassword && <p className="mt-4 text-center text-xs text-muted"><Link href="/dashboard" className="font-semibold text-brand">Continue to the app</Link> after changing your password.</p>}
      </div>
    </div>
  );
}
