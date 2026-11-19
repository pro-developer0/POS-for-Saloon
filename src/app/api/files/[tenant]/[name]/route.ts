import fs from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { uploadRoot } from "@/server/uploads";
import { getUser } from "@/server/session";
import { db } from "@/db/client";
import { memberships } from "@/db/schema";
import { and, eq } from "drizzle-orm";

const MIME: Record<string, string> = { png: "image/png", jpg: "image/jpeg", webp: "image/webp", pdf: "application/pdf" };

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
  try {
    const buf = await fs.readFile(path.join(uploadRoot(), tenant, name));
    return new NextResponse(new Uint8Array(buf), { headers: { "content-type": MIME[name.split(".")[1]], "cache-control": "private, max-age=3600", "x-content-type-options": "nosniff", "content-security-policy": "default-src 'none'; sandbox" } });
  } catch { return new NextResponse("Not found", { status: 404 }); }
}
