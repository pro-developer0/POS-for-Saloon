import { drizzle as drizzlePglite, type PgliteDatabase } from "drizzle-orm/pglite";
import { migrate as migratePglite } from "drizzle-orm/pglite/migrator";
import * as schema from "./schema";
import path from "node:path";

export type DB = PgliteDatabase<typeof schema>;
type G = { __salonDb?: Promise<DB> };
const g = globalThis as unknown as G;

/** DATABASE_URL => PostgreSQL (production). Otherwise embedded PGlite (dev/test). */
export async function createDb(opts: { memory?: boolean } = {}): Promise<DB> {
  const folder = path.join(process.cwd(), "drizzle");
  const url = process.env.DATABASE_URL;
  if (url && !opts.memory) {
    const { Pool } = await import("pg");
    const { drizzle } = await import("drizzle-orm/node-postgres");
    const { migrate } = await import("drizzle-orm/node-postgres/migrator");
    // Hosted Postgres (Supabase, Neon…) requires SSL. Set DATABASE_SSL=false for a local/plain server.
    const local = /@(localhost|127\.0\.0\.1)/.test(url);
    const ssl = process.env.DATABASE_SSL === "false" || local ? undefined : { rejectUnauthorized: false };
    const conn = url.replace(/([?&])sslmode=[^&]*&?/, "$1").replace(/[?&]$/, ""); // our ssl option must not be overridden by the URL
    const pg = drizzle(new Pool({ connectionString: conn, ssl, max: Number(process.env.DATABASE_POOL_MAX ?? 5) }), { schema });
    await migrate(pg, { migrationsFolder: folder });
    return pg as unknown as DB;
  }
  const { PGlite } = await import("@electric-sql/pglite");
  const dir = opts.memory ? undefined : process.env.PGLITE_DIR ?? path.join(process.cwd(), ".data", "pglite");
  if (dir) (await import("node:fs")).mkdirSync(path.dirname(dir), { recursive: true });
  const client = new PGlite(dir);
  const d = drizzlePglite(client, { schema });
  await migratePglite(d, { migrationsFolder: folder });
  return d;
}

export function db(): Promise<DB> {
  return (g.__salonDb ??= createDb());
}
export function resetDbSingleton() { g.__salonDb = undefined; }
export { schema };
