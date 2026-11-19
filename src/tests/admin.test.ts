import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createDb, type DB } from "@/db/client";
import { auditLogs, memberships, tenants, users } from "@/db/schema";
import { seedDemo, DEMO_USERS } from "@/server/seed";
import { verifyLogin } from "@/server/auth";
import { changeOwnPassword, createBusinessWithOwner, listUsersForAdmin, resetUserPassword, setUserDisabled, temporaryPassword } from "@/server/admin";
import { passwordSchema } from "@/server/auth";
import { sessionStillValid } from "@/server/tokens";

let db: DB; let adminId: string;
const byEmail = async (e: string) => (await db.select().from(users).where(eq(users.email, e)))[0];
const base = { businessName: "Noor Pharmacy", businessType: "pharmacy", ownerName: "Noor Owner", ownerEmail: "noor@client.test" };

beforeAll(async () => {
  db = await createDb({ memory: true });
  await seedDemo(db);
  adminId = (await byEmail(DEMO_USERS.admin)).id;
});

describe("temporary passwords", () => {
  it("are strong, readable, unique and satisfy the password rules", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 300; i++) { const p = temporaryPassword(); expect(passwordSchema.safeParse(p).success).toBe(true); expect(p).toMatch(/^[A-Za-z2-9]{4}-[A-Za-z2-9]{4}-[A-Za-z2-9]{4}7$/); seen.add(p); }
    expect(seen.size).toBe(300);
  });
});

describe("create a client business + owner", () => {
  it("creates an active, not-yet-onboarded business with an owner who must change a generated password", async () => {
    const r = await createBusinessWithOwner(db, adminId, base);
    expect(r.tempPassword).toBeTruthy();
    const [t] = await db.select().from(tenants).where(eq(tenants.id, r.tenantId));
    expect(t.status).toBe("active"); expect(t.onboarded).toBe(false); expect(t.businessType).toBe("pharmacy"); expect(t.currency).toBe("PKR"); expect(t.timezone).toBe("Asia/Karachi");
    const u = await byEmail("noor@client.test");
    expect(u.mustChangePassword).toBe(true); expect(u.emailVerifiedAt).not.toBeNull();
    expect(u.passwordHash).not.toContain(r.tempPassword!); // never stored in plain text
    const [m] = await db.select().from(memberships).where(eq(memberships.userId, u.id));
    expect(m.role).toBe("owner"); expect(m.tenantId).toBe(r.tenantId);
    expect((await verifyLogin(db, "noor@client.test", r.tempPassword!)).id).toBe(u.id);
    const log = await db.select().from(auditLogs).where(eq(auditLogs.action, "admin.business.create"));
    expect(log.some((l) => l.tenantId === r.tenantId && l.userId === adminId)).toBe(true);
  });
  it("accepts a typed temporary password (validated) and rejects weak ones", async () => {
    await expect(createBusinessWithOwner(db, adminId, { ...base, ownerEmail: "weak@client.test", password: "short" })).rejects.toThrow(/10 characters/);
    const r = await createBusinessWithOwner(db, adminId, { ...base, businessName: "Typed Pw", ownerEmail: "typed@client.test", password: "Typed-Password-1" });
    expect(r.tempPassword).toBe("Typed-Password-1");
    expect((await byEmail("typed@client.test")).mustChangePassword).toBe(true);
  });
  it("an existing user becomes owner of the new business without touching their password", async () => {
    const before = (await byEmail(DEMO_USERS.royal)).passwordHash;
    const r = await createBusinessWithOwner(db, adminId, { ...base, businessName: "Second Shop", businessType: "retail", ownerEmail: DEMO_USERS.royal });
    expect(r.existingUser).toBe(true); expect(r.tempPassword).toBeNull();
    const after = await byEmail(DEMO_USERS.royal);
    expect(after.passwordHash).toBe(before); expect(after.mustChangePassword).toBe(false);
    const ms = await db.select().from(memberships).where(eq(memberships.userId, after.id));
    expect(ms.filter((m) => m.role === "owner").length).toBeGreaterThanOrEqual(2);
  });
  it("rejects unknown business types, bad emails and disabled existing accounts", async () => {
    await expect(createBusinessWithOwner(db, adminId, { ...base, businessType: "spaceship", ownerEmail: "a@client.test" })).rejects.toThrow(/business type/i);
    await expect(createBusinessWithOwner(db, adminId, { ...base, ownerEmail: "not-an-email" })).rejects.toThrow();
    const u = await byEmail("typed@client.test");
    await setUserDisabled(db, adminId, u.id, true);
    await expect(createBusinessWithOwner(db, adminId, { ...base, businessName: "Blocked", ownerEmail: "typed@client.test" })).rejects.toThrow(/disabled/);
    await setUserDisabled(db, adminId, u.id, false);
  });
  it("a failed creation leaves nothing behind", async () => {
    const before = (await db.select().from(tenants)).length;
    await expect(createBusinessWithOwner(db, adminId, { ...base, businessName: "X", ownerEmail: "ghost@client.test" })).rejects.toThrow(); // name too short
    expect((await db.select().from(tenants)).length).toBe(before);
    expect(await byEmail("ghost@client.test")).toBeUndefined();
  });
});

describe("reset and disable", () => {
  it("reset issues a new temporary password, forces a change, clears lockout and ends old sessions", async () => {
    const u = await byEmail("noor@client.test");
    for (let i = 0; i < 5; i++) await expect(verifyLogin(db, "noor@client.test", "wrong-password-1")).rejects.toThrow();
    await expect(verifyLogin(db, "noor@client.test", "anything-1234")).rejects.toThrow(/Too many/);
    const r = await resetUserPassword(db, adminId, u.id);
    expect((await verifyLogin(db, "noor@client.test", r.tempPassword)).id).toBe(u.id); // lockout cleared
    const after = await byEmail("noor@client.test");
    expect(after.mustChangePassword).toBe(true);
    expect(sessionStillValid(Math.floor(Date.now() / 1000) - 120, after.tokensValidAfter)).toBe(false);
  });
  it("cannot reset another platform admin or an unknown user", async () => {
    const other = (await db.insert(users).values({ email: "admin2@salonpro.local", name: "Admin Two", passwordHash: "x", isPlatformAdmin: true }).returning())[0];
    await expect(resetUserPassword(db, adminId, other.id)).rejects.toThrow(/own password/);
    await expect(resetUserPassword(db, adminId, "00000000-0000-0000-0000-000000000000")).rejects.toThrow(/not found/i);
  });
  it("disabling blocks login and ends sessions; enabling restores access; self and admins are protected", async () => {
    const u = await byEmail(DEMO_USERS.glow);
    await setUserDisabled(db, adminId, u.id, true);
    await expect(verifyLogin(db, DEMO_USERS.glow, "Demo-Pass-123")).rejects.toThrow(/disabled/);
    expect(sessionStillValid(Math.floor(Date.now() / 1000) - 60, (await byEmail(DEMO_USERS.glow)).tokensValidAfter)).toBe(false);
    await setUserDisabled(db, adminId, u.id, false);
    await expect(verifyLogin(db, DEMO_USERS.glow, "Demo-Pass-123")).resolves.toBeTruthy();
    await expect(setUserDisabled(db, adminId, adminId, true)).rejects.toThrow(/own account/);
    const other = await byEmail("admin2@salonpro.local");
    await expect(setUserDisabled(db, adminId, other.id, true)).rejects.toThrow(/cannot be disabled/);
  });
});

describe("changing your own password", () => {
  it("needs the current password, enforces the rules, and clears the forced-change flag", async () => {
    const u = await byEmail("noor@client.test");
    const temp = (await resetUserPassword(db, adminId, u.id)).tempPassword;
    await expect(changeOwnPassword(db, u.id, "wrong-current-1", "Brand-New-Pass-1")).rejects.toThrow(/incorrect/);
    await expect(changeOwnPassword(db, u.id, temp, "short")).rejects.toThrow(/10 characters/);
    await expect(changeOwnPassword(db, u.id, temp, temp)).rejects.toThrow(/different/);
    await changeOwnPassword(db, u.id, temp, "Brand-New-Pass-1");
    const after = await byEmail("noor@client.test");
    expect(after.mustChangePassword).toBe(false);
    await expect(verifyLogin(db, "noor@client.test", temp)).rejects.toThrow(/Invalid/);
    await expect(verifyLogin(db, "noor@client.test", "Brand-New-Pass-1")).resolves.toBeTruthy();
  });
});

describe("user list for the platform admin", () => {
  it("shows businesses and roles per user and supports search", async () => {
    const all = await listUsersForAdmin(db);
    const royal = all.find((x) => x.email === DEMO_USERS.royal)!;
    expect(royal.biz).toContain("Royal Hair Studio (owner)");
    expect(royal.biz).toContain("Second Shop (owner)");
    const found = await listUsersForAdmin(db, "noor@client");
    expect(found.map((x) => x.email)).toEqual(["noor@client.test"]);
    expect(all.some((x) => x.is_admin)).toBe(true);
  });
});
