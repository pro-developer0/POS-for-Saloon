"use client";
import { appointmentStatusAction, rescheduleAction } from "@/app/actions";
import { ActionButton, ModalForm } from "./forms";

const NEXT: Record<string, [string, string][]> = {
  pending: [["confirmed", "Confirm"], ["cancelled", "Cancel"]],
  confirmed: [["checked_in", "Check in"], ["no_show", "No-show"], ["cancelled", "Cancel"]],
  checked_in: [["in_progress", "Start"], ["cancelled", "Cancel"]],
  in_progress: [],
  cancelled: [["pending", "Reopen"]], no_show: [["pending", "Reopen"]], completed: [],
};

export function ApptActions({ id, status, date, time, staffId, staff, billed }: { id: string; status: string; date: string; time: string; staffId: string; staff: { id: string; name: string }[]; billed: boolean }) {
  const canMove = !["completed", "cancelled", "no_show"].includes(status);
  return (
    <div className="flex flex-wrap justify-end gap-1.5">
      {(NEXT[status] ?? []).map(([s, l]) => (
        <ActionButton key={s} action={() => appointmentStatusAction(id, s)} confirm={s === "cancelled" || s === "no_show" ? `Mark this appointment as ${l.toLowerCase()}?` : undefined} className={`btn btn-sm ${s === "cancelled" || s === "no_show" ? "btn-danger" : ""}`}>{l}</ActionButton>
      ))}
      {canMove && (
        <ModalForm trigger="Reschedule" triggerClass="btn btn-sm" title="Reschedule appointment" action={rescheduleAction}>
          <input type="hidden" name="id" value={id} />
          <div className="grid grid-cols-2 gap-3">
            <div><label className="label">Date</label><input type="date" name="date" defaultValue={date} className="input" required /></div>
            <div><label className="label">Time</label><input type="time" name="time" defaultValue={time} className="input" required /></div>
            <div className="col-span-2"><label className="label">Staff</label><select name="staffId" defaultValue={staffId} className="input">{staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
          </div>
          <p className="text-xs text-muted">The new time is checked against business hours, staff schedule, breaks, time off and conflicts.</p>
        </ModalForm>
      )}
      {canMove && !billed && <a className="btn btn-sm btn-primary" href={`/pos?appointment=${id}`}>Check out</a>}
    </div>
  );
}
