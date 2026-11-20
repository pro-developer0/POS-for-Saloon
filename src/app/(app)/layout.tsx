import { labelsOf, modulesOf, type Module } from "@/lib/verticals";
import type { Metadata } from "next";
import { and, eq, sql } from "drizzle-orm";
import { requireCtx, getUser } from "@/server/session";
import { notifications } from "@/db/schema";
import { AppShell, type NavItem } from "@/components/shell";
import { logoutAction } from "@/app/actions";
import { readableOn } from "@/lib/color";
import { ActionButton } from "@/components/forms";
import { resendVerificationAction } from "@/app/actions";

const NAV: (NavItem & { perm?: string; mod?: Module; lk?: "staff" | "services" | "customers" | "appointments" })[] = [
  { href: "/dashboard", label: "Dashboard", icon: "LayoutDashboard", perm: "dashboard.view" },
  { href: "/appointments", label: "Appointments", icon: "CalendarDays", perm: "appointments.view", mod: "appointments", lk: "appointments" },
  { href: "/calendar", label: "Calendar", icon: "CalendarRange", perm: "appointments.view", mod: "appointments" },
  { href: "/pos", label: "Point of Sale", icon: "ShoppingCart", perm: "pos.use" },
  { href: "/day-close", label: "Day close", icon: "Banknote", perm: "pos.use" },
  { href: "/customers", label: "Customers", icon: "Users", perm: "customers.view", lk: "customers" },
  { href: "/services", label: "Services", icon: "Scissors", perm: "services.view", mod: "services", lk: "services" },
  { href: "/staff", label: "Staff", icon: "UserCog", perm: "staff.view", mod: "staff", lk: "staff" },
  { href: "/inventory", label: "Inventory", icon: "Boxes", perm: "inventory.view", mod: "inventory" },
  { href: "/suppliers", label: "Suppliers", icon: "Truck", perm: "inventory.view", mod: "purchases" },
  { href: "/purchases", label: "Purchases", icon: "Receipt", perm: "inventory.view", mod: "purchases" },
  { href: "/expenses", label: "Expenses", icon: "Wallet", perm: "expenses.view", mod: "expenses" },
  { href: "/invoices", label: "Invoices", icon: "FileText", perm: "invoices.view" },
  { href: "/payments", label: "Payments", icon: "CreditCard", perm: "invoices.view" },
  { href: "/coupons", label: "Coupons", icon: "Ticket", perm: "coupons.manage" },
  { href: "/reports", label: "Reports", icon: "BarChart3", perm: "reports.view" },
  { href: "/notifications", label: "Notifications", icon: "Bell" },
  { href: "/ai", label: "AI Assistant", icon: "Sparkles", perm: "ai.use" },
  { href: "/settings", label: "Settings", icon: "Settings", perm: "settings.manage" },
  { href: "/help", label: "Help & Support", icon: "LifeBuoy" },
];

export async function generateMetadata(): Promise<Metadata> {
  try { const ctx = await requireCtx(); return { title: { default: ctx.tenant.name, template: `%s · ${ctx.tenant.name}` }, icons: ctx.tenant.faviconUrl ? { icon: ctx.tenant.faviconUrl } : undefined }; } catch { return {}; }
}

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireCtx();
  const user = (await getUser())!;
  const [{ n }] = await ctx.db.select({ n: sql<number>`count(*)::int` }).from(notifications).where(and(eq(notifications.tenantId, ctx.tenantId), eq(notifications.read, false)));
  const mods = modulesOf(ctx.tenant), L = labelsOf();
  const nav: NavItem[] = NAV.filter((i) => (!i.perm || ctx.perms.has(i.perm)) && (!i.mod || mods.has(i.mod)))
    .map(({ perm, mod, lk, ...i }) => (void perm, void mod, lk ? { ...i, label: L[lk] } : i));
  const notif = nav.find((i) => i.href === "/notifications"); if (notif && n > 0) notif.badge = n;
  if (user.isPlatformAdmin) nav.push({ href: "/admin", label: "Platform Admin", icon: "ShieldCheck" });
  const t = ctx.tenant;
  return (
    <div style={{ ["--brand" as string]: t.brandColor, ["--brand-fg" as string]: readableOn(t.brandColor), ["--accent" as string]: t.accentColor }}>
      <AppShell nav={nav} tenantName={t.name} logoUrl={t.logoUrl} userName={user.name} unread={n} logoutAction={logoutAction}>
        {!user.emailVerifiedAt && (
          <div role="status" className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-warn/40 bg-warn/10 px-4 py-2.5 text-sm">
            <span>Please confirm your email address ({user.email}).</span>
            <ActionButton action={resendVerificationAction} className="btn btn-sm">Resend email</ActionButton>
          </div>
        )}
        {children}
      </AppShell>
    </div>
  );
}
