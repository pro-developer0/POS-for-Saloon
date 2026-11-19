import Link from "next/link";
import { requireCtx } from "@/server/session";
import { listNotifications } from "@/server/services/reports";
import { Card, Empty, PageHeader } from "@/components/ui";
import { ActionButton } from "@/components/forms";
import { readNotificationsAction } from "@/app/actions";
import { fmtDateTime } from "@/lib/time";

export const metadata = { title: "Notifications" };
export default async function Page() {
  const ctx = await requireCtx();
  const rows = await listNotifications(ctx, 60);
  return (
    <div className="page-in">
      <PageHeader title="Notifications" desc="Appointment changes, low stock and payment alerts for this business." actions={rows.some((r) => !r.read) ? <ActionButton className="btn" action={readNotificationsAction}>Mark all read</ActionButton> : null} />
      <Card>{rows.length === 0 ? <Empty title="You're all caught up" desc="New bookings, cancellations and low-stock alerts appear here." /> : (
        <ul className="divide-y divide-line">{rows.map((n) => (
          <li key={n.id} className="flex items-start gap-3 px-5 py-3.5">
            <span className={`mt-1.5 size-2 shrink-0 rounded-full ${n.read ? "bg-line" : "bg-brand"}`} aria-label={n.read ? "Read" : "Unread"} />
            <div className="min-w-0 flex-1 text-sm"><p className={n.read ? "" : "font-semibold"}>{n.link ? <Link href={n.link} className="hover:text-brand">{n.title}</Link> : n.title}</p>{n.body && <p className="text-muted">{n.body}</p>}</div>
            <time className="shrink-0 text-xs text-muted">{fmtDateTime(n.createdAt, ctx.tenant.timezone)}</time>
          </li>))}</ul>)}</Card>
      <p className="mt-3 text-xs text-muted">Email, SMS and WhatsApp delivery are optional integrations and are not enabled by default; no paid provider is required.</p>
    </div>
  );
}
