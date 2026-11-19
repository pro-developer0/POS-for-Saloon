import { requireCtx } from "@/server/session";
import { Card, PageHeader } from "@/components/ui";

export const metadata = { title: "Help & Support" };
const FAQ: [string, string][] = [
  ["How do I take a payment?", "Open Point of Sale, add services or products, choose a payment method (split payments are supported) and press Charge. A numbered invoice and receipt are created automatically."],
  ["Why can't I book a time?", "Bookings must be inside business hours, inside the staff member's working hours, outside breaks and time off, aligned to your slot size, and must not overlap another appointment (including the configured buffer). The error message tells you which rule failed."],
  ["How do I let someone pay later?", "In POS, tick 'Leave balance on invoice'. Later, open the invoice and use Record payment."],
  ["Can I edit a completed sale?", "No. Financial records are append-only for accuracy. Unpaid sales can be voided with a reason (stock is returned); payments are added, never overwritten."],
  ["How does the AI assistant work?", "Numbers are calculated by the app from your database. The AI (a free cloud model or a local model, configured by your platform administrator) only explains those verified results. If AI is off or unavailable, you still see the verified figures."],
  ["Who can see salaries and settings?", "Only roles with the matching permission. Owners control team members under Settings → Team & access."],
];
export default async function Page() {
  await requireCtx();
  return (
    <div className="page-in">
      <PageHeader title="Help & support" />
      <div className="grid gap-4 lg:grid-cols-2">{FAQ.map(([q, a]) => <Card key={q} className="p-5"><h2 className="font-semibold">{q}</h2><p className="mt-2 text-sm text-muted">{a}</p></Card>)}</div>
      <p className="mt-5 text-sm text-muted">Need more help? Contact your SalonPro provider.</p>
    </div>
  );
}
