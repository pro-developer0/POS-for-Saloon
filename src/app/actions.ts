"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { eq, and } from "drizzle-orm";
import { ZodError } from "zod";
import { db } from "@/db/client";
import { tenants, memberships, users, staff, services, notifications } from "@/db/schema";
import { registerOwner, verifyLogin, seedStarter } from "@/server/auth";
import { AppError, audit, need } from "@/server/ctx";
import { createSession, destroySession, getUser, requireCtx, requirePlatformAdmin, setActiveTenant } from "@/server/session";
import * as crm from "@/server/services/crm";
import * as appts from "@/server/services/appointments";
import * as pos from "@/server/services/pos";
import * as inv from "@/server/services/inventory";
import * as rep from "@/server/services/reports";
import * as ai from "@/server/ai/service";
import { zonedToUtc, hm } from "@/lib/time";
import type { WeekHours } from "@/db/schema";
import type { Result } from "@/components/forms";
import { ROLES } from "@/lib/permissions";
import { MODULES, VERTICALS } from "@/lib/verticals";
import { saveUpload } from "@/server/uploads";
import { requestPasswordReset, resetPassword, sendVerification, verifyEmail } from "@/server/tokens";
import { appUrl } from "@/server/mail";
import bcrypt from "bcryptjs";

function fail(e: unknown): Result {
  if (e instanceof ZodError) return { ok: false, error: e.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; ") };
  if (e instanceof AppError) return { ok: false, error: e.message };
  if ((e as { digest?: string })?.digest?.startsWith("NEXT_REDIRECT")) throw e;
  console.error(e);
  return { ok: false, error: "Unexpected error. Please try again." };
}
async function run(fn: () => Promise<Partial<Result> | void>): Promise<Result> {
  try { const r = await fn(); return { ok: true, ...(r ?? {}) }; } catch (e) { return fail(e); }
}
const s = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const b = (fd: FormData, k: string) => fd.get(k) === "on";
const all = (fd: FormData, k: string) => fd.getAll(k).map(String).filter(Boolean);

// ---- simple in-memory rate limiter (per process). For multi-instance prod, back with Redis/DB. ----
const hits = new Map<string, number[]>();
function limited(key: string, max: number, windowMs: number) {
  const now = Date.now(); const arr = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  arr.push(now); hits.set(key, arr); return arr.length > max;
}
async function ip() { return (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local"; }

function parseWeek(fd: FormData, prefix: string): WeekHours {
  const w: Record<string, unknown> = {};
  for (let i = 0; i < 7; i++) {
    const off = fd.get(`${prefix}${i}_off`) === "on";
    const open = s(fd, `${prefix}${i}_open`), close = s(fd, `${prefix}${i}_close`);
    if (off || !open || !close) { w[String(i)] = null; continue; }
    if (hm(open) >= hm(close)) throw new AppError("Closing time must be after opening time.");
    w[String(i)] = { open, close };
  }
  return w as WeekHours;
}

// ================= AUTH =================
export async function loginAction(_: Result | null, fd: FormData): Promise<Result> {
  if (limited(`login:${await ip()}`, 20, 10 * 60_000)) return { ok: false, error: "Too many attempts. Please wait a few minutes." };
  try {
    const d = await db();
    const u = await verifyLogin(d, s(fd, "email"), String(fd.get("password") ?? ""));
    await createSession(u.id);
    const ms = await d.select().from(memberships).where(eq(memberships.userId, u.id));
    if (ms[0]) await setActiveTenant(ms[0].tenantId);
    redirect(u.isPlatformAdmin && !ms.length ? "/admin" : "/dashboard");
  } catch (e) { return fail(e); }
}
export async function registerAction(_: Result | null, fd: FormData): Promise<Result> {
  if (limited(`reg:${await ip()}`, 10, 60 * 60_000)) return { ok: false, error: "Too many sign-ups from this address. Try later." };
  try {
    const d = await db();
    const { user, tenant } = await registerOwner(d, { name: s(fd, "name"), email: s(fd, "email"), password: String(fd.get("password") ?? ""), businessName: s(fd, "businessName"), businessType: s(fd, "businessType") || "hair_salon" });
    await createSession(user.id); await setActiveTenant(tenant.id);
    try { await sendVerification(d, user.id, await baseUrl()); } catch (e) { console.error("verification email failed", e); } // never blocks sign-up
    redirect("/onboarding");
  } catch (e) { return fail(e); }
}
async function baseUrl() {
  const h = await headers();
  const host = h.get("host");
  return appUrl(host ? `${h.get("x-forwarded-proto") ?? "http"}://${host}` : undefined);
}
export async function requestResetAction(_: Result | null, fd: FormData): Promise<Result> {
  const email = s(fd, "email").toLowerCase();
  if (limited(`reset-ip:${await ip()}`, 10, 60 * 60_000) || limited(`reset-mail:${email}`, 3, 60 * 60_000)) return { ok: false, error: "Too many requests. Please try again in an hour." };
  try { await requestPasswordReset(await db(), email, await baseUrl()); } catch (e) { console.error("reset email failed", e); }
  // identical response whether or not the account exists
  return { ok: true, message: "If that email has an account, a reset link is on its way." };
}
export async function resetPasswordAction(_: Result | null, fd: FormData): Promise<Result> {
  if (limited(`resetpw:${await ip()}`, 15, 60 * 60_000)) return { ok: false, error: "Too many attempts. Try again later." };
  try {
    if (String(fd.get("password")) !== String(fd.get("confirm"))) throw new AppError("Passwords do not match.");
    await resetPassword(await db(), s(fd, "token"), String(fd.get("password") ?? ""));
    return { ok: true, message: "Password updated. You can sign in now." };
  } catch (e) { return fail(e); }
}
export async function verifyEmailAction(_: Result | null, fd: FormData): Promise<Result> {
  try { await verifyEmail(await db(), s(fd, "token")); return { ok: true, message: "Email confirmed. Thank you!" }; } catch (e) { return fail(e); }
}
export async function resendVerificationAction(): Promise<Result> {
  return run(async () => {
    const u = await getUser(); if (!u) throw new AppError("Please sign in.", "unauthorized");
    if (limited(`verify:${u.id}`, 3, 60 * 60_000)) throw new AppError("Please wait before requesting another email.");
    if (u.emailVerifiedAt) return { message: "Already confirmed." };
    await sendVerification(await db(), u.id, await baseUrl());
    return { message: "Confirmation email sent." };
  });
}
export async function logoutAction() { await destroySession(); redirect("/login"); }

// ================= ONBOARDING / SETTINGS =================
export async function saveBusinessAction(fd: FormData, finish = false): Promise<Result> {
  return run(async () => {
    const ctx = await requireCtx("__onboarding"); need(ctx, "settings.manage");
    const color = (k: string, d: string) => (/^#[0-9a-fA-F]{6}$/.test(s(fd, k)) ? s(fd, k) : d);
    const tz = s(fd, "timezone") || ctx.tenant.timezone;
    try { new Intl.DateTimeFormat("en", { timeZone: tz }); } catch { throw new AppError("Unknown timezone"); }
    const cur = (s(fd, "currency") || ctx.tenant.currency).toUpperCase();
    if (!/^[A-Z]{3}$/.test(cur)) throw new AppError("Currency must be a 3-letter code (e.g. USD)");
    const rate = Number(s(fd, "taxRate") || 0);
    if (!(rate >= 0 && rate <= 100)) throw new AppError("Tax rate must be 0–100");
    const methods = s(fd, "paymentMethods").split(",").map((x) => x.trim().toLowerCase().replace(/\s+/g, "_")).filter(Boolean);
    const d = await db();
    const patch: Partial<typeof tenants.$inferInsert> = {
      name: s(fd, "name") || ctx.tenant.name,
      brandColor: color("brandColor", ctx.tenant.brandColor), secondaryColor: color("secondaryColor", ctx.tenant.secondaryColor), accentColor: color("accentColor", ctx.tenant.accentColor),
      country: s(fd, "country") || ctx.tenant.country, currency: cur, timezone: tz, timeFormat: s(fd, "timeFormat") === "24h" ? "24h" : "12h", dateFormat: s(fd, "dateFormat") || ctx.tenant.dateFormat,
      address: s(fd, "address") || null, phone: s(fd, "phone") || null, email: s(fd, "email") || null, website: s(fd, "website") || null,
      social: { instagram: s(fd, "instagram"), facebook: s(fd, "facebook") },
      taxName: s(fd, "taxName") || "Tax", taxRate: rate.toFixed(2),
      slotMinutes: Math.min(120, Math.max(5, Number(s(fd, "slotMinutes")) || ctx.tenant.slotMinutes)), bufferMinutes: Math.min(120, Math.max(0, Number(s(fd, "bufferMinutes") || 0))),
      invoicePrefix: (s(fd, "invoicePrefix") || "INV").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8) || "INV", invoiceFooter: s(fd, "invoiceFooter") || null,
      lowStockDefault: Math.max(0, Number(s(fd, "lowStockDefault") || 5)),
    };
    if (!ctx.tenant.onboarded && s(fd, "businessType") && s(fd, "businessType") in VERTICALS) patch.businessType = s(fd, "businessType"); // locked after onboarding
    if (methods.length) patch.paymentMethods = methods;
    if (fd.get("hours0_open") !== null) patch.hours = parseWeek(fd, "hours");
    if (fd.has("aiEnabledPresent")) patch.aiEnabled = b(fd, "aiEnabled");
    if (fd.has("modulesPresent")) patch.modules = all(fd, "modules").filter((m) => (MODULES as readonly string[]).includes(m));
    const logo = fd.get("logo");
    if (logo instanceof File && logo.size > 0) patch.logoUrl = await saveUpload(ctx.tenantId, logo, "logo");
    const fav = fd.get("favicon");
    if (fav instanceof File && fav.size > 0) patch.faviconUrl = await saveUpload(ctx.tenantId, fav, "favicon");
    if (finish) patch.onboarded = true;
    await d.update(tenants).set(patch).where(eq(tenants.id, ctx.tenantId));
    await audit(ctx, finish ? "onboarding.complete" : "settings.update", "tenant", ctx.tenantId);
    revalidatePath("/", "layout");
  });
}
export async function settingsAction(fd: FormData) { return saveBusinessAction(fd, false); }
export async function onboardingBusinessAction(fd: FormData) { return saveBusinessAction(fd, false); }
export async function onboardingStaffServiceAction(fd: FormData): Promise<Result> {
  return run(async () => {
    const ctx = await requireCtx("__onboarding"); need(ctx, "settings.manage");
    const d = await db();
    for (const line of s(fd, "services").split("\n").map((x) => x.trim()).filter(Boolean)) {
      const [name, mins, price] = line.split(/[,;|]/).map((x) => x.trim());
      if (!name) continue;
      await crm.saveService(ctx, { name, durationMinutes: Number(mins) || 30, price: Number(price) || 0, staffIds: [] });
    }
    for (const name of s(fd, "staff").split("\n").map((x) => x.trim()).filter(Boolean))
      await crm.saveStaff(ctx, { name, schedule: ctx.tenant.hours, serviceIds: [] });
    void d;
  });
}
export async function finishOnboardingAction(): Promise<Result> {
  return run(async () => {
    const ctx = await requireCtx("__onboarding"); need(ctx, "settings.manage");
    const d = await db();
    const [anyStaff] = await d.select({ id: staff.id }).from(staff).where(eq(staff.tenantId, ctx.tenantId)).limit(1);
    if (!anyStaff) await seedStarter(d, ctx.tenantId, (await getUser())!.name);
    await d.update(tenants).set({ onboarded: true }).where(eq(tenants.id, ctx.tenantId));
    void services;
  });
}

// ================= CUSTOMERS =================
const custBody = (fd: FormData) => ({ name: s(fd, "name"), phone: s(fd, "phone"), email: s(fd, "email"), birthday: s(fd, "birthday"), address: s(fd, "address"), notes: s(fd, "notes"), preferences: s(fd, "preferences"), tags: s(fd, "tags").split(",").map((t) => t.trim()).filter(Boolean), marketingConsent: b(fd, "marketingConsent") });
export async function saveCustomerAction(fd: FormData): Promise<Result> {
  return run(async () => { const ctx = await requireCtx("customers.manage"); const id = s(fd, "id"); if (id) await crm.updateCustomer(ctx, id, custBody(fd)); else await crm.createCustomer(ctx, custBody(fd)); revalidatePath("/customers"); });
}
export async function archiveCustomerAction(id: string, archived: boolean): Promise<Result> { return run(async () => { await crm.archiveCustomer(await requireCtx("customers.manage"), id, archived); revalidatePath("/customers"); }); }
export async function loyaltyAction(fd: FormData): Promise<Result> { return run(async () => { await crm.adjustLoyalty(await requireCtx("customers.manage"), s(fd, "id"), Number(s(fd, "delta"))); }); }

// ================= SERVICES / STAFF =================
export async function saveServiceAction(fd: FormData): Promise<Result> {
  return run(async () => {
    const ctx = await requireCtx("services.manage");
    await crm.saveService(ctx, { name: s(fd, "name"), description: s(fd, "description"), categoryId: s(fd, "categoryId"), durationMinutes: s(fd, "durationMinutes"), price: s(fd, "price"), taxable: b(fd, "taxable"), commissionPct: s(fd, "commissionPct") || "0", bookable: b(fd, "bookable"), active: b(fd, "active"), staffIds: all(fd, "staffIds") }, s(fd, "id") || undefined);
    revalidatePath("/services");
  });
}
export async function archiveServiceAction(id: string, archived: boolean): Promise<Result> { return run(async () => { await crm.archiveService(await requireCtx("services.manage"), id, archived); }); }
export async function moveServiceAction(id: string, dir: 1 | -1): Promise<Result> { return run(async () => { await crm.moveService(await requireCtx("services.manage"), id, dir); }); }
export async function addCategoryAction(fd: FormData): Promise<Result> { return run(async () => { await crm.saveCategory(await requireCtx("services.manage"), s(fd, "name")); }); }

export async function saveStaffAction(fd: FormData): Promise<Result> {
  return run(async () => {
    const ctx = await requireCtx("staff.manage");
    const brk = s(fd, "breakStart") && s(fd, "breakEnd") ? [{ start: s(fd, "breakStart"), end: s(fd, "breakEnd") }] : [];
    await crm.saveStaff(ctx, { name: s(fd, "name"), phone: s(fd, "phone"), email: s(fd, "email"), jobTitle: s(fd, "jobTitle"), color: s(fd, "color") || "#7c3aed", commissionPct: s(fd, "commissionPct") || "0", salary: s(fd, "salary"), schedule: parseWeek(fd, "sch"), breaks: brk, active: b(fd, "active"), serviceIds: all(fd, "serviceIds") }, s(fd, "id") || undefined);
  });
}
export async function timeOffAction(fd: FormData): Promise<Result> {
  return run(async () => {
    const ctx = await requireCtx("staff.manage");
    const tz = ctx.tenant.timezone;
    await crm.addTimeOff(ctx, s(fd, "staffId"), zonedToUtc(s(fd, "from"), 0, tz), zonedToUtc(s(fd, "to"), 1440, tz), s(fd, "reason"));
  });
}
export async function deleteTimeOffAction(id: string): Promise<Result> { return run(async () => { await crm.deleteTimeOff(await requireCtx("staff.manage"), id); }); }

// ================= APPOINTMENTS =================
export async function createAppointmentAction(fd: FormData): Promise<Result> {
  return run(async () => {
    const ctx = await requireCtx("appointments.manage");
    let customerId = s(fd, "customerId");
    if (!customerId && s(fd, "newCustomerName")) {
      need(ctx, "customers.manage");
      customerId = (await crm.createCustomer(ctx, { name: s(fd, "newCustomerName"), phone: s(fd, "newCustomerPhone"), tags: [], marketingConsent: false })).id;
    }
    const startsAt = zonedToUtc(s(fd, "date"), hm(s(fd, "time")), ctx.tenant.timezone);
    await appts.createAppointment(ctx, { customerId, serviceId: s(fd, "serviceId"), staffId: s(fd, "staffId"), startsAt, durationMinutes: s(fd, "durationMinutes") || undefined, price: s(fd, "price") || undefined, discount: s(fd, "discount") || 0, notes: s(fd, "notes"), status: s(fd, "status") || "confirmed", source: s(fd, "source") || "staff" });
    revalidatePath("/appointments"); revalidatePath("/calendar");
  });
}
export async function rescheduleAction(fd: FormData): Promise<Result> {
  return run(async () => {
    const ctx = await requireCtx("appointments.manage");
    await appts.rescheduleAppointment(ctx, s(fd, "id"), zonedToUtc(s(fd, "date"), hm(s(fd, "time")), ctx.tenant.timezone), s(fd, "staffId") || undefined);
  });
}
export async function appointmentStatusAction(id: string, status: string): Promise<Result> {
  return run(async () => { await appts.setAppointmentStatus(await requireCtx("appointments.manage"), id, status as never); });
}
export async function dragRescheduleAction(id: string, date: string, minutes: number): Promise<Result> {
  return run(async () => {
    const ctx = await requireCtx("appointments.manage");
    await appts.rescheduleAppointment(ctx, id, zonedToUtc(date, minutes, ctx.tenant.timezone));
    revalidatePath("/calendar");
  });
}
export async function slotsAction(date: string, serviceId: string, staffId?: string) {
  const ctx = await requireCtx("appointments.view");
  try { return (await appts.findSlots(ctx, { date, serviceId, staffId: staffId || undefined })).map((x) => ({ staffId: x.staffId, staffName: x.staffName, label: x.label })); } catch { return []; }
}

// ================= POS / INVOICES =================
export async function checkoutAction(payload: unknown): Promise<Result> {
  return run(async () => { const ctx = await requireCtx("pos.use"); const r = await pos.checkout(ctx, payload); revalidatePath("/dashboard"); return { data: r, message: r.duplicate ? "Sale was already recorded" : `Sale ${r.invoiceNumber} completed` }; });
}
export async function addPaymentAction(fd: FormData): Promise<Result> { return run(async () => { await pos.addPayment(await requireCtx("invoices.manage"), s(fd, "transactionId"), s(fd, "method"), Number(s(fd, "amount")), s(fd, "note")); }); }
export async function voidSaleAction(fd: FormData): Promise<Result> { return run(async () => { await pos.voidSale(await requireCtx("invoices.manage"), s(fd, "transactionId"), s(fd, "reason")); }); }

// ================= INVENTORY / SUPPLIERS / PURCHASES / EXPENSES =================
export async function saveProductAction(fd: FormData): Promise<Result> {
  return run(async () => { await inv.saveProduct(await requireCtx("inventory.manage"), { name: s(fd, "name"), sku: s(fd, "sku"), barcode: s(fd, "barcode"), category: s(fd, "category"), description: s(fd, "description"), costPrice: s(fd, "costPrice") || 0, sellPrice: s(fd, "sellPrice") || 0, minStock: s(fd, "minStock") || 5, supplierId: s(fd, "supplierId"), taxable: b(fd, "taxable"), trackStock: fd.has("trackStockPresent") ? b(fd, "trackStock") : true, active: fd.has("activePresent") ? b(fd, "active") : true, initialQuantity: s(fd, "initialQuantity") || 0 }, s(fd, "id") || undefined); });
}
export async function adjustStockAction(fd: FormData): Promise<Result> {
  return run(async () => { await inv.adjustStock(await requireCtx("inventory.manage"), s(fd, "productId"), Number(s(fd, "delta")), (s(fd, "reason") || "adjustment") as never, s(fd, "note")); });
}
export async function saveSupplierAction(fd: FormData): Promise<Result> {
  return run(async () => { await inv.saveSupplier(await requireCtx("suppliers.manage"), { name: s(fd, "name"), contactName: s(fd, "contactName"), phone: s(fd, "phone"), email: s(fd, "email"), address: s(fd, "address"), notes: s(fd, "notes") }, s(fd, "id") || undefined); });
}
export async function createPurchaseAction(fd: FormData): Promise<Result> {
  return run(async () => { await inv.createPurchase(await requireCtx("suppliers.manage"), { supplierId: s(fd, "supplierId"), reference: s(fd, "reference"), items: [{ productId: s(fd, "productId"), quantity: s(fd, "quantity"), unitCost: s(fd, "unitCost") }] }); });
}
export async function receivePurchaseAction(id: string): Promise<Result> { return run(async () => { await inv.receivePurchase(await requireCtx("suppliers.manage"), id); }); }
export async function cancelPurchaseAction(id: string): Promise<Result> { return run(async () => { await inv.cancelPurchase(await requireCtx("suppliers.manage"), id); }); }
export async function saveExpenseAction(fd: FormData): Promise<Result> {
  return run(async () => {
    const ctx = await requireCtx("expenses.manage");
    let receiptUrl = "";
    const f = fd.get("receipt");
    if (f instanceof File && f.size > 0) receiptUrl = await saveUpload(ctx.tenantId, f, "receipt");
    await inv.saveExpense(ctx, { name: s(fd, "name"), category: s(fd, "category") || "General", amount: s(fd, "amount"), spentOn: s(fd, "spentOn"), paymentMethod: s(fd, "paymentMethod") || "cash", description: s(fd, "description"), supplierId: s(fd, "supplierId"), receiptUrl }, s(fd, "id") || undefined);
  });
}
export async function deleteExpenseAction(id: string): Promise<Result> { return run(async () => { await inv.deleteExpense(await requireCtx("expenses.manage"), id); }); }

// ================= NOTIFICATIONS =================
export async function readNotificationsAction(): Promise<Result> { return run(async () => { await rep.markNotificationsRead(await requireCtx()); revalidatePath("/", "layout"); }); }

// ================= MEMBERS =================
export async function addMemberAction(fd: FormData): Promise<Result> {
  return run(async () => {
    const ctx = await requireCtx("members.manage");
    const role = s(fd, "role"); if (!(ROLES as readonly string[]).includes(role) || role === "owner") throw new AppError("Invalid role");
    const email = s(fd, "email").toLowerCase(); const d = await db();
    let [u] = await d.select().from(users).where(eq(users.email, email));
    if (!u) {
      const pw = String(fd.get("password") ?? "");
      if (pw.length < 10) throw new AppError("New users need a password of at least 10 characters");
      [u] = await d.insert(users).values({ email, name: s(fd, "name") || email, passwordHash: await bcrypt.hash(pw, 11) }).returning();
    }
    await d.insert(memberships).values({ userId: u.id, tenantId: ctx.tenantId, role }).onConflictDoUpdate({ target: [memberships.userId, memberships.tenantId], set: { role, active: true } });
    await audit(ctx, "member.add", "user", u.id, { role });
  });
}
export async function removeMemberAction(membershipId: string): Promise<Result> {
  return run(async () => {
    const ctx = await requireCtx("members.manage"); const d = await db();
    const [m] = await d.select().from(memberships).where(and(eq(memberships.id, membershipId), eq(memberships.tenantId, ctx.tenantId)));
    if (!m || m.role === "owner") throw new AppError("Cannot remove this member");
    await d.update(memberships).set({ active: false }).where(eq(memberships.id, membershipId));
    await audit(ctx, "member.remove", "user", m.userId);
  });
}

// ================= AI =================
export async function askAdvisorAction(conversationId: string | null, question: string) {
  const ctx = await requireCtx("ai.use");
  try { const r = await ai.askAdvisor(ctx, conversationId, question); return { ok: true as const, conversationId: r.conversationId, message: { id: r.message.id, content: r.message.content, meta: r.message.meta as Record<string, unknown> | null } }; }
  catch (e) { return { ok: false as const, error: fail(e).error ?? "Failed" }; }
}
export async function loadConversationAction(id: string) { const ctx = await requireCtx("ai.use"); return (await ai.getMessages(ctx, id)).map((m) => ({ id: m.id, role: m.role, content: m.content, feedback: m.feedback, createdAt: m.createdAt.toISOString(), meta: m.meta as Record<string, unknown> | null })); }
export async function renameConversationAction(id: string, title: string): Promise<Result> { return run(async () => { await ai.renameConversation(await requireCtx("ai.use"), id, title); }); }
export async function deleteConversationAction(id: string): Promise<Result> { return run(async () => { await ai.deleteConversation(await requireCtx("ai.use"), id); }); }
export async function feedbackAction(id: string, f: "up" | "down"): Promise<Result> { return run(async () => { await ai.setFeedback(await requireCtx("ai.use"), id, f); }); }
export async function generateMarketingAction(fd: FormData) {
  try {
    const ctx = await requireCtx("ai.use");
    const r = await ai.generateMarketing(ctx, { platform: s(fd, "platform"), kind: s(fd, "kind"), service: s(fd, "service"), promotion: s(fd, "promotion"), audience: s(fd, "audience"), tone: s(fd, "tone") || "friendly", language: s(fd, "language") || "English", length: (s(fd, "length") as "short") || "medium" });
    return { ok: true as const, text: r.text, provider: r.provider, local: r.local };
  } catch (e) { return { ok: false as const, error: fail(e).error ?? (e as Error).message }; }
}
export async function saveContentAction(kind: string, title: string, content: string): Promise<Result> { return run(async () => { await ai.saveContent(await requireCtx("ai.use"), kind, title, content); }); }
export async function deleteContentAction(id: string): Promise<Result> { return run(async () => { await ai.deleteContent(await requireCtx("ai.use"), id); }); }

// ================= PLATFORM ADMIN =================
export async function adminSetTenantStatusAction(tenantId: string, status: "active" | "suspended"): Promise<Result> {
  return run(async () => {
    const u = await requirePlatformAdmin(); const d = await db();
    await d.update(tenants).set({ status }).where(eq(tenants.id, tenantId));
    const { auditLogs } = await import("@/db/schema");
    await d.insert(auditLogs).values({ tenantId, userId: u.id, action: `admin.tenant.${status}`, entity: "tenant", entityId: tenantId });
  });
}
export async function adminAiConfigAction(fd: FormData): Promise<Result> {
  return run(async () => {
    const u = await requirePlatformAdmin(); const d = await db();
    await ai.saveAiConfig(d, { enabled: b(fd, "enabled"), mode: (s(fd, "mode") || "local") as never, provider: (s(fd, "provider") || "ollama") as never, model: s(fd, "model") || "llama3.2:3b", ollamaUrl: s(fd, "ollamaUrl") || "http://localhost:11434", cloudDisabled: b(fd, "cloudDisabled"), perTenantDailyLimit: Number(s(fd, "perTenantDailyLimit")) || 30, globalDailyLimit: Number(s(fd, "globalDailyLimit")) || 500 });
    const { auditLogs } = await import("@/db/schema");
    await d.insert(auditLogs).values({ userId: u.id, action: "admin.ai.config" });
  });
}
export async function adminTestAiAction(): Promise<Result> {
  return run(async () => {
    await requirePlatformAdmin(); const d = await db();
    const { chat, plan, providerConfigured } = await import("@/server/ai/providers");
    const cfg = await ai.getAiConfig(d); const steps = plan({ ...cfg, enabled: true }).filter((p) => providerConfigured(p.provider));
    if (!steps.length) throw new AppError("No provider is configured for the selected mode (missing API key or cloud disabled).");
    const r = await chat(cfg, steps[0].provider, steps[0].model, [{ role: "user", content: "Reply with the single word: ok" }], { maxTokens: 10 }).catch((e) => { throw new AppError(e.message); });
    return { message: `${steps[0].provider}/${steps[0].model} replied: ${r.text.slice(0, 40)}` };
  });
}
void notifications;
