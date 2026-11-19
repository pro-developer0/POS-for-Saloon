import { beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { createDb, type DB } from "@/db/client";
import { authTokens, users } from "@/db/schema";
import { registerOwner, verifyLogin } from "@/server/auth";
import { requestPasswordReset, resetPassword, sendVerification, verifyEmail, sessionStillValid } from "@/server/tokens";

let db: DB; const outbox = path.join(os.tmpdir(), `salonpro-outbox-${Date.now()}.log`);
const lastLink = (re: RegExp) => { const t = fs.readFileSync(outbox, "utf8"); const all = [...t.matchAll(re)]; return all.at(-1)![1]; };
const mails = () => (fs.existsSync(outbox) ? (fs.readFileSync(outbox, "utf8").match(/^To: /gm) ?? []).length : 0);

beforeAll(async () => {
  process.env.OUTBOX_FILE = outbox;
  db = await createDb({ memory: true });
  await registerOwner(db, { name: "Reset Person", email: "reset@test.dev", password: "Old-Password-1", businessName: "Reset Salon" });
});

describe("password reset", () => {
  it("unknown and known emails behave identically from the caller's view; only known gets mail", async () => {
    await requestPasswordReset(db, "nobody@test.dev", "http://x");
    expect(mails()).toBe(0);
    await expect(requestPasswordReset(db, "nobody@test.dev", "http://x")).resolves.toBeUndefined();
    await requestPasswordReset(db, "Reset@Test.dev", "http://x");
    expect(mails()).toBe(1);
  });
  it("stores only a hash, never the raw token", async () => {
    const raw = lastLink(/reset-password\?token=([\w-]+)/g);
    const rows = await db.select().from(authTokens);
    expect(rows.some((r) => r.tokenHash === raw)).toBe(false);
    expect(rows.every((r) => r.tokenHash.length === 64)).toBe(true);
  });
  it("rejects weak passwords without consuming the token", async () => {
    const raw = lastLink(/reset-password\?token=([\w-]+)/g);
    await expect(resetPassword(db, raw, "short")).rejects.toThrow(/10 characters/);
    await expect(resetPassword(db, raw, "onlyletterspassword")).rejects.toThrow(/letters and numbers/);
  });
  it("works once: new password logs in, old one doesn't, link can't be reused", async () => {
    const raw = lastLink(/reset-password\?token=([\w-]+)/g);
    await resetPassword(db, raw, "New-Password-22");
    expect((await verifyLogin(db, "reset@test.dev", "New-Password-22")).email).toBe("reset@test.dev");
    await expect(verifyLogin(db, "reset@test.dev", "Old-Password-1")).rejects.toThrow(/Invalid/);
    await expect(resetPassword(db, raw, "Another-Password-3")).rejects.toThrow(/invalid or has expired/);
  });
  it("a newer request invalidates the previous link", async () => {
    await requestPasswordReset(db, "reset@test.dev", "http://x"); const first = lastLink(/reset-password\?token=([\w-]+)/g);
    await requestPasswordReset(db, "reset@test.dev", "http://x"); const second = lastLink(/reset-password\?token=([\w-]+)/g);
    await expect(resetPassword(db, first, "Third-Password-33")).rejects.toThrow(/invalid or has expired/);
    await resetPassword(db, second, "Third-Password-33");
  });
  it("expired links are refused", async () => {
    await requestPasswordReset(db, "reset@test.dev", "http://x"); const raw = lastLink(/reset-password\?token=([\w-]+)/g);
    await db.update(authTokens).set({ expiresAt: new Date(Date.now() - 1000) });
    await expect(resetPassword(db, raw, "Fourth-Password-44")).rejects.toThrow(/invalid or has expired/);
  });
  it("garbage tokens and tokens of the wrong kind are refused", async () => {
    await expect(resetPassword(db, "nonsense", "Fifth-Password-55")).rejects.toThrow(/invalid or has expired/);
    const [u] = await db.select().from(users).where(eq(users.email, "reset@test.dev"));
    await sendVerification(db, u.id, "http://x"); const verifyTok = lastLink(/verify-email\?token=([\w-]+)/g);
    await expect(resetPassword(db, verifyTok, "Fifth-Password-55")).rejects.toThrow(/invalid or has expired/);
  });
  it("a reset clears an account lockout and invalidates older sessions", async () => {
    for (let i = 0; i < 5; i++) await expect(verifyLogin(db, "reset@test.dev", "bad-password-x")).rejects.toThrow();
    await expect(verifyLogin(db, "reset@test.dev", "Third-Password-33")).rejects.toThrow(/Too many/);
    await requestPasswordReset(db, "reset@test.dev", "http://x");
    await resetPassword(db, lastLink(/reset-password\?token=([\w-]+)/g), "Sixth-Password-66");
    await verifyLogin(db, "reset@test.dev", "Sixth-Password-66");
    const [u] = await db.select().from(users).where(eq(users.email, "reset@test.dev"));
    const issuedBefore = Math.floor(u.tokensValidAfter!.getTime() / 1000) - 60;
    expect(sessionStillValid(issuedBefore, u.tokensValidAfter)).toBe(false);
    expect(sessionStillValid(Math.floor(Date.now() / 1000) + 1, u.tokensValidAfter)).toBe(true);
  });
  it("no link is sent when no safe base URL is available (production without APP_URL)", async () => {
    const before = mails();
    await requestPasswordReset(db, "reset@test.dev", null);
    expect(mails()).toBe(before);
  });
});

describe("email verification", () => {
  it("confirms the email once", async () => {
    const [u] = await db.select().from(users).where(eq(users.email, "reset@test.dev"));
    expect(u.emailVerifiedAt).toBeNull();
    await sendVerification(db, u.id, "http://x");
    const raw = lastLink(/verify-email\?token=([\w-]+)/g);
    await verifyEmail(db, raw);
    expect((await db.select().from(users).where(eq(users.id, u.id)))[0].emailVerifiedAt).not.toBeNull();
    await expect(verifyEmail(db, raw)).rejects.toThrow(/invalid or has expired/);
    const before = mails(); await sendVerification(db, u.id, "http://x"); expect(mails()).toBe(before); // already verified: nothing sent
  });
});
