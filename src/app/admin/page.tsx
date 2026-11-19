import { PRODUCT_NAME } from "@/lib/brand";
import Link from "next/link";
import { redirect } from "next/navigation";
import { desc, eq, ilike, or, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { auditLogs, tenants, users, aiUsage } from "@/db/schema";
import { getUser } from "@/server/session";
import { getAiConfig, aiUsageSummary } from "@/server/ai/service";
import { FREE_PROVIDERS, providerConfigured } from "@/server/ai/providers";
import { Card, Stat, StatusBadge, Tabs, Field } from "@/components/ui";
import { ActionButton, ModalForm } from "@/components/forms";
import { adminAiConfigAction, adminCreateBusinessAction, adminResetPasswordAction, adminSetTenantStatusAction, adminSetUserDisabledAction, adminTestAiAction } from "@/app/actions";
import { listUsersForAdmin } from "@/server/admin";
import { BUSINESS_TYPE_OPTIONS } from "@/lib/verticals";
import { CURRENCIES, TIMEZONES } from "@/lib/constants";
import { logoutAction } from "@/app/actions";

export const metadata = { title: "Platform admin" };
const TENANT_ID = sql.raw('"tenants"."id"'); // qualified on purpose: subqueries have their own "id" columns

export default async function Page({ searchParams }: { searchParams: Promise<{ tab?: string; q?: string }> }) {
  const u = await getUser();
  if (!u) redirect("/login");
  if (!u.isPlatformAdmin) redirect("/forbidden");
  if (u.mustChangePassword) redirect("/account");
  const sp = await searchParams; const tab = ["tenants", "users", "ai", "audit", "health"].includes(sp.tab ?? "") ? sp.tab! : "tenants";
  const d = await db();
  const tabs = [["tenants", "Businesses"], ["users", "Users"], ["ai", "AI settings & usage"], ["audit", "Audit log"], ["health", "System health"]].map(([k, l]) => ({ key: k, label: l, href: `/admin?tab=${k}` }));
  return (
    <div className="mx-auto max-w-6xl p-4 sm:p-6">
      <header className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-3"><div className="grid size-10 place-items-center rounded-xl bg-brand font-bold text-brandfg">S</div><div><h1 className="text-xl font-semibold">{PRODUCT_NAME} platform admin</h1><p className="text-xs text-muted">Tenant metadata and aggregates only — private business data is not shown here.</p></div></div>
        <div className="flex gap-2"><Link href="/account" className="btn btn-sm">Account</Link><Link href="/dashboard" className="btn btn-sm">Workspace</Link><form action={logoutAction}><button className="btn btn-sm">Sign out</button></form></div>
      </header>
      <Tabs active={tab} tabs={tabs} />
      {tab === "tenants" && await (async () => {
        const q = sp.q?.trim();
        const rows = await d.select({ t: tenants, owners: sql<number>`(select count(*) from memberships m where m.tenant_id = ${TENANT_ID} and m.active)::int`, ownerEmail: sql<string | null>`(select u2.email from memberships m2 join users u2 on u2.id = m2.user_id where m2.tenant_id = ${TENANT_ID} and m2.role = 'owner' and m2.active order by m2.created_at limit 1)`, customers: sql<number>`(select count(*) from customers c where c.tenant_id = ${TENANT_ID})::int`, sales: sql<number>`(select count(*) from transactions x where x.tenant_id = ${TENANT_ID})::int` })
          .from(tenants).where(q ? or(ilike(tenants.name, `%${q}%`), ilike(tenants.slug, `%${q}%`)) : undefined).orderBy(desc(tenants.createdAt)).limit(200);
        const [{ n: nu }] = await d.select({ n: sql<number>`count(*)::int` }).from(users);
        return (<>
          <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4"><Stat label="Businesses" value={rows.length} /><Stat label="Active" value={rows.filter((r) => r.t.status === "active").length} /><Stat label="Suspended" value={rows.filter((r) => r.t.status === "suspended").length} /><Stat label="Users" value={nu} /></div>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2"><form className="flex gap-2"><input name="q" defaultValue={sp.q} className="input max-w-xs" placeholder="Search businesses…" aria-label="Search" /><input type="hidden" name="tab" value="tenants" /><button className="btn">Search</button></form>
            <ModalForm trigger="Create business" title="Create a client business" action={adminCreateBusinessAction} submitLabel="Create business" wide>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Business name"><input name="businessName" required className="input" /></Field>
                <Field label="Business type"><select name="businessType" required defaultValue="" className="input"><option value="" disabled>Select…</option>{BUSINESS_TYPE_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Field>
                <Field label="Owner name"><input name="ownerName" required className="input" /></Field>
                <Field label="Owner email (their login)"><input name="ownerEmail" type="email" required className="input" /></Field>
                <Field label="Currency"><select name="currency" defaultValue="PKR" className="input">{CURRENCIES.map((c) => <option key={c}>{c}</option>)}</select></Field>
                <Field label="Timezone"><select name="timezone" defaultValue="Asia/Karachi" className="input">{TIMEZONES.map((z) => <option key={z}>{z}</option>)}</select></Field>
                <div className="sm:col-span-2"><Field label="Temporary password (optional)" hint="Leave blank to generate one. The owner must change it at first login."><input name="password" type="text" autoComplete="off" className="input" /></Field></div>
              </div>
              <p className="text-xs text-muted">The owner finishes setup (logo, colours, hours, tax) after their first login. The type cannot be changed afterwards.</p>
            </ModalForm></div>
          <Card><div className="overflow-x-auto"><table className="tbl"><thead><tr><th>Business</th><th>Type</th><th>Status</th><th>Owner</th><th>Members</th><th>Customers</th><th>Sales</th><th /></tr></thead>
            <tbody>{rows.map(({ t, owners, customers, sales, ownerEmail }) => (<tr key={t.id}><td className="font-medium">{t.name}{t.isDemo && <span className="badge ml-2">demo</span>}<span className="block text-xs font-normal text-muted">{t.currency} · {t.timezone}</span></td><td className="capitalize">{t.businessType.replace(/_/g, " ")}</td><td><StatusBadge status={t.status} /></td><td className="text-muted">{ownerEmail ?? "—"}</td><td>{owners}</td><td>{customers}</td><td>{sales}</td>
              <td><div className="flex justify-end gap-1.5">{t.status !== "active" && <ActionButton action={adminSetTenantStatusAction} args={[t.id, "active"]} className="btn btn-sm btn-primary">Activate</ActionButton>}{t.status !== "suspended" && <ActionButton action={adminSetTenantStatusAction} args={[t.id, "suspended"]} confirm={`Suspend ${t.name}? Their users will lose access immediately.`} className="btn btn-sm btn-danger">Suspend</ActionButton>}</div></td></tr>))}</tbody></table></div></Card></>);
      })()}
      {tab === "users" && await (async () => {
        const rows = await listUsersForAdmin(d, sp.q?.trim());
        return (<>
          <form className="mb-4 flex gap-2"><input name="q" defaultValue={sp.q} className="input max-w-xs" placeholder="Search name or email…" aria-label="Search users" /><input type="hidden" name="tab" value="users" /><button className="btn">Search</button></form>
          <Card><div className="overflow-x-auto"><table className="tbl"><thead><tr><th>User</th><th>Businesses & roles</th><th>Status</th><th /></tr></thead>
            <tbody>{rows.map((r) => (<tr key={r.id}><td className="font-medium">{r.name}<span className="block text-xs font-normal text-muted">{r.email}</span></td><td className="text-muted">{r.is_admin ? "Platform admin" : r.biz ?? "—"}</td>
              <td>{r.disabled ? <StatusBadge status="suspended" /> : <StatusBadge status="active" />}{r.must_change && <span className="badge ml-1">must change password</span>}</td>
              <td><div className="flex justify-end gap-1.5">{!r.is_admin && <>
                <ActionButton action={adminResetPasswordAction} args={[r.id]} confirm={`Issue a new temporary password for ${r.email}? They will be signed out everywhere.`}>Reset password</ActionButton>
                <ActionButton action={adminSetUserDisabledAction} args={[r.id, !r.disabled]} confirm={r.disabled ? undefined : `Disable ${r.email}? They will be signed out and cannot log in.`} className={r.disabled ? "btn btn-sm btn-primary" : "btn btn-sm btn-danger"}>{r.disabled ? "Enable" : "Disable"}</ActionButton></>}</div></td></tr>))}</tbody></table></div></Card></>);
      })()}
      {tab === "ai" && await (async () => {
        const cfg = await getAiConfig(d); const usage = await aiUsageSummary(d);
        const [{ n }] = await d.select({ n: sql<number>`count(*)::int` }).from(aiUsage).where(sql`${aiUsage.createdAt} > now() - interval '24 hours' and ${aiUsage.status} = 'ok'`);
        return (<div className="space-y-4">
          <Card className="border-ok/40 p-5 text-sm"><p className="font-semibold text-ok">Free-only guarantee</p><p className="mt-1 text-muted">Only the providers below can be called, cloud hosts are allowlisted, OpenRouter is restricted to “:free” models, and there is no fallback to any paid provider. If a free quota is reached, requests stop and the app continues without AI. API keys are read from server environment variables only. Free tiers and their commercial-use terms change — verify them with each provider before enabling for customers.</p></Card>
          <div className="grid gap-4 lg:grid-cols-2">
            <Card title="Configuration"><form className="space-y-3 p-5" action={async (fd) => { "use server"; await adminAiConfigAction(fd); }}>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="enabled" defaultChecked={cfg.enabled} />AI enabled (master switch)</label>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="cloudDisabled" defaultChecked={cfg.cloudDisabled} />Disable all cloud AI (local only)</label>
              <Field label="Mode"><select name="mode" defaultValue={cfg.mode} className="input"><option value="local">Local only (Ollama)</option><option value="cloud_free">Free cloud provider only</option><option value="auto">Local first, then free cloud</option></select></Field>
              <Field label="Provider"><select name="provider" defaultValue={cfg.provider} className="input">{Object.entries(FREE_PROVIDERS).map(([k, v]) => <option key={k} value={k}>{v.label}{v.local ? "" : providerConfigured(k as "groq") ? " — key set" : " — no key"}</option>)}</select></Field>
              <Field label="Model"><input name="model" defaultValue={cfg.model} className="input" /></Field>
              <Field label="Ollama URL"><input name="ollamaUrl" defaultValue={cfg.ollamaUrl} className="input" /></Field>
              <div className="grid grid-cols-2 gap-3"><Field label="Per-business daily limit"><input name="perTenantDailyLimit" type="number" min="0" defaultValue={cfg.perTenantDailyLimit} className="input" /></Field><Field label="Platform daily limit"><input name="globalDailyLimit" type="number" min="0" defaultValue={cfg.globalDailyLimit} className="input" /></Field></div>
              <button className="btn btn-primary">Save configuration</button>
            </form></Card>
            <Card title="Status & usage (30 days)"><div className="space-y-3 p-5 text-sm">
              <p>Requests in last 24h: <b>{n}</b> / {cfg.globalDailyLimit}</p>
              <ActionButton className="btn" action={adminTestAiAction}>Test provider connection</ActionButton>
              <p className="text-xs text-muted">Provider keys: {Object.entries(FREE_PROVIDERS).filter(([, v]) => !v.local).map(([k, v]) => `${k}: ${providerConfigured(k as "groq") ? "set" : "not set"} (${v.envKey})`).join(" · ")}</p>
              <table className="tbl"><thead><tr><th>Provider</th><th>Status</th><th className="text-right">Requests</th><th className="text-right">Tokens</th></tr></thead><tbody>{usage.byProvider.map((r) => <tr key={r.provider + r.status}><td>{r.provider}{FREE_PROVIDERS[r.provider as "groq"]?.local ? " (local)" : " (free cloud)"}</td><td>{r.status}</td><td className="text-right">{r.n}</td><td className="text-right">{r.tokens}</td></tr>)}{!usage.byProvider.length && <tr><td colSpan={4} className="text-muted">No AI requests yet.</td></tr>}</tbody></table>
              <p className="label !mb-0 pt-2">By business</p>
              <table className="tbl"><tbody>{usage.byTenant.map((r) => <tr key={r.name}><td>{r.name}</td><td className="text-right">{r.n}</td></tr>)}</tbody></table>
            </div></Card>
          </div></div>);
      })()}
      {tab === "audit" && await (async () => {
        const rows = await d.select({ a: auditLogs, tenant: tenants.name, user: users.email }).from(auditLogs).leftJoin(tenants, eq(tenants.id, auditLogs.tenantId)).leftJoin(users, eq(users.id, auditLogs.userId)).orderBy(desc(auditLogs.createdAt)).limit(200);
        return <Card><div className="overflow-x-auto"><table className="tbl"><thead><tr><th>When</th><th>Business</th><th>User</th><th>Action</th><th>Entity</th></tr></thead><tbody>{rows.map(({ a, tenant, user }) => <tr key={a.id}><td className="whitespace-nowrap">{a.createdAt.toISOString().replace("T", " ").slice(0, 19)}</td><td>{tenant ?? "—"}</td><td className="text-muted">{user ?? "—"}</td><td className="font-medium">{a.action}</td><td className="text-muted">{a.entity}</td></tr>)}</tbody></table></div></Card>;
      })()}
      {tab === "health" && await (async () => {
        const t0 = Date.now(); await d.execute(sql`select 1`); const ms = Date.now() - t0;
        const [errs] = await d.select({ n: sql<number>`count(*)::int` }).from(aiUsage).where(sql`${aiUsage.status} = 'error' and ${aiUsage.createdAt} > now() - interval '24 hours'`);
        return <div className="grid grid-cols-2 gap-3 lg:grid-cols-4"><Stat label="Database" value="OK" tone="ok" hint={`${process.env.DATABASE_URL ? "PostgreSQL" : "Embedded PGlite (dev)"} · ${ms} ms`} /><Stat label="AI errors (24h)" value={errs.n} tone={errs.n ? "warn" : "ok"} /><Stat label="Node" value={process.version} /><Stat label="Uptime" value={`${Math.round(process.uptime() / 60)} min`} /></div>;
      })()}
    </div>
  );
}
void ModalForm;
