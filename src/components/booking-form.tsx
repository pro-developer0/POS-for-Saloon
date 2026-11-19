"use client";
import { useEffect, useState } from "react";
import { createAppointmentAction, slotsAction } from "@/app/actions";
import { ModalForm } from "./forms";

type Opt = { id: string; name: string; extra?: string; minutes?: number; price?: string; staffIds?: string[] };

export function BookingModal({ customers, services, staff, today, label = "New appointment", initial }: {
  customers: Opt[]; services: Opt[]; staff: Opt[]; today: string; label?: string; initial?: { date?: string; time?: string; staffId?: string };
}) {
  const [serviceId, setServiceId] = useState("");
  const [staffId, setStaffId] = useState(initial?.staffId ?? "");
  const [date, setDate] = useState(initial?.date ?? today);
  const [time, setTime] = useState(initial?.time ?? "");
  const [slots, setSlots] = useState<{ staffId: string; staffName: string; label: string }[] | null>(null);
  const [newCust, setNewCust] = useState(false);
  const svc = services.find((s) => s.id === serviceId);
  const eligible = staff.filter((s) => !svc?.staffIds?.length || svc.staffIds.includes(s.id));

  useEffect(() => {
    if (!serviceId || !date) { setSlots(null); return; }
    let live = true; setSlots(null);
    slotsAction(date, serviceId, staffId || undefined).then((r) => live && setSlots(r));
    return () => { live = false; };
  }, [serviceId, staffId, date]);

  return (
    <ModalForm trigger={label} title="Book appointment" action={createAppointmentAction} submitLabel="Book" wide>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <div className="mb-1 flex items-center justify-between"><span className="label !mb-0">Customer</span>
            <button type="button" className="text-xs font-semibold text-brand" onClick={() => setNewCust(!newCust)}>{newCust ? "Choose existing" : "+ New customer"}</button></div>
          {newCust ? (
            <div className="grid grid-cols-2 gap-2"><input name="newCustomerName" className="input" placeholder="Full name" required aria-label="New customer name" /><input name="newCustomerPhone" className="input" placeholder="Phone" aria-label="New customer phone" /></div>
          ) : (
            <select name="customerId" className="input" required aria-label="Customer"><option value="">Select customer…</option>{customers.map((c) => <option key={c.id} value={c.id}>{c.name}{c.extra ? ` · ${c.extra}` : ""}</option>)}</select>
          )}
        </div>
        <div><label className="label">Service</label>
          <select name="serviceId" className="input" required value={serviceId} onChange={(e) => setServiceId(e.target.value)}><option value="">Select…</option>{services.map((s) => <option key={s.id} value={s.id}>{s.name} · {s.minutes} min</option>)}</select></div>
        <div><label className="label">Staff</label>
          <select name="staffId" className="input" required value={staffId} onChange={(e) => setStaffId(e.target.value)}><option value="">Select…</option>{eligible.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
        <div><label className="label">Date</label><input type="date" name="date" className="input" value={date} min={today} onChange={(e) => setDate(e.target.value)} required /></div>
        <div><label className="label">Start time</label><input type="time" name="time" className="input" value={time} onChange={(e) => setTime(e.target.value)} required /></div>
        <div className="sm:col-span-2">
          <p className="label">Available times {slots && <span className="font-normal">({slots.length})</span>}</p>
          {!serviceId ? <p className="text-xs text-muted">Pick a service to see open slots.</p>
            : slots === null ? <div className="skeleton h-8" aria-busy="true" />
            : slots.length === 0 ? <p className="text-xs text-muted">No open slots on this date for the selection.</p>
            : <div className="flex max-h-28 flex-wrap gap-1.5 overflow-y-auto">
                {slots.filter((x, i, a) => !staffId ? a.findIndex((y) => y.label === x.label) === i : true).map((x) => (
                  <button type="button" key={`${x.staffId}${x.label}`} className={`btn btn-sm ${time === x.label ? "btn-primary" : ""}`} onClick={() => { setTime(x.label); if (!staffId) setStaffId(x.staffId); }}>{x.label}{!staffId && <span className="text-[10px] opacity-70">{x.staffName.split(" ")[0]}</span>}</button>
                ))}
              </div>}
        </div>
        <div><label className="label">Price override (optional)</label><input name="price" type="number" step="0.01" min="0" className="input" placeholder={svc?.price} /></div>
        <div><label className="label">Discount</label><input name="discount" type="number" step="0.01" min="0" defaultValue="0" className="input" /></div>
        <div><label className="label">Status</label><select name="status" className="input"><option value="confirmed">Confirmed</option><option value="pending">Pending</option></select></div>
        <div><label className="label">Source</label><select name="source" className="input"><option value="staff">Front desk</option><option value="phone">Phone</option><option value="walk_in">Walk-in</option><option value="online">Online</option></select></div>
        <div className="sm:col-span-2"><label className="label">Notes</label><textarea name="notes" rows={2} className="input" /></div>
      </div>
    </ModalForm>
  );
}
