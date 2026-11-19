import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { and, eq, gt, isNull } from "drizzle-orm";
import type { DB } from "@/db/client";
import { authTokens, users } from "@/db/schema";
import { AppError } from "./ctx";
import { passwordSchema } from "./auth";
import { sendMail } from "./mail";

const sha = (s: string) => crypto.createHash("sha256").update(s).digest("hex");
const TTL = { reset: 60 * 60_000, verify: 24 * 3600_000 } as const;
type Kind = keyof typeof TTL;

export async function createToken(db: DB, userId: string, kind: Kind) {
  // only one live token of each kind per user
  await db.update(authTokens).set({ usedAt: new Date() }).where(and(eq(authTokens.userId, userId), eq(authTokens.kind, kind), isNull(authTokens.usedAt)));
  const raw = crypto.randomBytes(32).toString("base64url");
  await db.insert(authTokens).values({ userId, kind, tokenHash: sha(raw), expiresAt: new Date(Date.now() + TTL[kind]) });
  return raw;
}

/** Atomically marks a valid, unused, unexpired token as used. Returns the user id or throws a generic error. */
export async function consumeToken(db: DB, raw: string, kind: Kind): Promise<string> {
  if (!raw || raw.length > 200) throw new AppError("This link is invalid or has expired.");
  const [t] = await db.update(authTokens).set({ usedAt: new Date() })
    .where(and(eq(authTokens.tokenHash, sha(raw)), eq(authTokens.kind, kind), isNull(authTokens.usedAt), gt(authTokens.expiresAt, new Date()))).returning();
  if (!t) throw new AppError("This link is invalid or has expired. Please request a new one.");
  return t.userId;
}

/** Always behaves the same for known and unknown emails (no account enumeration). */
export async function requestPasswordReset(db: DB, emailRaw: string, baseUrl: string | null) {
  const email = emailRaw.trim().toLowerCase();
  const [u] = await db.select().from(users).where(eq(users.email, email));
  if (!u || u.disabled || !baseUrl) return;
  const raw = await createToken(db, u.id, "reset");
  await sendMail({ to: u.email, subject: "Reset your SalonPro password", text: `Hi ${u.name},\n\nUse this link to choose a new password (valid for 1 hour, one use):\n${baseUrl}/reset-password?token=${raw}\n\nIf you didn't ask for this, you can ignore this email — your password won't change.` });
}

export async function resetPassword(db: DB, raw: string, password: string) {
  const parsed = passwordSchema.safeParse(password);
  if (!parsed.success) throw new AppError(parsed.error.issues[0].message);
  const userId = await consumeToken(db, raw, "reset");
  const passwordHash = await bcrypt.hash(parsed.data, 11);
  await db.update(users).set({ passwordHash, failedLogins: 0, lockedUntil: null, tokensValidAfter: new Date() }).where(eq(users.id, userId));
  return userId;
}

export async function sendVerification(db: DB, userId: string, baseUrl: string | null) {
  const [u] = await db.select().from(users).where(eq(users.id, userId));
  if (!u || u.emailVerifiedAt || !baseUrl) return;
  const raw = await createToken(db, u.id, "verify");
  await sendMail({ to: u.email, subject: "Confirm your SalonPro email", text: `Hi ${u.name},\n\nConfirm your email address:\n${baseUrl}/verify-email?token=${raw}\n\nThis link is valid for 24 hours.` });
}

export async function verifyEmail(db: DB, raw: string) {
  const userId = await consumeToken(db, raw, "verify");
  await db.update(users).set({ emailVerifiedAt: new Date() }).where(eq(users.id, userId));
  return userId;
}

/** Session is valid only if issued after the last password reset. */
export const sessionStillValid = (iatSeconds: number | undefined, tokensValidAfter: Date | null) =>
  !tokensValidAfter || (iatSeconds ?? 0) >= Math.floor(tokensValidAfter.getTime() / 1000);
