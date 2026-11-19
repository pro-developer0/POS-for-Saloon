import fs from "node:fs";
import path from "node:path";
import { createDb } from "../src/db/client";
import { seedDemo, DEMO_PASSWORD, DEMO_USERS } from "../src/server/seed";
import { users } from "../src/db/schema";

async function main() {
  const reset = process.argv.includes("--reset");
  if (process.env.DATABASE_URL && reset) throw new Error("Refusing to --reset a DATABASE_URL database. Reset embedded dev data only.");
  if (reset) fs.rmSync(process.env.PGLITE_DIR ?? path.join(process.cwd(), ".data", "pglite"), { recursive: true, force: true });
  const db = await createDb();
  const existing = await db.select({ id: users.id }).from(users).limit(1);
  if (existing.length) { console.log("Database already has data. Use `npm run demo:reset` to wipe and reseed the DEV database."); process.exit(0); }
  await seedDemo(db);
  console.log("Demo data created (clearly marked as demo businesses).\n");
  for (const [k, v] of Object.entries(DEMO_USERS)) console.log(`  ${k.padEnd(6)} ${v}`);
  console.log(`  password for all: ${DEMO_PASSWORD}\n`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
