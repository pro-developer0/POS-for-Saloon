import { beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createDb, type DB } from "@/db/client";
import { files } from "@/db/schema";
import { registerOwner } from "@/server/auth";

let db: DB;
vi.mock("server-only", () => ({}));
vi.mock("@/db/client", async (orig) => { const m = await orig<typeof import("@/db/client")>(); return { ...m, db: () => Promise.resolve(db) }; });

beforeAll(async () => { db = await createDb({ memory: true }); });

describe("uploads are stored in the database", () => {
  it("saves a PNG for a tenant, returns its URL, and rejects a fake image", async () => {
    const { saveUpload } = await import("@/server/uploads");
    const { tenant } = await registerOwner(db, { name: "Up Owner", email: "up@v.test", password: "Upload-Pass-1", businessName: "Up Salon", businessType: "hair_salon" });
    const png = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3])], "logo.png", { type: "image/png" });
    const url = await saveUpload(tenant.id, png, "logo");
    expect(url).toMatch(new RegExp(`^/api/files/${tenant.id}/logo-[0-9a-f]{16}\.png$`));
    const rows = await db.select().from(files).where(eq(files.tenantId, tenant.id));
    expect(rows).toHaveLength(1);
    expect(rows[0].mime).toBe("image/png");
    expect(Buffer.from(rows[0].data).subarray(0, 4)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    const fake = new File([new Uint8Array([1, 2, 3, 4])], "x.png", { type: "image/png" });
    await expect(saveUpload(tenant.id, fake, "logo")).rejects.toThrow(/does not match/);
  });
});
