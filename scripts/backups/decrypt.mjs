#!/usr/bin/env node
import { backupKey, decryptArchive } from "./archive.mjs";
const [source, destination] = process.argv.slice(2);
if (!source || !destination) {
  console.error(
    "Usage: node scripts/backups/decrypt.mjs encrypted.lrv new-private-archive.tar.gz",
  );
  process.exitCode = 1;
} else {
  try {
    await decryptArchive(
      source,
      destination,
      backupKey(process.env.LRV_BACKUP_KEY_HEX),
    );
    console.log(
      "Archive authenticated and decrypted. Follow the isolated restore runbook.",
    );
  } catch {
    console.error(
      "Decryption failed; no partial plaintext archive was retained.",
    );
    process.exitCode = 1;
  }
}
