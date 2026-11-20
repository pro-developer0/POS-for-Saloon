"use client";
import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useTheme } from "next-themes";
import {
  LayoutDashboard, CalendarDays, CalendarRange, ShoppingCart, Users, Scissors, UserCog, Boxes, Truck, Receipt, FileText, CreditCard,
  BarChart3, Bell, Sparkles, Settings, LifeBuoy, Menu, PanelLeftClose, PanelLeftOpen, Sun, Moon, Monitor, Search, LogOut, ShieldCheck, Wallet, Hourglass, Banknote, Ticket,
} from "lucide-react";

const ICONS = { LayoutDashboard, CalendarDays, CalendarRange, ShoppingCart, Users, Scissors, UserCog, Boxes, Truck, Receipt, FileText, CreditCard, BarChart3, Bell, Sparkles, Settings, LifeBuoy, ShieldCheck, Wallet, Hourglass, Banknote, Ticket };
export type NavItem = { href: string; label: string; icon: keyof typeof ICONS; badge?: number };

function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const [m, setM] = useState(false);
  useEffect(() => setM(true), []);
  const next = theme === "light" ? "dark" : theme === "dark" ? "system" : "light";
  const Icon = !m ? Monitor : theme === "light" ? Sun : theme === "dark" ? Moon : Monitor;
  return (
    <button className="btn btn-ghost btn-sm" aria-label={`Theme: ${m ? theme : "system"}. Switch to ${next}`} title={`Theme: ${m ? theme : "system"}`}
      onClick={() => { document.documentElement.classList.add("theme-anim"); setTheme(next); setTimeout(() => document.documentElement.classList.remove("theme-anim"), 400); }}>
      <Icon size={17} />
    </button>
  );
}

export function AppShell({ nav, tenantName, logoUrl, userName, unread, logoutAction, children }: {
  nav: NavItem[]; tenantName: string; logoUrl: string | null; userName: string; unread: number;
  logoutAction: () => Promise<void>; children: ReactNode;
}) {
  const path = usePathname();
  const router = useRouter();
  const reduce = useReducedMotion();
  const [collapsed, setCollapsed] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [q, setQ] = useState("");
  useEffect(() => { try { setCollapsed(localStorage.getItem("sp_collapsed") === "1"); } catch { /* ignore */ } }, []);
  useEffect(() => setDrawer(false), [path]);
  const toggle = () => setCollapsed((c) => { try { localStorage.setItem("sp_collapsed", c ? "0" : "1"); } catch { /* ignore */ } return !c; });

  const SideContent = ({ compact }: { compact: boolean }) => (
    <nav aria-label="Main" className="flex h-full flex-col">
      <div className="flex h-[72px] items-center gap-3 border-b border-line px-5">
        {logoUrl
          // eslint-disable-next-line @next/next/no-img-element
          ? <img src={logoUrl} alt="" className="size-8 rounded-lg object-cover" />
          : <div className="grid size-8 shrink-0 place-items-center rounded-lg bg-brand text-sm font-bold text-brandfg">{tenantName.charAt(0)}</div>}
        {!compact && <span className="truncate text-[15px] font-semibold uppercase tracking-[0.08em]">{tenantName}</span>}
      </div>
      <ul className="flex-1 space-y-1 overflow-y-auto py-4 pr-0">
        {nav.map((n) => {
          const Icon = ICONS[n.icon]; const active = path === n.href || (n.href !== "/dashboard" && path.startsWith(n.href));
          return (
            <li key={n.href}>
              <Link href={n.href} title={compact ? n.label : undefined} aria-current={active ? "page" : undefined}
                className={`group relative flex items-center gap-3 py-3 pl-5 pr-4 text-sm font-medium transition-colors ${active ? "text-ink" : "text-muted hover:bg-surface2 hover:text-ink"}`}
                style={active ? { background: "color-mix(in srgb, var(--brand) 16%, transparent)" } : undefined}>
                <Icon size={18} className={`shrink-0 transition-transform group-hover:scale-110 ${active ? "text-brand" : ""}`} />
                {!compact && <span className="truncate">{n.label}</span>}
                {n.badge ? <span className={`grid min-w-5 place-items-center rounded-full bg-brand px-1.5 text-[10px] font-bold text-brandfg ${compact ? "absolute right-2 top-1.5" : "ml-auto"}`}>{n.badge}</span> : null}
                {active && <span className="absolute inset-y-0 right-0 w-[3px] rounded-l bg-brand" aria-hidden />}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );

  const current = nav.find((n) => path === n.href || (n.href !== "/dashboard" && path.startsWith(n.href)));
  const pageTitle = path.startsWith("/account") ? "Account" : current?.label ?? "";

  return (
    <div className="min-h-dvh">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-lg focus:bg-brand focus:px-3 focus:py-2 focus:text-brandfg">Skip to content</a>
      <motion.aside className="no-print fixed inset-y-0 left-0 z-30 hidden border-r border-line bg-surface lg:block"
        animate={{ width: collapsed ? 76 : 240 }} transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 320, damping: 34 }}>
        <SideContent compact={collapsed} />
      </motion.aside>

      <AnimatePresence>
        {drawer && (
          <>
            <motion.div className="fixed inset-0 z-40 bg-black/50 lg:hidden" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setDrawer(false)} />
            <motion.aside className="fixed inset-y-0 left-0 z-50 w-72 border-r border-line bg-surface lg:hidden" initial={{ x: -300 }} animate={{ x: 0 }} exit={{ x: -300 }} transition={{ duration: reduce ? 0 : 0.22 }}>
              <SideContent compact={false} />
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      <div className="transition-[padding] duration-300 lg:pl-[var(--sbw)]" style={{ ["--sbw" as string]: collapsed ? "76px" : "240px" }}>
        <header className="no-print sticky top-0 z-20 flex h-[72px] items-center gap-2 border-b border-line bg-bg/85 px-3 backdrop-blur sm:px-6">
          <span className="lg:hidden"><button className="btn btn-ghost btn-sm" aria-label="Open menu" onClick={() => setDrawer(true)}><Menu size={18} /></button></span>
          <span className="hidden lg:block"><button className="btn btn-ghost btn-sm" aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"} onClick={toggle}>
            {collapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
          </button></span>
          <p className="truncate text-lg font-semibold tracking-tight" aria-hidden>{pageTitle}</p>
          <div className="ml-auto flex min-w-0 items-center gap-1 sm:gap-2">
            <form className="relative hidden w-64 sm:block" role="search" onSubmit={(e) => { e.preventDefault(); if (q.trim()) router.push(`/customers?q=${encodeURIComponent(q.trim())}`); }}>
              <input className="h-10 w-full rounded-xl border border-line bg-surface px-4 pr-10 text-sm outline-none transition focus:border-brand" placeholder="Search here..." aria-label="Search customers" value={q} onChange={(e) => setQ(e.target.value)} />
              <button type="submit" aria-label="Search" className="absolute right-3 top-1/2 -translate-y-1/2 text-muted hover:text-ink"><Search size={16} /></button>
            </form>
            <Link href="/notifications" className="btn btn-ghost btn-sm relative" aria-label={`Notifications${unread ? `, ${unread} unread` : ""}`}>
              <Bell size={18} />{unread > 0 && <span className="absolute -right-0.5 -top-0.5 grid min-w-4 place-items-center rounded-full bg-brand px-1 text-[10px] font-bold text-brandfg">{unread > 9 ? "9+" : unread}</span>}
            </Link>
            <ThemeToggle />
            <Link href="/account" className="flex items-center gap-2.5 rounded-xl px-1.5 py-1 hover:bg-surface2" aria-label={`Account: ${userName}`} title="Account">
              <span className="grid size-9 place-items-center rounded-full bg-brand/25 text-xs font-bold text-brand" aria-hidden>{userName.split(/\s+/).slice(0, 2).map((x) => x[0]).join("").toUpperCase()}</span>
              <span className="hidden max-w-32 truncate text-sm font-semibold md:block">{userName}</span>
            </Link>
            <form action={logoutAction}>
              <button className="btn btn-ghost btn-sm" aria-label={`Sign out ${userName}`} title={`Sign out (${userName})`}><LogOut size={17} /></button>
            </form>
          </div>
        </header>
        <AnimatePresence mode="wait">
          <motion.main id="main" key={path} className="mx-auto w-full max-w-[1500px] p-4 sm:p-6" initial={{ opacity: 0, y: reduce ? 0 : 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: reduce ? 0 : 0.25 }}>
            {children}
          </motion.main>
        </AnimatePresence>
      </div>
    </div>
  );
}
