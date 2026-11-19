import fs from "node:fs";
import path from "node:path";

/**
 * Mail is optional and provider-agnostic.
 *  - SMTP_URL set (e.g. smtps://user:pass@smtp.example.com:465, any free-tier SMTP) -> real email via nodemailer.
 *  - Not set -> the message is appended to the outbox file (default .data/outbox.log) so dev/testing works with no service.
 * No paid provider is required or assumed.
 */
export type Mail = { to: string; subject: string; text: string };
export const outboxFile = () => process.env.OUTBOX_FILE ?? path.join(process.cwd(), ".data", "outbox.log");

export async function sendMail(m: Mail): Promise<"smtp" | "outbox"> {
  const url = process.env.SMTP_URL;
  if (url) {
    const nodemailer = await import("nodemailer");
    await nodemailer.createTransport(url).sendMail({ from: process.env.MAIL_FROM ?? "SalonPro <no-reply@localhost>", to: m.to, subject: m.subject, text: m.text });
    return "smtp";
  }
  const f = outboxFile();
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.appendFileSync(f, `\n=== ${new Date().toISOString()} ===\nTo: ${m.to}\nSubject: ${m.subject}\n\n${m.text}\n`);
  return "outbox";
}

export function appUrl(fallback?: string): string | null {
  const env = process.env.APP_URL?.replace(/\/$/, "");
  if (env) return env;
  // Host-header based links are only acceptable in development (prevents reset-link poisoning in production).
  return process.env.NODE_ENV === "production" ? null : (fallback ?? "http://localhost:3000");
}
