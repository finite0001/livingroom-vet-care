#!/usr/bin/env node
import { mkdir, writeFile, stat } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { z } from "zod";
const args = process.argv.slice(2);
const schema = z.object({
  nas_root: z.string().startsWith("/"),
  nas_mode: z.enum(["mounted", "synology-drive"]),
  drive_folder: z.string().regex(/^[a-zA-Z0-9_-]+$/),
});
if (args.length !== 3)
  throw Error(
    "Usage: node scripts/backups/install-local.mjs NAS_ROOT NAS_MODE DRIVE_FOLDER_ID",
  );
const config = schema.parse({
  nas_root: args[0],
  nas_mode: args[1],
  drive_folder: args[2],
});
await stat(config.nas_root);
const directory = join(
  homedir(),
  "Library/Application Support/LivingRoomVetBackups",
);
await mkdir(directory, { recursive: true, mode: 0o700 });
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const runner = join(directory, "runner.mjs");
// Refuse replacing an installed runner/config. Upgrades require a separate reviewed installation.
for (const path of [runner, join(directory, "config.json")]) {
  try {
    await stat(path);
    throw Error(
      "Backup installation already exists; preserve its configuration",
    );
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
}
execFileSync(
  join(root, "node_modules/.bin/esbuild"),
  [
    join(root, "scripts/backups/run-local.mjs"),
    "--bundle",
    "--platform=node",
    "--format=esm",
    "--outfile=" + runner,
  ],
  { stdio: ["ignore", "ignore", "ignore"] },
);
await writeFile(
  join(directory, "config.json"),
  JSON.stringify(config, null, 2) + "\n",
  { flag: "wx", mode: 0o600 },
);
const xml = (v) =>
  v
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
const plist = `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>Label</key><string>vet.livingroom.encrypted-backup</string><key>ProgramArguments</key><array><string>${xml(process.execPath)}</string><string>${xml(runner)}</string></array><key>StartCalendarInterval</key><dict><key>Hour</key><integer>1</integer><key>Minute</key><integer>41</integer></dict><key>EnvironmentVariables</key><dict><key>PATH</key><string>${xml(dirname(process.execPath))}:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string></dict><key>StandardOutPath</key><string>${xml(join(directory, "backup.log"))}</string><key>StandardErrorPath</key><string>${xml(join(directory, "backup-error.log"))}</string><key>ProcessType</key><string>Background</string></dict></plist>`;
const agents = join(homedir(), "Library/LaunchAgents");
await mkdir(agents, { recursive: true });
await writeFile(join(agents, "vet.livingroom.encrypted-backup.plist"), plist, {
  flag: "wx",
  mode: 0o600,
});
console.log(
  "Installed a self-contained backup runner and inactive schedule. Configure Keychain credentials, then validate a manual run before launchctl activation.",
);
