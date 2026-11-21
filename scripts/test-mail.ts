/**
 * Sends one real test email using your SMTP_URL, so you know email works before deploying.
 *   SMTP_URL=... MAIL_FROM=... MAIL_TO=you@example.com npm run mail:test
 */
import nodemailer from "nodemailer";

async function main() {
  const url = process.env.SMTP_URL, to = process.env.MAIL_TO;
  if (!url || !to) throw new Error("Set SMTP_URL and MAIL_TO (and MAIL_FROM).");
  const t = nodemailer.createTransport(url);
  await t.verify();
  const info = await t.sendMail({ from: process.env.MAIL_FROM ?? to, to, subject: "SalonPro email test", text: "If you can read this, email is set up correctly." });
  console.log("Sent. Message id:", info.messageId);
}
main().catch((e) => { console.error("FAILED:", e instanceof Error ? e.message : e); process.exit(1); });
