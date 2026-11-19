import { eq, and } from "drizzle-orm";
import { requireCtx } from "@/server/session";
import { memberships, users } from "@/db/schema";
import { getAiConfig } from "@/server/ai/service";
import { SettingsForm } from "@/components/settings-form";
import { HoursFields, IdentityFields, LocaleFields } from "@/components/business-fields";
import { Card, PageHeader, Field, StatusBadge } from "@/components/ui";
import { ActionButton, ModalForm } from "@/components/forms";
import { addMemberAction, removeMemberAction } from "@/app/actions";
import { ROLES } from "@/lib/permissions";

export const metadata = { title: "Settings" };
export default async function Page() {
  const ctx = await requireCtx("settings.manage");
  const t = ctx.tenant;
  const [members, ai] = await Promise.all([
    ctx.db.select({ id: memberships.id, role: memberships.role, name: users.name, email: users.email }).from(memberships).innerJoin(users, eq(users.id, memberships.userId)).where(and(eq(memberships.tenantId, ctx.tenantId), eq(memberships.active, true))),
    getAiConfig(ctx.db),
  ]);
  const canMembers = ctx.perms.has("members.manage");
  return (
    <div className="page-in">
      <PageHeader title="Settings" desc={`Workspace plan: ${t.plan} · status: ${t.status}${t.trialEndsAt ? ` · trial ends ${t.trialEndsAt.toISOString().slice(0, 10)}` : ""}`} />
      <SettingsForm identity={<IdentityFields t={t} />} locale={<LocaleFields t={t} />} hours={<HoursFields t={t} />} aiEnabled={t.aiEnabled} aiPlatformOn={ai.enabled} />
      <Card title="Team & access" className="mt-6" action={canMembers ? <ModalForm trigger="Add member" triggerClass="btn btn-sm btn-primary" title="Add team member" action={addMemberAction}>
        <Field label="Email"><input name="email" type="email" required className="input" /></Field>
        <Field label="Name (for new users)"><input name="name" className="input" /></Field>
        <Field label="Role"><select name="role" className="input">{ROLES.filter((r) => r !== "owner").map((r) => <option key={r} value={r}>{r}</option>)}</select></Field>
        <Field label="Temporary password (only if the person has no account yet)"><input name="password" type="password" minLength={10} className="input" autoComplete="new-password" /></Field>
      </ModalForm> : null}>
        <div className="overflow-x-auto"><table className="tbl"><thead><tr><th>Name</th><th>Email</th><th>Role</th><th /></tr></thead>
          <tbody>{members.map((m) => (<tr key={m.id}><td className="font-medium">{m.name}</td><td className="text-muted">{m.email}</td><td><StatusBadge status={m.role === "owner" ? "active" : "pending"} /> <span className="capitalize">{m.role}</span></td>
            <td className="text-right">{canMembers && m.role !== "owner" && <ActionButton action={removeMemberAction} args={[m.id]} confirm={`Remove ${m.name}'s access?`} className="btn btn-sm btn-danger">Remove</ActionButton>}</td></tr>))}</tbody></table></div>
      </Card>
    </div>
  );
}
