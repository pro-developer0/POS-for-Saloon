/**
 * FREE-ONLY AI provider layer.
 * Hard guarantees (enforced in code, not config):
 *  - Only providers in FREE_PROVIDERS can be used. There is no generic "custom paid endpoint" provider.
 *  - Cloud requests may only go to the hosts in ALLOWED_HOSTS.
 *  - OpenRouter is restricted to model ids ending in ":free".
 *  - No automatic cross-provider fallback to anything outside the allowlist; quota errors stop the request.
 *  - API keys come from environment variables only and are never sent to the browser.
 *  IMPORTANT: free tiers change. Verify each provider's current free quota and commercial-use terms before
 *  enabling it for customers. Local (Ollama) has no usage cost and no third-party terms.
 */
export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };
export type ProviderId = "ollama" | "groq" | "gemini" | "openrouter";

export class AiError extends Error {
  constructor(message: string, public kind: "disabled" | "quota" | "auth" | "offline" | "timeout" | "bad_response" | "unsupported" | "blocked") { super(message); }
}

export const FREE_PROVIDERS: Record<ProviderId, { label: string; local: boolean; envKey?: string; host?: string; defaultModel: string; note: string }> = {
  ollama: { label: "Ollama (local, no cost)", local: true, defaultModel: "llama3.2:3b", note: "Runs on your own computer/server. Choose a model that fits your hardware." },
  groq: { label: "Groq (free tier)", local: false, envKey: "GROQ_API_KEY", host: "api.groq.com", defaultModel: "llama-3.1-8b-instant", note: "Free-tier API key, rate-limited. Verify current terms for commercial use." },
  gemini: { label: "Google Gemini (free tier)", local: false, envKey: "GEMINI_API_KEY", host: "generativelanguage.googleapis.com", defaultModel: "gemini-2.0-flash", note: "Free-tier API key from Google AI Studio. Free-tier data may be used by Google; verify terms. Do not enable billing." },
  openrouter: { label: "OpenRouter (':free' models only)", local: false, envKey: "OPENROUTER_API_KEY", host: "openrouter.ai", defaultModel: "meta-llama/llama-3.2-3b-instruct:free", note: "Only models whose id ends in ':free' are accepted." },
};
const ALLOWED_HOSTS = new Set(Object.values(FREE_PROVIDERS).map((p) => p.host).filter(Boolean) as string[]);

export type AiConfig = {
  enabled: boolean; mode: "local" | "cloud_free" | "auto"; // auto = local first, then free cloud
  provider: ProviderId; model: string; ollamaUrl: string; cloudDisabled: boolean;
  perTenantDailyLimit: number; globalDailyLimit: number;
};
export const DEFAULT_AI_CONFIG: AiConfig = {
  enabled: false, mode: "local", provider: "ollama", model: FREE_PROVIDERS.ollama.defaultModel,
  ollamaUrl: process.env.OLLAMA_URL || "http://localhost:11434", cloudDisabled: false, perTenantDailyLimit: 30, globalDailyLimit: 500,
};

const cooldown = new Map<string, number>(); // provider -> epoch ms until which we do not call it
export const clearCooldowns = () => cooldown.clear();

export function assertFree(provider: ProviderId, model: string) {
  if (!(provider in FREE_PROVIDERS)) throw new AiError("Provider is not on the free-only allowlist.", "blocked");
  if (provider === "openrouter" && !model.endsWith(":free")) throw new AiError("Only free (':free') OpenRouter models are allowed.", "blocked");
  if (!model || model.length > 120) throw new AiError("Invalid model.", "unsupported");
}

async function post(url: string, init: RequestInit, timeoutMs: number, localOk: boolean) {
  const u = new URL(url);
  if (!localOk && !ALLOWED_HOSTS.has(u.hostname)) throw new AiError(`Blocked request to non-allowlisted host ${u.hostname}.`, "blocked");
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try { return await fetch(url, { ...init, signal: ctl.signal }); }
  catch (e) {
    if ((e as Error).name === "AbortError") throw new AiError("The AI provider timed out.", "timeout");
    throw new AiError(localOk ? "Local AI is offline. Start Ollama and try again." : "Could not reach the AI provider.", "offline");
  } finally { clearTimeout(timer); }
}

function mapHttp(provider: ProviderId, status: number, body: string): AiError {
  if (status === 429) { cooldown.set(provider, Date.now() + 60_000); return new AiError("The free AI quota or rate limit was reached. Please try again later or switch to local AI.", "quota"); }
  if (status === 401 || status === 403) return new AiError("The AI provider rejected the API key.", "auth");
  if (status === 404) return new AiError("The selected model is not available on this provider.", "unsupported");
  if (status === 402) return new AiError("This provider asked for payment. Paid usage is blocked; choose a free model.", "blocked");
  return new AiError(`AI provider error (${status}). ${body.slice(0, 120)}`, "bad_response");
}

export async function chat(cfg: AiConfig, provider: ProviderId, model: string, messages: ChatMessage[], opts: { timeoutMs?: number; maxTokens?: number } = {}) {
  assertFree(provider, model);
  const meta = FREE_PROVIDERS[provider];
  if (!meta.local && cfg.cloudDisabled) throw new AiError("Cloud AI is disabled by the platform owner.", "disabled");
  if ((cooldown.get(provider) ?? 0) > Date.now()) throw new AiError("The free AI quota was recently exhausted. Try again in a minute, or use local AI.", "quota");
  const timeoutMs = opts.timeoutMs ?? (meta.local ? 120_000 : 30_000);
  const maxTokens = opts.maxTokens ?? 700;

  if (provider === "ollama") {
    const res = await post(`${cfg.ollamaUrl.replace(/\/$/, "")}/api/chat`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model, messages, stream: false, options: { num_predict: maxTokens } }) }, timeoutMs, true);
    if (!res.ok) { const b = await res.text(); throw b.includes("not found") ? new AiError(`Model "${model}" is not installed in Ollama. Run: ollama pull ${model}`, "unsupported") : mapHttp(provider, res.status, b); }
    const j = (await res.json()) as { message?: { content?: string }; prompt_eval_count?: number; eval_count?: number };
    if (!j.message?.content) throw new AiError("The model returned an empty response.", "bad_response");
    return { text: j.message.content.trim(), tokens: (j.prompt_eval_count ?? 0) + (j.eval_count ?? 0) };
  }

  const key = process.env[meta.envKey!];
  if (!key) throw new AiError(`${meta.label} is not configured (missing ${meta.envKey}).`, "auth");

  if (provider === "gemini") {
    const sys = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n");
    const contents = messages.filter((m) => m.role !== "system").map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] }));
    const res = await post(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: "POST", headers: { "content-type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({ systemInstruction: sys ? { parts: [{ text: sys }] } : undefined, contents, generationConfig: { maxOutputTokens: maxTokens } }),
    }, timeoutMs, false);
    if (!res.ok) throw mapHttp(provider, res.status, await res.text());
    const j = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[]; usageMetadata?: { totalTokenCount?: number } };
    const text = j.candidates?.[0]?.content?.parts?.map((p) => p.text).join("") ?? "";
    if (!text) throw new AiError("The model returned an empty response.", "bad_response");
    return { text: text.trim(), tokens: j.usageMetadata?.totalTokenCount ?? 0 };
  }

  // OpenAI-compatible (groq, openrouter)
  const base = provider === "groq" ? "https://api.groq.com/openai/v1/chat/completions" : "https://openrouter.ai/api/v1/chat/completions";
  const res = await post(base, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${key}` }, body: JSON.stringify({ model, messages, max_tokens: maxTokens }) }, timeoutMs, false);
  if (!res.ok) throw mapHttp(provider, res.status, await res.text());
  const j = (await res.json()) as { choices?: { message?: { content?: string } }[]; usage?: { total_tokens?: number } };
  const text = j.choices?.[0]?.message?.content;
  if (!text) throw new AiError("The model returned an empty response.", "bad_response");
  return { text: text.trim(), tokens: j.usage?.total_tokens ?? 0 };
}

export function providerConfigured(provider: ProviderId) {
  const m = FREE_PROVIDERS[provider];
  return m.local ? true : !!process.env[m.envKey!];
}

/** Order of providers to try, derived from mode. Never includes anything outside the free allowlist. */
export function plan(cfg: AiConfig): { provider: ProviderId; model: string }[] {
  if (!cfg.enabled) return [];
  const local = { provider: "ollama" as const, model: cfg.provider === "ollama" ? cfg.model : FREE_PROVIDERS.ollama.defaultModel };
  const cloud = cfg.provider !== "ollama" ? { provider: cfg.provider, model: cfg.model } : null;
  if (cfg.mode === "local") return [{ provider: "ollama", model: cfg.provider === "ollama" ? cfg.model : local.model }];
  if (cfg.mode === "cloud_free") return cloud && !cfg.cloudDisabled ? [cloud] : [];
  return [local, ...(cloud && !cfg.cloudDisabled ? [cloud] : [])];
}
