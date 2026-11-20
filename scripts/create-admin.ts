/**
 * Creates (or promotes) the platform admin on ANY database, including your live Supabase one.
 * Also applies pending migrations, so it doubles as "set up the database".
 *
 *   ADMIN_EMAIL=you@example.com ADMIN_NAME="Your Name" ADMIN_PASSWORD='a-long-password-1' DATABASE_URL=... npm run admin:create
 */
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { createDb } from "../src/db/client";
import { users } from "../src/db/schema";
import { passwordSchema } from "../src/server/auth";

async function main() {
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase(), name = process.env.ADMIN_NAME?.trim() || "Platform Admin", password = process.env.ADMIN_PASSWORD;
  if (!email || !password) throw new Error("Set ADMIN_EMAIL and ADMIN_PASSWORD (and DATABASE_URL for the live database).");
  passwordSchema.parse(password);
  const db = await createDb();
  const passwordHash = await bcrypt.hash(password, 11);
  const [ex] = await db.select({ id: users.id }).from(users).where(eq(users.email, email));
  if (ex) {
    await db.update(users).set({ isPlatformAdmin: true, passwordHash, disabled: false, failedLogins: 0, lockedUntil: null, emailVerifiedAt: new Date(), mustChangePassword: false }).where(eq(users.id, ex.id));
    console.log(`Updated existing user ${email}: now a platform admin with the new password.`);
  } else {
    await db.insert(users).values({ email, name, passwordHash, isPlatformAdmin: true, emailVerifiedAt: new Date() });
    console.log(`Created platform admin ${email}.`);
  }
  process.exit(0);
}
main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
