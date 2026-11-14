#!/usr/bin/env node
import { readFile, stat } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
const path = join(
  homedir(),
  "Library/Application Support/LivingRoomVetBackups/config.json",
);
const configSchema = z
  .object({
    nas_root: z.string().startsWith("/"),
    nas_mode: z.enum(["mounted", "synology-drive"]),
    drive_folder: z.string().regex(/^[a-zA-Z0-9_-]+$/),
  })
  .strict();
try {
  const metadata = await stat(path);
  if ((metadata.mode & 0o077) !== 0)
    throw Error("Private backup configuration permissions required");
  const config = configSchema.parse(JSON.parse(await readFile(path, "utf8")));
  const keychain = (name) =>
    execFileSync(
      "/usr/bin/security",
      ["find-generic-password", "-s", name, "-w"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    ).trim();
  process.env.LRV_PROJECT_REF = "mgadheotkdnrsatfivjy";
  process.env.DATABASE_URL = keychain("lrv-backup-database-url");
  process.env.SUPABASE_SERVICE_ROLE_KEY = keychain("lrv-backup-service-role");
  process.env.LRV_BACKUP_KEY_HEX = keychain("lrv-backup-encryption-key");
  process.env.LRV_BACKUP_NAS_ROOT = config.nas_root;
  process.env.LRV_BACKUP_NAS_MODE = config.nas_mode;
  process.env.LRV_BACKUP_DRIVE_ACCOUNT = "finite01@gmail.com";
  process.env.LRV_BACKUP_DRIVE_FOLDER = config.drive_folder;
  await import("./run.mjs");
} catch {
  console.error(
    "Local backup needs private configuration and its three Keychain credentials. No secret values were logged.",
  );
  process.exitCode = 1;
}
