import { and, desc, eq, sql } from "drizzle-orm";
import { aiConversations, aiMessages, aiUsage, aiSavedContent, platformSettings } from "@/db/schema";
import type { DB } from "@/db/client";
import { AppError, audit, can, need, type Ctx } from "../ctx";
import { AiError, DEFAULT_AI_CONFIG, FREE_PROVIDERS, chat, plan, providerConfigured, type AiConfig, type ChatMessage, type ProviderId } from "./providers";
import { appointmentStats, busiestDays, dormantCustomers, expenseByCategory, lowStock, popularServices, rangeFor, revenueSeries, salesSummary, staffPerformance, productSales } from "../services/reports";
import { findSlots } from "../services/appointments";
import { listServices } from "../services/crm";
import type { RangeKey } from "@/lib/time";
import { formatMoney, toCents } from "@/lib/money";

export async function getAiConfig(db: DB): Promise<AiConfig> {
  const [r] = await db.select().from(platformSettings).where(eq(platformSettings.key, "ai"));
  return { ...DEFAULT_AI_CONFIG, ...((r?.value as Partial<AiConfig>) ?? {}) };
}
export async function saveAiConfig(db: DB, patch: Partial<AiConfig>) {
  const cur = await getAiConfig(db);
  const next = { ...cur, ...patch };
  if (!(next.provider in FREE_PROVIDERS)) throw new AppError("Unknown provider");
  if (next.provider === "openrouter" && !next.model.endsWith(":free")) throw new AppError("Only ':free' OpenRouter models are allowed");
  await db.insert(platformSettings).values({ key: "ai", value: next }).onConflictDoUpdate({ target: platformSettings.key, set: { value: next } });
  return next;
}

async function usedToday(db: DB, tenantId?: string) {
  const since = new Date(Date.now() - 24 * 3600_000);
  const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(aiUsage)
    .where(and(eq(aiUsage.status, "ok"), sql`${aiUsage.createdAt} >= ${since}`, tenantId ? eq(aiUsage.tenantId, tenantId) : undefined));
  return r.n;
}

async function log(ctx: Ctx | null, db: DB, feature: string, provider: string, model: string | null, status: string, tokens?: number, error?: string) {
  await db.insert(aiUsage).values({ tenantId: ctx?.tenantId ?? null, userId: ctx?.userId ?? null, feature, provider, model, status, tokens: tokens ?? null, error: error?.slice(0, 300) ?? null });
}

export type AiStatus = { available: boolean; reason?: string; usingLocal?: boolean };

/** Runs a chat through the configured free providers. Throws AiError (friendly) on any failure; never fakes output. */
export async function runAi(ctx: Ctx, feature: string, messages: ChatMessage[], opts: { maxTokens?: number } = {}) {
  need(ctx, "ai.use");
  const cfg = await getAiConfig(ctx.db);
  if (!cfg.enabled) throw new AiError("AI is turned off by the platform administrator.", "disabled");
  if (!ctx.tenant.aiEnabled) throw new AiError("AI is turned off for this business in Settings.", "disabled");
  const steps = plan(cfg).filter((p) => providerConfigured(p.provider));
  if (!steps.length) throw new AiError("No free AI provider is configured. Ask the platform administrator to set up local Ollama or a free provider key.", "disabled");
  if ((await usedToday(ctx.db, ctx.tenantId)) >= Math.min(ctx.tenant.aiDailyLimit, cfg.perTenantDailyLimit)) throw new AiError("Your daily AI request limit was reached. It resets within 24 hours.", "quota");
  if ((await usedToday(ctx.db)) >= cfg.globalDailyLimit) throw new AiError("The platform's free AI limit for today was reached.", "quota");

  let lastErr: AiError | null = null;
  for (const s of steps) {
    try {
      const r = await chat(cfg, s.provider, s.model, messages, opts);
      await log(ctx, ctx.db, feature, s.provider, s.model, "ok", r.tokens);
      return { ...r, provider: s.provider as ProviderId, model: s.model, local: FREE_PROVIDERS[s.provider].local };
    } catch (e) {
      const err = e instanceof AiError ? e : new AiError("Unexpected AI error.", "bad_response");
      await log(ctx, ctx.db, feature, s.provider, s.model, err.kind === "quota" ? "quota" : "error", 0, err.message);
      lastErr = err;
    }
  }
  throw lastErr!;
}

// ------------------------------------------------------------------
// Advisor: deterministic tools produce verified facts; the model only explains them.
// ------------------------------------------------------------------
type Facts = { title: string; range: string; source: string; data: unknown; note?: string }[];

function pickRange(q: string): { key: RangeKey; label: string } {
  const s = q.toLowerCase();
  if (/yesterday/.test(s)) return { key: "yesterday", label: "yesterday" };
  if (/today|tonight/.test(s)) return { key: "today", label: "today" };
  if (/last month|previous month/.test(s)) return { key: "lastmonth", label: "last month" };
  if (/this week|last 7|past week|week/.test(s)) return { key: "7d", label: "the last 7 days" };
  if (/year/.test(s)) return { key: "year", label: "this year" };
  if (/30 days|last 30/.test(s)) return { key: "30d", label: "the last 30 days" };
  return { key: "month", label: "this month" };
}

export async function gatherFacts(ctx: Ctx, question: string): Promise<{ facts: Facts; rangeLabel: string; tools: string[] }> {
  const s = question.toLowerCase();
  const { key, label } = pickRange(question);
  const r = rangeFor(ctx, key);
  const facts: Facts = [];
  const tools: string[] = [];
  const cur = ctx.tenant.currency;
  const m = (v: string) => formatMoney(v, cur);
  const rangeTxt = `${r.fromDate} to ${new Date(r.to.getTime() - 1).toISOString().slice(0, 10)} (${ctx.tenant.timezone})`;
  const add = (t: string, tool: string, data: unknown, note?: string) => { facts.push({ title: t, range: rangeTxt, source: tool, data, note }); tools.push(tool); };

  const wants = (re: RegExp) => re.test(s);
  const canReports = can(ctx, "reports.view"), canDash = can(ctx, "dashboard.view");
  const general = !wants(/earn|revenue|sales|sold|income|profit|expense|spend|compar|popular|service|staff|stylist|employee|customer|visit|inactive|haven't|stock|inventor|busy|busiest|slot|available|book/);

  if (canDash && (general || wants(/earn|revenue|sales|sold|income|profit|net|compar|how much/))) {
    const sum = await salesSummary(ctx, r);
    add("Sales summary", "get_sales_summary", { sales: m(sum.sales), netSalesExclTax: m(sum.netSales), collected: m(sum.collected), outstanding: m(sum.outstanding), expenses: m(sum.expenses), netProfitBeforeCOGS: m(sum.netProfit), transactions: sum.transactions, avgTransaction: m(sum.avgTransaction) },
      "Net profit = net sales (excl. tax) minus recorded expenses; cost of goods sold is not deducted.");
    if (wants(/compar|vs|versus|last month|previous/)) {
      const prevKey: RangeKey = key === "month" ? "lastmonth" : key === "today" ? "yesterday" : key === "lastmonth" ? "month" : "lastmonth";
      const pr = rangeFor(ctx, prevKey);
      const ps = await salesSummary(ctx, pr);
      const a = toCents(sum.sales), b = toCents(ps.sales);
      facts.push({ title: "Comparison period", range: `${pr.fromDate} to ${pr.toDate} (exclusive)`, source: "get_sales_summary", data: { sales: m(ps.sales), transactions: ps.transactions, changePercent: b ? Math.round(((a - b) / b) * 1000) / 10 : null }, note: b ? undefined : "Previous period has no sales, so no percentage change can be computed." });
      tools.push("get_revenue_comparison");
    }
  }
  if (canDash && wants(/appointment|booking|schedule|week|today/)) {
    const a = await appointmentStats(ctx, r); add("Appointments", "get_appointment_summary", a);
  }
  if (canReports && wants(/popular|service|promote|offer|marketing|growth|improv|recommend/) || (general && canReports)) {
    add("Top services (by quantity)", "get_service_performance", (await popularServices(ctx, r, 5)).map((x) => ({ ...x, revenue: m(x.revenue) })));
  }
  if (canReports && wants(/staff|stylist|employee|team|who generated|performance/)) {
    add("Staff performance", "get_staff_performance", (await staffPerformance(ctx, r)).map((x) => ({ name: x.name, revenue: m(x.revenue), servicesDone: x.services })));
  }
  if (canReports && wants(/expense|spend|cost/)) add("Expenses by category", "get_expenses", (await expenseByCategory(ctx, r)).map((x) => ({ category: x.category, total: m(x.total) })));
  if (canReports && wants(/busy|busiest|day|slow|quiet|gap/)) add("Appointments by weekday", "get_busiest_days", await busiestDays(ctx, rangeFor(ctx, "30d")), "Based on the last 30 days.");
  if (can(ctx, "customers.view") && wants(/customer|visit|inactive|haven't|retention|re-?engage|come back|lapsed/)) {
    const d = await dormantCustomers(ctx, 60, 20);
    add("Customers with no completed visit in 60+ days", "get_customer_retention", { count: d.length, customers: d.slice(0, 10).map((c) => ({ name: c.name, lastVisit: String(c.last).slice(0, 10), marketingConsent: c.marketing_consent })) },
      "Only customers with marketing consent should be contacted. Nothing is sent automatically.");
  }
  if (can(ctx, "inventory.view") && wants(/stock|inventor|reorder|product/)) {
    add("Low-stock products", "get_low_stock", await lowStock(ctx));
    if (canReports) add("Product sales", "get_product_sales", (await productSales(ctx, r)).slice(0, 8).map((x) => ({ name: x.name, qty: Number(x.qty), revenue: m(x.revenue) })));
  }
  if (can(ctx, "appointments.view") && wants(/slot|available|availability|free time|book/)) {
    const svc = (await listServices(ctx)).find((x) => s.includes(x.s.name.toLowerCase())) ?? (await listServices(ctx))[0];
    if (svc) {
      const date = /tomorrow/.test(s) ? rangeFor(ctx, "today").toDate : rangeFor(ctx, "today").fromDate;
      const slots = (await findSlots(ctx, { date, serviceId: svc.s.id })).slice(0, 12);
      add(`Available slots for ${svc.s.name}`, "check_availability", slots.map((x) => ({ staff: x.staffName, start: x.startsAt.toISOString(), local: x.label })), "Slots are verified by the booking engine. Book from the Appointments page; the assistant never books on its own.");
    }
  }
  if (!facts.length) facts.push({ title: "No data tools matched or you lack permission", range: rangeTxt, source: "none", data: null });
  return { facts, rangeLabel: label, tools };
}

const SYSTEM = (biz: string, cur: string) => `You are the SalonPro business advisor for "${biz}". Currency: ${cur}.
Rules: Use ONLY the verified FACTS provided. Never invent or recompute financial numbers; quote them as given. State the date range and the data source. If facts are missing or empty, say the data is incomplete. Clearly label any general advice (not from the data) as "General suggestion". You cannot change data, send messages, book, refund or purchase. Keep answers concise and practical.`;

export async function askAdvisor(ctx: Ctx, conversationId: string | null, question: string) {
  need(ctx, "ai.use");
  const q = question.trim();
  if (!q || q.length > 1500) throw new AppError("Ask a question (max 1500 characters).");
  let convId = conversationId;
  if (convId) {
    const [c] = await ctx.db.select().from(aiConversations).where(and(eq(aiConversations.id, convId), eq(aiConversations.tenantId, ctx.tenantId), eq(aiConversations.userId, ctx.userId)));
    if (!c) throw new AppError("Conversation not found", "not_found");
  } else {
    const [c] = await ctx.db.insert(aiConversations).values({ tenantId: ctx.tenantId, userId: ctx.userId, title: q.slice(0, 50) }).returning();
    convId = c.id;
  }
  await ctx.db.insert(aiMessages).values({ tenantId: ctx.tenantId, conversationId: convId, role: "user", content: q });
  const { facts, rangeLabel, tools } = await gatherFacts(ctx, q);
  const history = (await ctx.db.select().from(aiMessages).where(and(eq(aiMessages.conversationId, convId), eq(aiMessages.tenantId, ctx.tenantId))).orderBy(desc(aiMessages.createdAt)).limit(6)).reverse();
  const factsText = JSON.stringify(facts, null, 1);
  let content: string; let meta: Record<string, unknown> = { tools, facts };
  try {
    const r = await runAi(ctx, "advisor", [
      { role: "system", content: SYSTEM(ctx.tenant.name, ctx.tenant.currency) },
      ...history.slice(0, -1).map((h) => ({ role: h.role as "user" | "assistant", content: h.content.slice(0, 800) })),
      { role: "user", content: `FACTS (verified, period: ${rangeLabel}):\n${factsText}\n\nQUESTION: ${q}` },
    ]);
    content = r.text; meta = { ...meta, provider: r.provider, model: r.model, local: r.local, ai: true };
  } catch (e) {
    const err = e as AiError;
    // Honest fallback: verified numbers only, clearly labelled as not AI-written.
    content = `**AI is unavailable right now** — ${err.message}\n\nHere are the verified figures for ${rangeLabel} (no AI narrative):\n\n` +
      facts.map((f) => `**${f.title}** (${f.range}, source: ${f.source})\n\`\`\`\n${JSON.stringify(f.data, null, 1)}\n\`\`\`${f.note ? `\n_${f.note}_` : ""}`).join("\n\n");
    meta = { ...meta, ai: false, error: err.kind };
  }
  const [msg] = await ctx.db.insert(aiMessages).values({ tenantId: ctx.tenantId, conversationId: convId, role: "assistant", content, meta: meta as never }).returning();
  await ctx.db.update(aiConversations).set({ updatedAt: new Date() }).where(eq(aiConversations.id, convId));
  return { conversationId: convId, message: msg };
}

export async function listConversations(ctx: Ctx) {
  need(ctx, "ai.use");
  return ctx.db.select().from(aiConversations).where(and(eq(aiConversations.tenantId, ctx.tenantId), eq(aiConversations.userId, ctx.userId))).orderBy(desc(aiConversations.updatedAt)).limit(50);
}
export async function getMessages(ctx: Ctx, conversationId: string) {
  need(ctx, "ai.use");
  const [c] = await ctx.db.select().from(aiConversations).where(and(eq(aiConversations.id, conversationId), eq(aiConversations.tenantId, ctx.tenantId), eq(aiConversations.userId, ctx.userId)));
  if (!c) throw new AppError("Conversation not found", "not_found");
  return ctx.db.select().from(aiMessages).where(and(eq(aiMessages.conversationId, conversationId), eq(aiMessages.tenantId, ctx.tenantId))).orderBy(aiMessages.createdAt);
}
export async function renameConversation(ctx: Ctx, id: string, title: string) {
  need(ctx, "ai.use");
  await ctx.db.update(aiConversations).set({ title: title.trim().slice(0, 80) || "Conversation" }).where(and(eq(aiConversations.id, id), eq(aiConversations.tenantId, ctx.tenantId), eq(aiConversations.userId, ctx.userId)));
}
export async function deleteConversation(ctx: Ctx, id: string) {
  need(ctx, "ai.use");
  await ctx.db.delete(aiConversations).where(and(eq(aiConversations.id, id), eq(aiConversations.tenantId, ctx.tenantId), eq(aiConversations.userId, ctx.userId)));
}
export async function setFeedback(ctx: Ctx, messageId: string, feedback: "up" | "down") {
  need(ctx, "ai.use");
  await ctx.db.update(aiMessages).set({ feedback }).where(and(eq(aiMessages.id, messageId), eq(aiMessages.tenantId, ctx.tenantId)));
}

// ------------------------------------------------------------------
// Marketing Studio (generate only; never publishes)
// ------------------------------------------------------------------
export type MarketingInput = { platform: string; kind: string; service?: string; promotion?: string; audience?: string; tone: string; language: string; length: "short" | "medium" | "long" };
export async function generateMarketing(ctx: Ctx, i: MarketingInput) {
  need(ctx, "ai.use");
  const clip = (s?: string) => (s ?? "").slice(0, 200);
  const prompt = `Write ${i.length} ${i.kind} for ${i.platform} for the business "${ctx.tenant.name}" (${ctx.tenant.businessType.replace(/_/g, " ")}).
${i.service ? `Service: ${clip(i.service)}\n` : ""}${i.promotion ? `Promotion: ${clip(i.promotion)}\n` : ""}${i.audience ? `Audience: ${clip(i.audience)}\n` : ""}Tone: ${clip(i.tone)}. Language: ${clip(i.language)}.
Do not invent prices, discounts, dates or claims that were not provided above. Output only the content, ready to edit.`;
  const r = await runAi(ctx, "marketing", [{ role: "system", content: "You are a marketing copywriter for beauty and hair businesses. Be accurate and never fabricate offers." }, { role: "user", content: prompt }], { maxTokens: 800 });
  return { text: r.text, provider: r.provider, model: r.model, local: r.local };
}
export async function saveContent(ctx: Ctx, kind: string, title: string, content: string) {
  need(ctx, "ai.use");
  const [c] = await ctx.db.insert(aiSavedContent).values({ tenantId: ctx.tenantId, userId: ctx.userId, kind, title: title.slice(0, 100) || kind, content: content.slice(0, 8000) }).returning();
  return c;
}
export async function listContent(ctx: Ctx) {
  need(ctx, "ai.use");
  return ctx.db.select().from(aiSavedContent).where(eq(aiSavedContent.tenantId, ctx.tenantId)).orderBy(desc(aiSavedContent.createdAt)).limit(100);
}
export async function deleteContent(ctx: Ctx, id: string) {
  need(ctx, "ai.use");
  await ctx.db.delete(aiSavedContent).where(and(eq(aiSavedContent.id, id), eq(aiSavedContent.tenantId, ctx.tenantId)));
}

export async function aiUsageSummary(db: DB) {
  const rows = await db.execute<{ provider: string; status: string; n: string; tokens: string }>(sql`select provider, status, count(*) n, coalesce(sum(tokens),0) tokens from ai_usage where created_at > now() - interval '30 days' group by 1,2 order by 1,2`);
  const byTenant = await db.execute<{ name: string; n: string }>(sql`select coalesce(t.name,'(platform)') name, count(*) n from ai_usage u left join tenants t on t.id = u.tenant_id where u.created_at > now() - interval '30 days' group by 1 order by 2 desc limit 20`);
  return { byProvider: rows.rows, byTenant: byTenant.rows };
}
export { audit, revenueSeries };
