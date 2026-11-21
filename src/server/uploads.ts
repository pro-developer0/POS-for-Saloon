import "server-only";
import { db } from "@/db/client";
import { files } from "@/db/schema";
import crypto from "node:crypto";
import { AppError } from "./ctx";

/**
 * Storage: files are kept in the database (table "files") and served via /api/files/[tenant]/[name] (access-checked).
 * No writable disk is needed, so it works on Vercel and similar hosts.
 */
const MAX_BYTES = 2 * 1024 * 1024;
const TYPES: Record<string, { ext: string; magic: number[][] }> = {
  "image/png": { ext: "png", magic: [[0x89, 0x50, 0x4e, 0x47]] },
  "image/jpeg": { ext: "jpg", magic: [[0xff, 0xd8, 0xff]] },
  "image/webp": { ext: "webp", magic: [[0x52, 0x49, 0x46, 0x46]] },
  "application/pdf": { ext: "pdf", magic: [[0x25, 0x50, 0x44, 0x46]] },
};
export const MIME_BY_EXT: Record<string, string> = { png: "image/png", jpg: "image/jpeg", webp: "image/webp", pdf: "application/pdf" };

export async function saveUpload(tenantId: string, file: File, kind: "logo" | "favicon" | "receipt"): Promise<string> {
  if (file.size > MAX_BYTES) throw new AppError("File is too large (max 2 MB).");
  const t = TYPES[file.type];
  if (!t || (kind !== "receipt" && file.type === "application/pdf")) throw new AppError("Unsupported file type. Use PNG, JPG or WebP" + (kind === "receipt" ? " or PDF." : "."));
  const buf = Buffer.from(await file.arrayBuffer());
  if (!t.magic.some((m) => m.every((b, i) => buf[i] === b))) throw new AppError("File content does not match its type.");
  const name = `${kind}-${crypto.randomBytes(8).toString("hex")}.${t.ext}`; // server-generated name: no path traversal
  await (await db()).insert(files).values({ tenantId, name, mime: file.type, data: buf });
  return `/api/files/${tenantId}/${name}`;
}
