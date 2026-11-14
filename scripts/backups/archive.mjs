import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  randomUUID,
} from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { open, stat, unlink, link } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
const MAGIC = Buffer.from("LRV-BACKUP-V1\n");
export function backupKey(hex) {
  if (!/^[a-fA-F0-9]{64}$/.test(hex ?? ""))
    throw Error("A 32-byte backup encryption key is required");
  return Buffer.from(hex, "hex");
}
export async function hashFile(path) {
  const hash = createHash("sha256");
  for await (const bytes of createReadStream(path)) hash.update(bytes);
  return hash.digest("hex");
}
export async function encryptArchive(source, destination, key) {
  const iv = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(MAGIC);
  const output = await open(destination, "wx", 0o600);
  try {
    await output.write(Buffer.concat([MAGIC, iv]));
    await pipeline(
      createReadStream(source),
      cipher,
      createWriteStream(destination, { flags: "a", mode: 0o600 }),
    );
    await output.write(
      cipher.getAuthTag(),
      0,
      16,
      (await stat(destination)).size,
    );
  } finally {
    await output.close();
  }
}
/** Publishes plaintext only after GCM authentication succeeds. Never restore a partial decryption. */
export async function decryptArchive(source, destination, key) {
  const input = await open(source, "r");
  const length = (await input.stat()).size;
  const header = Buffer.alloc(MAGIC.length + 12);
  const tag = Buffer.alloc(16);
  if (length <= MAGIC.length + 28) {
    await input.close();
    throw Error("Invalid encrypted archive");
  }
  await input.read(header, 0, header.length, 0);
  await input.read(tag, 0, 16, length - 16);
  await input.close();
  if (!header.subarray(0, MAGIC.length).equals(MAGIC))
    throw Error("Unknown backup format");
  const decipher = createDecipheriv(
    "aes-256-gcm",
    key,
    header.subarray(MAGIC.length),
  );
  decipher.setAAD(MAGIC);
  decipher.setAuthTag(tag);
  const temporary = destination + ".partial-" + randomUUID();
  try {
    await pipeline(
      createReadStream(source, { start: header.length, end: length - 17 }),
      decipher,
      createWriteStream(temporary, { flags: "wx", mode: 0o600 }),
    );
    await link(temporary, destination); // Atomic no-clobber publication after authentication.
  } finally {
    await unlink(temporary).catch(() => {});
  }
}
