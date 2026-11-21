import { NextResponse } from "next/server";
import { getUser } from "@/server/session";
import { db } from "@/db/client";
import { files, memberships } from "@/db/schema";
import { and, eq } from "drizzle-orm";

// Logos/favicons are branding (public-ish). Receipts require membership of the owning tenant.
export async function GET(_: Request, { params }: { params: Promise<{ tenant: string; name: string }> }) {
  const { tenant, name } = await params;
  if (!/^[0-9a-f-]{36}$/.test(tenant) || !/^(logo|favicon|receipt)-[0-9a-f]{16}\.(png|jpg|webp|pdf)$/.test(name)) return new NextResponse("Not found", { status: 404 });
  if (name.startsWith("receipt-")) {
    const u = await getUser();
    const d = await db();
    const ok = u && (await d.select({ id: memberships.id }).from(memberships).where(and(eq(memberships.userId, u.id), eq(memberships.tenantId, tenant), eq(memberships.active, true)))).length;
    if (!ok) return new NextResponse("Forbidden", { status: 403 });
  }
  const d = await db();
  const [f] = await d.select({ data: files.data, mime: files.mime }).from(files).where(and(eq(files.tenantId, tenant), eq(files.name, name)));
  if (!f) return new NextResponse("Not found", { status: 404 });
  return new NextResponse(new Uint8Array(f.data), { headers: { "content-type": f.mime, "cache-control": "private, max-age=3600", "x-content-type-options": "nosniff", "content-security-policy": "default-src 'none'; sandbox" } });
}
