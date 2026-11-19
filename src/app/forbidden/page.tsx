import Link from "next/link";
export default function Forbidden() {
  return (<div className="grid min-h-dvh place-items-center p-6 text-center"><div><h1 className="text-2xl font-semibold">Access denied</h1><p className="mt-2 text-muted">Your role does not include permission for that page.</p><Link href="/dashboard" className="btn btn-primary mt-5">Back to dashboard</Link></div></div>);
}
