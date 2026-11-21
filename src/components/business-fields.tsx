import type { Tenant } from "@/server/ctx";
import { BUSINESS_TYPE_OPTIONS, COUNTRIES, CURRENCIES, TIMEZONES } from "@/lib/constants";
import { Field } from "./ui";
import { WeekEditor } from "./week-editor";

export function IdentityFields({ t, lockType = false }: { t: Tenant; lockType?: boolean }) {
  return (
    <div className="space-y-4">
      <Field label="Business name"><input name="name" className="input" defaultValue={t.name} required /></Field>
      <Field label="Salon type" hint={lockType ? "Chosen at sign-up and cannot be changed." : undefined}><select name="businessType" className="input" defaultValue={t.businessType} disabled={lockType}>{BUSINESS_TYPE_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Logo (PNG/JPG/WebP, max 2 MB)"><input type="file" name="logo" accept="image/png,image/jpeg,image/webp" className="input pt-1.5" /></Field>
        <Field label="Favicon"><input type="file" name="favicon" accept="image/png,image/jpeg,image/webp" className="input pt-1.5" /></Field>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <Field label="Brand color"><input type="color" name="brandColor" defaultValue={t.brandColor} className="input p-1" /></Field>
        <Field label="Secondary"><input type="color" name="secondaryColor" defaultValue={t.secondaryColor} className="input p-1" /></Field>
        <Field label="Accent"><input type="color" name="accentColor" defaultValue={t.accentColor} className="input p-1" /></Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Phone"><input name="phone" className="input" defaultValue={t.phone ?? ""} /></Field>
        <Field label="Email"><input name="email" type="email" className="input" defaultValue={t.email ?? ""} /></Field>
        <Field label="Website"><input name="website" className="input" defaultValue={t.website ?? ""} /></Field>
        <Field label="Address"><input name="address" className="input" defaultValue={t.address ?? ""} /></Field>
        <Field label="Instagram"><input name="instagram" className="input" defaultValue={t.social.instagram ?? ""} /></Field>
        <Field label="Facebook"><input name="facebook" className="input" defaultValue={t.social.facebook ?? ""} /></Field>
      </div>
    </div>
  );
}

export function LocaleFields({ t }: { t: Tenant }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="Country"><select name="country" className="input" defaultValue={t.country}>{COUNTRIES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Field>
      <Field label="Currency"><select name="currency" className="input" defaultValue={t.currency}>{CURRENCIES.map((c) => <option key={c}>{c}</option>)}</select></Field>
      <Field label="Timezone"><select name="timezone" className="input" defaultValue={t.timezone}>{[...new Set([t.timezone, ...TIMEZONES])].map((z) => <option key={z}>{z}</option>)}</select></Field>
      <Field label="Time format"><select name="timeFormat" className="input" defaultValue={t.timeFormat}><option value="12h">12-hour</option><option value="24h">24-hour</option></select></Field>
      <Field label="Payment methods" hint="Comma-separated, e.g. cash, card, easypaisa"><input name="paymentMethods" className="input" defaultValue={t.paymentMethods.join(", ")} /></Field>
      <Field label="Invoice prefix"><input name="invoicePrefix" className="input" maxLength={8} defaultValue={t.invoicePrefix} /></Field>
      <div className="sm:col-span-2"><Field label="Invoice / receipt footer"><input name="invoiceFooter" className="input" defaultValue={t.invoiceFooter ?? ""} placeholder="Thank you for visiting!" /></Field></div>
    </div>
  );
}

export function HoursFields({ t }: { t: Tenant }) { return <WeekEditor prefix="hours" value={t.hours} />; }
