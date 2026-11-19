// Adds the demo pharmacy to an EXISTING dev database without touching other data. Safe to run twice.
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { createDb } from "../src/db/client";
import { users } from "../src/db/schema";
import { seedPharmacy, DEMO_PASSWORD, DEMO_USERS } from "../src/server/seed";

(async () => {
  if (process.env.DATABASE_URL) throw new Error("Dev databases only.");
  const db = await createDb();
  const [exists] = await db.select({ id: users.id }).from(users).where(eq(users.email, DEMO_USERS.pharmacy));
  if (exists) { console.log("Demo pharmacy already exists."); process.exit(0); }
  await seedPharmacy(db, await bcrypt.hash(DEMO_PASSWORD, 10));
  console.log(`Demo pharmacy added: ${DEMO_USERS.pharmacy} and ${DEMO_USERS.pharmacist} (password ${DEMO_PASSWORD})`);
  process.exit(0);
})();
