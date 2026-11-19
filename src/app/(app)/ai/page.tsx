import { PRODUCT_NAME } from "@/lib/brand";
import Link from "next/link";
import { requireCtx } from "@/server/session";
import { getAiConfig, listConversations, listContent } from "@/server/ai/service";
import { plan, providerConfigured } from "@/server/ai/providers";
import { dormantCustomers, productSales, rangeFor } from "@/server/services/reports";
import { listProducts } from "@/server/services/inventory";
import { listServices } from "@/server/services/crm";
import { Advisor } from "@/components/advisor";
import { MarketingStudio } from "@/components/marketing-studio";
import { Card, Empty, PageHeader, Tabs } from "@/components/ui";
import { fmtDate } from "@/lib/time";

export const metadata = { title: "AI Assistant" };
export default async function Page({ searchParams }: { searchParams: Promise<{ tab?: string; kind?: string; audience?: string; promotion?: string }> }) {
  const ctx = await requireCtx("ai.use");
  const sp = await searchParams; const tab = ["advisor", "marketing", "insights"].includes(sp.tab ?? "") ? sp.tab! : "advisor";
  const cfg = await getAiConfig(ctx.db);
  const steps = plan(cfg).filter((s) => providerConfigured(s.provider));
  let reason: string | undefined;
  if (!cfg.enabled) reason = "AI is turned off by the platform administrator.";
  else if (!ctx.tenant.aiEnabled) reason = "AI is turned off for this business (Settings → AI).";
  else if (!steps.length) reason = "No free AI provider is configured yet.";
  const enabled = !reason;
  const t = (k: string, l: string) => ({ key: k, label: l, href: `/ai?tab=${k}` });
  return (
    <div className="page-in">
      <PageHeader title="AI Assistant" desc={`Optional. Free/local models only — the rest of ${PRODUCT_NAME} works without it.`} />
      <Tabs active={tab} tabs={[t("advisor", "Business advisor"), t("marketing", "Marketing studio"), t("insights", "Retention & inventory insights")]} />
      {tab === "advisor" && <Advisor conversations={(await listConversations(ctx)).map((c) => ({ id: c.id, title: c.title, updatedAt: c.updatedAt.toISOString() }))} enabled={enabled} reason={reason} />}
      {tab === "marketing" && <MarketingStudio saved={(await listContent(ctx)).map((s) => ({ id: s.id, kind: s.kind, title: s.title, content: s.content, createdAt: s.createdAt.toISOString() }))} services={(await listServices(ctx)).map((s) => s.s.name)} preset={sp} aiNote={reason} />}
      {tab === "insights" && await (async () => {
        const r30 = rangeFor(ctx, "30d");
        const [dormant, prods, sold] = await Promise.all([ctx.perms.has("customers.view") ? dormantCustomers(ctx, 60, 25) : [], ctx.perms.has("inventory.view") ? listProducts(ctx) : [], ctx.perms.has("reports.view") ? productSales(ctx, r30) : []]);
        const rate = new Map(sold.map((x) => [x.name, Number(x.qty) / 30]));
        const risks = prods.map(({ p }) => { const d = rate.get(p.name) ?? 0; return { p, perDay: d, daysLeft: d > 0 ? p.quantity / d : null, reorder: Math.max(0, Math.ceil(d * 30) - p.quantity) }; })
          .filter((x) => x.p.quantity <= x.p.minStock || (x.daysLeft !== null && x.daysLeft < 14)).sort((a, b) => (a.daysLeft ?? 999) - (b.daysLeft ?? 999));
        return (
          <div className="grid gap-4 lg:grid-cols-2">
            <Card title="Customers who may benefit from a reminder">
              <p className="px-5 pt-3 text-xs text-muted">Completed visit more than 60 days ago. Only customers who agreed to marketing are offered a message draft. Nothing is sent automatically.</p>
              {dormant.length === 0 ? <Empty title="No lapsed customers" /> : <ul className="divide-y divide-line text-sm">{dormant.map((c) => (
                <li key={c.id} className="flex items-center justify-between gap-3 px-5 py-3"><div><p className="font-medium">{c.name}</p><p className="text-xs text-muted">Last visit {fmtDate(c.last, ctx.tenant.timezone)}</p></div>
                  {c.marketing_consent ? <Link className="btn btn-sm" href={`/ai?tab=marketing&kind=${encodeURIComponent("customer re-engagement message")}&audience=${encodeURIComponent("a returning customer who has not visited in a while")}`}>Draft message</Link> : <span className="badge">No marketing consent</span>}</li>))}</ul>}
            </Card>
            <Card title="Inventory risks & suggested reorders">
              <p className="px-5 pt-3 text-xs text-muted">Based on the last 30 days of product sales. Suggestions only — nothing is ordered automatically.</p>
              {risks.length === 0 ? <Empty title="No inventory risks detected" /> : <div className="overflow-x-auto"><table className="tbl"><thead><tr><th>Product</th><th className="text-right">In stock</th><th className="text-right">Days left</th><th className="text-right">Suggest (30d)</th></tr></thead>
                <tbody>{risks.map((x) => <tr key={x.p.id}><td className="font-medium">{x.p.name}</td><td className="text-right">{x.p.quantity}</td><td className="text-right">{x.daysLeft === null ? "no recent sales" : x.daysLeft.toFixed(0)}</td><td className="text-right font-semibold">{x.reorder || "—"}</td></tr>)}</tbody></table></div>}
            </Card>
          </div>);
      })()}
    </div>
  );
}
