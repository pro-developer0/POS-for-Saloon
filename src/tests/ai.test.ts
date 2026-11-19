import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createDb, type DB } from "@/db/client";
import { users, aiUsage } from "@/db/schema";
import { seedDemo, DEMO_USERS } from "@/server/seed";
import { buildCtx, type Ctx } from "@/server/ctx";
import { askAdvisor, getMessages, listConversations, saveAiConfig, generateMarketing, gatherFacts } from "@/server/ai/service";
import { assertFree, clearCooldowns } from "@/server/ai/providers";
import { salesSummary, rangeFor } from "@/server/services/reports";
import { formatMoney } from "@/lib/money";

let db: DB; let royal: Ctx; let glow: Ctx; let ids: Record<string, string>;
const uid = async (e: string) => (await db.select().from(users).where(eq(users.email, e)))[0].id;

beforeAll(async () => {
  db = await createDb({ memory: true });
  ids = await seedDemo(db);
  royal = await buildCtx(db, await uid(DEMO_USERS.royal), ids.royal);
  glow = await buildCtx(db, await uid(DEMO_USERS.glow), ids.glow);
});
afterEach(() => { vi.restoreAllMocks(); clearCooldowns(); delete process.env.GROQ_API_KEY; });

const ollamaOk = (text: string) => vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ message: { content: text }, eval_count: 5, prompt_eval_count: 5 }), { status: 200 }));

describe("free-only enforcement", () => {
  it("rejects non-free OpenRouter models and unknown providers", () => {
    expect(() => assertFree("openrouter", "openai/gpt-4o")).toThrow(/free/i);
    expect(() => assertFree("openrouter", "meta-llama/llama-3.2-3b-instruct:free")).not.toThrow();
    expect(() => assertFree("openai" as never, "gpt-4o")).toThrow(/allowlist/i);
  });
  it("cannot save a paid OpenRouter model in platform config", async () => {
    await expect(saveAiConfig(db, { provider: "openrouter", model: "anthropic/claude-3-opus" })).rejects.toThrow(/free/i);
  });
});

describe("AI disabled / failure handling keeps the app working and never fakes AI", () => {
  it("AI off: advisor returns verified figures, labelled as non-AI, with no network call", async () => {
    await saveAiConfig(db, { enabled: false });
    const f = vi.spyOn(globalThis, "fetch");
    const r = await askAdvisor(royal, null, "How much did I earn this month?");
    expect(f).not.toHaveBeenCalled();
    expect(r.message.content).toMatch(/AI is unavailable/);
    const real = await salesSummary(royal, rangeFor(royal, "month"));
    expect(r.message.content).toContain(formatMoney(real.sales, "PKR"));
    expect((r.message.meta as { ai: boolean }).ai).toBe(false);
  });
  it("local Ollama works and receives only verified facts", async () => {
    await saveAiConfig(db, { enabled: true, mode: "local", provider: "ollama", model: "llama3.2:3b" });
    const f = ollamaOk("You earned a lot.");
    const r = await askAdvisor(royal, null, "Show my sales this month");
    expect(r.message.content).toBe("You earned a lot.");
    const body = JSON.parse(String((f.mock.calls[0][1] as RequestInit).body));
    expect(body.messages.at(-1).content).toContain("get_sales_summary");
    expect(f.mock.calls[0][0]).toMatch(/localhost:11434/);
  });
  it("Ollama offline gives a friendly message and the fallback facts", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("ECONNREFUSED"));
    const r = await askAdvisor(royal, null, "What are my expenses this month?");
    expect(r.message.content).toMatch(/offline/i);
    expect(r.message.content).toMatch(/Expenses/);
  });
  it("free quota (HTTP 429) stops requests, is reported, and never switches to another provider", async () => {
    process.env.GROQ_API_KEY = "test";
    await saveAiConfig(db, { enabled: true, mode: "cloud_free", provider: "groq", model: "llama-3.1-8b-instant", cloudDisabled: false });
    const f = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("rate limited", { status: 429 }));
    const r1 = await askAdvisor(royal, null, "sales today");
    expect(r1.message.content).toMatch(/quota|rate limit/i);
    await askAdvisor(royal, null, "sales today");
    expect(f).toHaveBeenCalledTimes(1); // cooldown: second request did not hit the provider
    for (const c of f.mock.calls) expect(String(c[0])).toContain("api.groq.com");
  });
  it("cloud disabled by platform => cloud provider never called", async () => {
    process.env.GROQ_API_KEY = "test";
    await saveAiConfig(db, { enabled: true, mode: "cloud_free", provider: "groq", cloudDisabled: true });
    const f = vi.spyOn(globalThis, "fetch");
    const r = await askAdvisor(royal, null, "sales today");
    expect(f).not.toHaveBeenCalled();
    expect(r.message.content).toMatch(/No free AI provider|disabled/i);
  });
  it("per-business switch and daily limit are enforced", async () => {
    await saveAiConfig(db, { enabled: true, mode: "local", provider: "ollama", cloudDisabled: false });
    ollamaOk("ok");
    const tiny = { ...glow, tenant: { ...glow.tenant, aiDailyLimit: 1 } };
    const a = await askAdvisor(tiny, null, "sales today");
    expect((a.message.meta as { ai: boolean }).ai).toBe(true);
    const b = await askAdvisor(tiny, null, "sales today");
    expect(b.message.content).toMatch(/daily AI request limit/);
    const off = { ...royal, tenant: { ...royal.tenant, aiEnabled: false } };
    expect((await askAdvisor(off, null, "hi")).message.content).toMatch(/turned off for this business/);
  });
  it("usage is logged per tenant with provider and status", async () => {
    const rows = await db.select().from(aiUsage).where(eq(aiUsage.tenantId, ids.royal));
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.provider && r.status)).toBe(true);
  });
  it("marketing generation surfaces provider errors instead of fabricating", async () => {
    await saveAiConfig(db, { enabled: false });
    await expect(generateMarketing(royal, { platform: "Instagram", kind: "caption", tone: "friendly", language: "English", length: "short" })).rejects.toThrow(/turned off/i);
  });
});

describe("AI tenant isolation and permissions", () => {
  it("conversations are private to the tenant and user", async () => {
    await saveAiConfig(db, { enabled: false });
    const r = await askAdvisor(royal, null, "sales today");
    expect((await listConversations(glow)).some((c) => c.id === r.conversationId)).toBe(false);
    await expect(getMessages(glow, r.conversationId)).rejects.toThrow(/not found/i);
    await expect(askAdvisor(glow, r.conversationId, "continue")).rejects.toThrow(/not found/i);
  });
  it("advisor facts only contain the caller's tenant data", async () => {
    const { facts } = await gatherFacts(glow, "how much did I earn this year");
    const text = JSON.stringify(facts);
    expect(text).toContain("$");
    expect(text).not.toContain("PKR");
  });
  it("staff role cannot use AI or see financial tools", async () => {
    const staffCtx = { ...royal, role: "staff", perms: new Set(["appointments.view", "customers.view"]) };
    await expect(askAdvisor(staffCtx, null, "sales today")).rejects.toThrow(/Permission/);
    const { facts } = await gatherFacts(staffCtx, "how much did I earn today");
    expect(facts[0].source).toBe("none");
  });
});
