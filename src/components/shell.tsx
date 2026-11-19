"use client";
import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useTheme } from "next-themes";
import {
  LayoutDashboard, CalendarDays, CalendarRange, ShoppingCart, Users, Scissors, UserCog, Boxes, Truck, Receipt, FileText, CreditCard,
  BarChart3, Bell, Sparkles, Settings, LifeBuoy, Menu, PanelLeftClose, PanelLeftOpen, Sun, Moon, Monitor, Search, LogOut, ShieldCheck, Wallet, Hourglass, Banknote, Ticket, UserRound,
} from "lucide-react";

const ICONS = { LayoutDashboard, CalendarDays, CalendarRange, ShoppingCart, Users, Scissors, UserCog, Boxes, Truck, Receipt, FileText, CreditCard, BarChart3, Bell, Sparkles, Settings, LifeBuoy, ShieldCheck, Wallet, Hourglass, Banknote, Ticket };
export type NavItem = { href: string; label: string; icon: keyof typeof ICONS };

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
      <div className="flex h-16 items-center gap-3 border-b border-line px-4">
        {logoUrl
          // eslint-disable-next-line @next/next/no-img-element
          ? <img src={logoUrl} alt="" className="size-8 rounded-lg object-cover" />
          : <div className="grid size-8 shrink-0 place-items-center rounded-lg bg-brand text-sm font-bold text-brandfg">{tenantName.charAt(0)}</div>}
        {!compact && <span className="truncate text-sm font-semibold">{tenantName}</span>}
      </div>
      <ul className="flex-1 space-y-0.5 overflow-y-auto p-2.5">
        {nav.map((n) => {
          const Icon = ICONS[n.icon]; const active = path === n.href || (n.href !== "/dashboard" && path.startsWith(n.href));
          return (
            <li key={n.href}>
              <Link href={n.href} title={compact ? n.label : undefined} aria-current={active ? "page" : undefined}
                className={`group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors ${active ? "bg-brand/12 text-brand" : "text-muted hover:bg-surface2 hover:text-ink"}`}
                style={active ? { background: "color-mix(in srgb, var(--brand) 12%, transparent)" } : undefined}>
                <Icon size={18} className="shrink-0 transition-transform group-hover:scale-110" />
                {!compact && <span className="truncate">{n.label}</span>}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );

  return (
    <div className="min-h-dvh">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-lg focus:bg-brand focus:px-3 focus:py-2 focus:text-brandfg">Skip to content</a>
      <motion.aside className="no-print fixed inset-y-0 left-0 z-30 hidden border-r border-line bg-surface lg:block"
        animate={{ width: collapsed ? 76 : 260 }} transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 320, damping: 34 }}>
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

      <div className="transition-[padding] duration-300 lg:pl-[var(--sbw)]" style={{ ["--sbw" as string]: collapsed ? "76px" : "260px" }}>
        <header className="no-print sticky top-0 z-20 flex h-16 items-center gap-2 border-b border-line bg-surface/85 px-3 backdrop-blur sm:px-5">
          <button className="btn btn-ghost btn-sm lg:hidden" aria-label="Open menu" onClick={() => setDrawer(true)}><Menu size={18} /></button>
          <button className="btn btn-ghost btn-sm hidden lg:inline-flex" aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"} onClick={toggle}>
            {collapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
          </button>
          <form className="relative hidden max-w-sm flex-1 sm:block" role="search" onSubmit={(e) => { e.preventDefault(); if (q.trim()) router.push(`/customers?q=${encodeURIComponent(q.trim())}`); }}>
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <input className="input pl-9" placeholder="Search customers…" aria-label="Search customers" value={q} onChange={(e) => setQ(e.target.value)} />
          </form>
          <div className="ml-auto flex min-w-0 items-center gap-0.5 sm:gap-1">
            <Link href="/notifications" className="btn btn-ghost btn-sm relative" aria-label={`Notifications${unread ? `, ${unread} unread` : ""}`}>
              <Bell size={17} />{unread > 0 && <span className="absolute -right-0.5 -top-0.5 grid min-w-4 place-items-center rounded-full bg-bad px-1 text-[10px] font-bold text-white">{unread > 9 ? "9+" : unread}</span>}
            </Link>
            <Link href="/account" className="btn btn-ghost btn-sm" aria-label={`Account: ${userName}`} title={`Account (${userName})`}><UserRound size={17} /></Link>
            <ThemeToggle />
            <form action={logoutAction}>
              <button className="btn btn-ghost btn-sm" aria-label={`Sign out ${userName}`} title={`Sign out (${userName})`}><LogOut size={17} /></button>
            </form>
          </div>
        </header>
        <AnimatePresence mode="wait">
          <motion.main id="main" key={path} className="mx-auto w-full max-w-[1400px] p-4 sm:p-6" initial={{ opacity: 0, y: reduce ? 0 : 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: reduce ? 0 : 0.25 }}>
            {children}
          </motion.main>
        </AnimatePresence>
      </div>
    </div>
  );
}
