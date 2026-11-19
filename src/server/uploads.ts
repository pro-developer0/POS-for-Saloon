import "server-only";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { AppError } from "./ctx";

/**
 * Storage abstraction. Default: local disk under ./uploads (served via /api/files/[tenant]/[name], access-checked).
 * Swap this module for S3/R2/Supabase storage in production without touching callers.
 */
const MAX_BYTES = 2 * 1024 * 1024;
const TYPES: Record<string, { ext: string; magic: number[][] }> = {
  "image/png": { ext: "png", magic: [[0x89, 0x50, 0x4e, 0x47]] },
  "image/jpeg": { ext: "jpg", magic: [[0xff, 0xd8, 0xff]] },
  "image/webp": { ext: "webp", magic: [[0x52, 0x49, 0x46, 0x46]] },
  "application/pdf": { ext: "pdf", magic: [[0x25, 0x50, 0x44, 0x46]] },
};
export const uploadRoot = () => path.join(process.cwd(), process.env.UPLOAD_DIR ?? "uploads");

export async function saveUpload(tenantId: string, file: File, kind: "logo" | "favicon" | "receipt"): Promise<string> {
  if (file.size > MAX_BYTES) throw new AppError("File is too large (max 2 MB).");
  const t = TYPES[file.type];
  if (!t || (kind !== "receipt" && file.type === "application/pdf")) throw new AppError("Unsupported file type. Use PNG, JPG or WebP" + (kind === "receipt" ? " or PDF." : "."));
  const buf = Buffer.from(await file.arrayBuffer());
  if (!t.magic.some((m) => m.every((b, i) => buf[i] === b))) throw new AppError("File content does not match its type.");
  const name = `${kind}-${crypto.randomBytes(8).toString("hex")}.${t.ext}`; // server-generated name: no path traversal
  const dir = path.join(uploadRoot(), tenantId);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, name), buf);
  return `/api/files/${tenantId}/${name}`;
}
