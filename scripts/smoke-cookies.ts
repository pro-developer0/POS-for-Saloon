// Dev tool: mints session cookies for demo users so pages can be smoke-tested with curl. Dev secret only.
import { SignJWT } from "jose";
import { eq } from "drizzle-orm";
import { createDb } from "../src/db/client";
import { users, tenants, memberships } from "../src/db/schema";

async function main() {
  const db = await createDb();
  const secret = new TextEncoder().encode(process.env.AUTH_SECRET ?? "dev-only-insecure-secret-change-me-please-0123456789");
  const out: Record<string, { session: string; tenant: string }> = {};
  const ts = await db.select().from(tenants);
  for (const [key, email] of [["royal", "owner@royal.demo"], ["glow", "owner@glow.demo"], ["admin", "admin@salonpro.local"], ["multi", "multi@demo.test"]] as const) {
    const [u] = await db.select().from(users).where(eq(users.email, email));
    const ms = await db.select().from(memberships).where(eq(memberships.userId, u.id));
    const session = await new SignJWT({}).setProtectedHeader({ alg: "HS256" }).setSubject(u.id).setIssuedAt().setExpirationTime("1h").sign(secret);
    out[key] = { session, tenant: ms[0]?.tenantId ?? ts[0].id };
  }
  console.log(JSON.stringify(out));
  process.exit(0);
}
main();
