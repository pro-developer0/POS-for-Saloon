import type { customers } from "@/db/schema";
import { Field } from "./ui";

export function CustomerFields({ c }: { c?: typeof customers.$inferSelect }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {c && <input type="hidden" name="id" value={c.id} />}
      <div className="sm:col-span-2"><Field label="Full name"><input name="name" required className="input" defaultValue={c?.name} /></Field></div>
      <Field label="Phone"><input name="phone" className="input" defaultValue={c?.phone ?? ""} /></Field>
      <Field label="Email"><input name="email" type="email" className="input" defaultValue={c?.email ?? ""} /></Field>
      <Field label="Birthday (optional)"><input name="birthday" type="date" className="input" defaultValue={c?.birthday ?? ""} /></Field>
      <Field label="Tags (comma separated)"><input name="tags" className="input" defaultValue={c?.tags.join(", ")} placeholder="vip, bridal" /></Field>
      <div className="sm:col-span-2"><Field label="Address"><input name="address" className="input" defaultValue={c?.address ?? ""} /></Field></div>
      <div className="sm:col-span-2"><Field label="Preferences"><input name="preferences" className="input" defaultValue={c?.preferences ?? ""} placeholder="Favourite stylist, allergies, products…" /></Field></div>
      <div className="sm:col-span-2"><Field label="Notes"><textarea name="notes" rows={2} className="input" defaultValue={c?.notes ?? ""} /></Field></div>
      <Field label="Credit limit (customer account)" hint="Most this customer may owe at once. Leave blank for no limit."><input name="creditLimit" type="number" min="0" step="0.01" className="input" defaultValue={c?.creditLimit ?? ""} /></Field>
      <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" name="marketingConsent" defaultChecked={c?.marketingConsent} /> Customer agreed to receive marketing messages</label>
    </div>
  );
}
