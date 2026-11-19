import { NextResponse } from "next/server";
import { requireCtx } from "@/server/session";
import * as rep from "@/server/services/reports";
import { listProducts, listExpenses } from "@/server/services/inventory";
import type { RangeKey } from "@/lib/time";

// CSV injection guard: cells beginning with = + - @ are prefixed with a quote.
const cell = (v: unknown) => {
  let s = String(v ?? "");
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const toCsv = (head: string[], rows: unknown[][]) => [head, ...rows].map((r) => r.map(cell).join(",")).join("\n");

export async function GET(req: Request, { params }: { params: Promise<{ name: string }> }) {
  const ctx = await requireCtx("reports.view"); // tenant resolved from the session, never from the URL
  const { name } = await params;
  const u = new URL(req.url);
  const r = rep.rangeFor(ctx, (u.searchParams.get("range") ?? "30d") as RangeKey, { from: u.searchParams.get("from") ?? undefined, to: u.searchParams.get("to") ?? undefined });
  let csv: string;
  switch (name) {
    case "sales": csv = toCsv(["date", "revenue", "transactions"], (await rep.revenueSeries(ctx, r)).map((x) => [x.date, x.revenue, x.count])); break;
    case "services": csv = toCsv(["service", "quantity", "revenue"], (await rep.popularServices(ctx, r, 500)).map((x) => [x.name, x.qty, x.revenue])); break;
    case "staff": csv = toCsv(["staff", "services", "revenue", "commission"], (await rep.staffPerformance(ctx, r)).map((x) => [x.name, x.services, x.revenue, x.commission])); break;
    case "customers": csv = toCsv(["name", "phone", "last_visit", "marketing_consent"], (await rep.dormantCustomers(ctx, 60, 1000)).map((x) => [x.name, x.phone, String(x.last).slice(0, 10), x.marketing_consent])); break;
    case "inventory": csv = toCsv(["product", "sku", "quantity", "min_stock", "cost", "price"], (await listProducts(ctx)).map(({ p }) => [p.name, p.sku, p.quantity, p.minStock, p.costPrice, p.sellPrice])); break;
    case "payments": csv = toCsv(["method", "count", "total"], (await rep.paymentsByMethod(ctx, r)).map((x) => [x.method, x.n, x.total])); break;
    case "expenses": csv = toCsv(["date", "name", "category", "amount"], (await listExpenses(ctx, r.fromDate, r.toDate)).map((x) => [x.spentOn, x.name, x.category, x.amount])); break;
    default: return new NextResponse("Not found", { status: 404 });
  }
  return new NextResponse(csv, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${name}-${r.fromDate}.csv"` } });
}
