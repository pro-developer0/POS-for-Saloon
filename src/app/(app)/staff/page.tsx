import { labelsOf } from "@/lib/verticals";
import { requireCtx } from "@/server/session";
import { listServices, listStaff, listTimeOff } from "@/server/services/crm";
import { staffPerformance, rangeFor } from "@/server/services/reports";
import { Card, Empty, PageHeader, Field, StatusBadge, money } from "@/components/ui";
import { ActionButton, ModalForm } from "@/components/forms";
import { WeekEditor } from "@/components/week-editor";
import { deleteTimeOffAction, saveStaffAction, timeOffAction } from "@/app/actions";
import { fmtDateTime, zonedParts } from "@/lib/time";

export const metadata = { title: "Staff" };
type S = Awaited<ReturnType<typeof listStaff>>[number];

function StaffFields({ s, svcs, canSalary, tenantHours }: { s?: S; svcs: { id: string; name: string }[]; canSalary: boolean; tenantHours: S["schedule"] }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {s && <input type="hidden" name="id" value={s.id} />}
      <Field label="Name"><input name="name" required className="input" defaultValue={s?.name} /></Field>
      <Field label="Job title"><input name="jobTitle" className="input" defaultValue={s?.jobTitle ?? ""} /></Field>
      <Field label="Phone"><input name="phone" className="input" defaultValue={s?.phone ?? ""} /></Field>
      <Field label="Email"><input name="email" type="email" className="input" defaultValue={s?.email ?? ""} /></Field>
      <Field label="Commission %"><input name="commissionPct" type="number" step="0.01" min="0" max="100" className="input" defaultValue={s?.commissionPct ?? "0"} /></Field>
      <Field label="Calendar color"><input name="color" type="color" className="input p-1" defaultValue={s?.color ?? "#7c3aed"} /></Field>
      {canSalary && <Field label="Salary (visible to authorized users only)"><input name="salary" type="number" step="0.01" min="0" className="input" defaultValue={s?.salary ?? ""} /></Field>}
      <div className="grid grid-cols-2 gap-2"><Field label="Daily break start"><input name="breakStart" type="time" className="input" defaultValue={s?.breaks[0]?.start ?? ""} /></Field><Field label="Break end"><input name="breakEnd" type="time" className="input" defaultValue={s?.breaks[0]?.end ?? ""} /></Field></div>
      <fieldset className="sm:col-span-2"><legend className="label">Working hours</legend><WeekEditor prefix="sch" value={s?.schedule ?? tenantHours} /></fieldset>
      <fieldset className="sm:col-span-2"><legend className="label">Services performed</legend>
        <div className="flex flex-wrap gap-3">{svcs.map((x) => <label key={x.id} className="flex items-center gap-1.5 text-sm"><input type="checkbox" name="serviceIds" value={x.id} defaultChecked={s?.serviceIds.includes(x.id)} />{x.name}</label>)}</div></fieldset>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="active" defaultChecked={s?.active ?? true} />Active</label>
    </div>
  );
}

export default async function Page() {
  const ctx = await requireCtx("staff.view", "staff");
  const [rows, svcs, off, perf] = await Promise.all([listStaff(ctx), listServices(ctx), listTimeOff(ctx), ctx.perms.has("reports.view") ? staffPerformance(ctx, rangeFor(ctx, "30d")) : []]);
  const can = ctx.perms.has("staff.manage"), canSalary = ctx.perms.has("staff.salary"), cur = ctx.tenant.currency, tz = ctx.tenant.timezone;
  const svcOpts = svcs.map((x) => ({ id: x.s.id, name: x.s.name }));
  const pm = new Map(perf.map((p) => [p.id, p]));
  void zonedParts;
  return (
    <div className="page-in">
      <PageHeader title={labelsOf(ctx.tenant).staff} desc="Profiles, schedules, commission and time off." actions={can ? <>
        <ModalForm trigger="Add time off" triggerClass="btn" title="Time off / leave" action={timeOffAction}>
          <Field label="Staff"><select name="staffId" required className="input">{rows.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
          <div className="grid grid-cols-2 gap-3"><Field label="From"><input name="from" type="date" required className="input" /></Field><Field label="To (inclusive)"><input name="to" type="date" required className="input" /></Field></div>
          <Field label="Reason"><input name="reason" className="input" /></Field></ModalForm>
        <ModalForm trigger="Add staff" title="New staff member" action={saveStaffAction} wide><StaffFields svcs={svcOpts} canSalary={canSalary} tenantHours={ctx.tenant.hours} /></ModalForm></> : null} />
      {rows.length === 0 ? <Card><Empty title="No staff yet" /></Card> : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {rows.map((s) => { const p = pm.get(s.id); return (
            <Card key={s.id} className="p-5">
              <div className="flex items-start gap-3">
                <div className="grid size-11 shrink-0 place-items-center rounded-full text-sm font-bold text-white" style={{ background: s.color }}>{s.name.split(" ").map((x) => x[0]).slice(0, 2).join("")}</div>
                <div className="min-w-0 flex-1"><p className="truncate font-semibold">{s.name}</p><p className="text-sm text-muted">{s.jobTitle ?? "Team member"}</p></div>
                <StatusBadge status={s.active ? "active" : "pending"} />
              </div>
              <dl className="mt-4 grid grid-cols-2 gap-2 text-sm"><div><dt className="text-xs text-muted">Commission</dt><dd>{s.commissionPct}%</dd></div>
                <div><dt className="text-xs text-muted">Services</dt><dd>{s.serviceIds.length || "All"}</dd></div>
                {p && <><div><dt className="text-xs text-muted">30-day revenue</dt><dd>{money(p.revenue, cur)}</dd></div><div><dt className="text-xs text-muted">Commission earned</dt><dd>{money(p.commission, cur)}</dd></div></>}
                {canSalary && s.salary !== null && <div><dt className="text-xs text-muted">Salary</dt><dd>{money(s.salary, cur)}</dd></div>}</dl>
              {can && <div className="mt-4"><ModalForm trigger="Edit" triggerClass="btn btn-sm" title={`Edit ${s.name}`} action={saveStaffAction} wide><StaffFields s={s} svcs={svcOpts} canSalary={canSalary} tenantHours={ctx.tenant.hours} /></ModalForm></div>}
            </Card>); })}
        </div>
      )}
      <Card title="Upcoming time off" className="mt-5">
        {off.length === 0 ? <p className="px-5 py-6 text-sm text-muted">No upcoming time off.</p> : <div className="overflow-x-auto"><table className="tbl"><tbody>{off.map(({ t, staffName }) => (
          <tr key={t.id}><td className="font-medium">{staffName}</td><td>{fmtDateTime(t.startsAt, tz)} → {fmtDateTime(t.endsAt, tz)}</td><td className="text-muted">{t.reason}</td><td className="text-right">{can && <ActionButton action={deleteTimeOffAction} args={[t.id]} confirm="Remove this time off?">Remove</ActionButton>}</td></tr>))}</tbody></table></div>}
      </Card>
    </div>
  );
}
