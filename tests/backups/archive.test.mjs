import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  backupKey,
  encryptArchive,
  decryptArchive,
} from "../../scripts/backups/archive.mjs";
test("encrypted backups authenticate exact bytes and reject tampering without publishing plaintext", async () => {
  const dir = await mkdtemp(join(tmpdir(), "lrv-backup-test-"));
  try {
    const source = join(dir, "source"),
      encrypted = join(dir, "encrypted"),
      restored = join(dir, "restored");
    const bytes = Buffer.from(
      "Synthetic database and private document fixture".repeat(10000),
    );
    const key = backupKey("12".repeat(32));
    await writeFile(source, bytes);
    await encryptArchive(source, encrypted, key);
    assert.equal(
      (await readFile(encrypted)).includes(bytes.subarray(0, 40)),
      false,
    );
    await decryptArchive(encrypted, restored, key);
    assert.deepEqual(await readFile(restored), bytes);
    const corrupt = await readFile(encrypted);
    corrupt[50] ^= 1;
    await writeFile(join(dir, "corrupt"), corrupt);
    await assert.rejects(
      decryptArchive(join(dir, "corrupt"), join(dir, "partial"), key),
    );
    await assert.rejects(access(join(dir, "partial")));
    await assert.rejects(
      decryptArchive(
        encrypted,
        join(dir, "wrong-key"),
        backupKey("34".repeat(32)),
      ),
    );
    await assert.rejects(decryptArchive(encrypted, restored, key));
    assert.deepEqual(await readFile(restored), bytes);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
