import { redirect } from "next/navigation";
import { requireCtx } from "@/server/session";
import { OnboardingWizard } from "@/components/onboarding-wizard";
import { HoursFields, IdentityFields, LocaleFields } from "@/components/business-fields";
export const metadata = { title: "Onboarding" };
export default async function Page() {
  const ctx = await requireCtx("__onboarding");
  if (ctx.tenant.onboarded) redirect("/dashboard");
  const t = ctx.tenant;
  return <OnboardingWizard identity={<IdentityFields t={t} />} locale={<LocaleFields t={t} />} hours={<HoursFields t={t} />} />;
}
