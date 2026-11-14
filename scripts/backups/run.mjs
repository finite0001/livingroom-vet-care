#!/usr/bin/env node
import { z } from "zod";
import { spawn } from "node:child_process";
import { createWriteStream, constants } from "node:fs";
import {
  chmod,
  mkdtemp,
  mkdir,
  writeFile,
  stat,
  rm,
  copyFile,
  rename,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { randomUUID, createHash } from "node:crypto";
import { backupKey, encryptArchive, hashFile } from "./archive.mjs";
const configuration = z.object({
  LRV_PROJECT_REF: z.literal("mgadheotkdnrsatfivjy"),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),
  DATABASE_URL: z.url(),
  LRV_BACKUP_KEY_HEX: z.string().regex(/^[a-fA-F0-9]{64}$/),
  LRV_BACKUP_NAS_ROOT: z.string().startsWith("/"),
  LRV_BACKUP_NAS_MODE: z.enum(["mounted", "synology-drive"]),
  LRV_BACKUP_DRIVE_FOLDER: z.string().regex(/^[a-zA-Z0-9_-]+$/),
  LRV_BACKUP_DRIVE_ACCOUNT: z.literal("finite01@gmail.com"),
});
const c = configuration.safeParse(process.env);
if (!c.success) {
  console.error("Backup configuration is incomplete. No export was started.");
  process.exitCode = 1;
} else {
  const env = c.data,
    id = randomUUID(),
    started = new Date().toISOString();
  const base = `https://${env.LRV_PROJECT_REF}.supabase.co`;
  const auth = {
    Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
  };
  let directory;
  let count = 0;
  let bytes = 0;
  let digest = null;
  let phase = "BACKUP_FAILED";
  async function execute(command, args, extraEnv = {}) {
    return new Promise((resolve, reject) => {
      const child = spawn(command, args, {
        env: { ...process.env, ...extraEnv },
        stdio: ["ignore", "pipe", "pipe"],
        shell: false,
      });
      let output = "";
      let size = 0;
      child.stdout.on("data", (chunk) => {
        size += chunk.length;
        if (size < 1000000) output += chunk;
      });
      child.stderr.resume();
      child.on("error", () =>
        reject(Error("Required backup tool is unavailable")),
      );
      child.on("exit", (code) =>
        code === 0 ? resolve(output) : reject(Error("Backup tool failed")),
      );
    });
  }
  async function request(path, options = {}) {
    const response = await fetch(base + path, {
      ...options,
      headers: {
        ...auth,
        "Content-Type": "application/json",
        ...options.headers,
      },
      signal: AbortSignal.timeout(120000),
    });
    if (!response.ok) throw Error("Backup API request failed");
    return response;
  }
  const bucketSchema = z.array(z.object({ id: z.string().min(1) }));
  const listSchema = z.array(
    z.object({
      name: z.string(),
      id: z.string().nullable(),
      updated_at: z.string().nullable().optional(),
      metadata: z.record(z.string(), z.unknown()).nullable().optional(),
    }),
  );
  async function inventory() {
    const buckets = bucketSchema.parse(
      await (await request("/storage/v1/bucket")).json(),
    );
    const result = [];
    for (const bucket of buckets) {
      const folders = [""];
      const visited = new Set();
      while (folders.length) {
        const prefix = folders.shift();
        if (visited.has(prefix)) throw Error("Storage folder cycle");
        visited.add(prefix);
        if (visited.size > 100000) throw Error("Storage inventory too large");
        for (let offset = 0; ; offset += 1000) {
          const items = listSchema.parse(
            await (
              await request(
                `/storage/v1/object/list/${encodeURIComponent(bucket.id)}`,
                {
                  method: "POST",
                  body: JSON.stringify({
                    prefix,
                    limit: 1000,
                    offset,
                    sortBy: { column: "name", order: "asc" },
                  }),
                },
              )
            ).json(),
          );
          for (const item of items) {
            const path = prefix ? prefix + "/" + item.name : item.name;
            if (item.id === null) folders.push(path);
            else
              result.push({
                bucket: bucket.id,
                path,
                id: item.id,
                updated_at: item.updated_at ?? null,
                metadata: item.metadata ?? null,
              });
          }
          if (items.length < 1000) break;
        }
      }
    }
    return result.sort((a, b) =>
      (a.bucket + "/" + a.path).localeCompare(b.bucket + "/" + b.path),
    );
  }
  async function receipt(status, failure) {
    await request("/rest/v1/rpc/record_staff_backup", {
      method: "POST",
      body: JSON.stringify({
        p_id: id,
        p_started_at: started,
        p_status: status,
        p_object_count: count,
        p_bytes: bytes,
        p_sha256: digest,
        p_failure: failure,
      }),
    });
  }
  try {
    directory = await mkdtemp(join(tmpdir(), "lrv-encrypted-backup-"));
    await chmod(directory, 0o700);
    await mkdir(join(directory, "objects"), { mode: 0o700 });
    const nasRoot = await stat(env.LRV_BACKUP_NAS_ROOT);
    if (!nasRoot.isDirectory())
      throw Error("Configured NAS root is unavailable");
    if (env.LRV_BACKUP_NAS_MODE === "synology-drive")
      await stat(join(env.LRV_BACKUP_NAS_ROOT, ".SynologyWorkingDirectory"));
    else {
      const parent = await stat(join(env.LRV_BACKUP_NAS_ROOT, ".."));
      if (parent.dev === nasRoot.dev) throw Error("NAS mount is not present");
    }
    const before = await inventory();
    const database = new URL(env.DATABASE_URL);
    if (
      !["postgres:", "postgresql:"].includes(database.protocol) ||
      !database.password
    )
      throw Error("A protected database connection is required");
    const primary = env.LRV_PROJECT_REF;
    const direct = database.hostname === `db.${primary}.supabase.co`;
    const pooled =
      database.hostname.endsWith(".pooler.supabase.com") &&
      decodeURIComponent(database.username).endsWith("." + primary);
    if (!direct && !pooled)
      throw Error(
        "Database connection does not identify the Living Room Vet primary project",
      );
    // Password is provided in the child environment, never the process argument list.
    await execute(
      "pg_dump",
      [
        "--format=custom",
        "--no-owner",
        "--file",
        join(directory, "database.dump"),
        "--host",
        database.hostname,
        "--port",
        database.port || "5432",
        "--username",
        decodeURIComponent(database.username),
        "--dbname",
        database.pathname.slice(1),
      ],
      {
        PGPASSWORD: decodeURIComponent(database.password),
        PGSSLMODE: "require",
      },
    );
    const objects = [];
    for (const object of before) {
      const safeName = createHash("sha256")
        .update(object.bucket + "\0" + object.path)
        .digest("hex");
      const destination = join(directory, "objects", safeName);
      const route = `/storage/v1/object/authenticated/${encodeURIComponent(object.bucket)}/${object.path.split("/").map(encodeURIComponent).join("/")}`;
      const response = await request(route);
      if (!response.body) throw Error("Storage file body missing");
      await pipeline(
        Readable.fromWeb(response.body),
        createWriteStream(destination, { flags: "wx", mode: 0o600 }),
      );
      objects.push({
        ...object,
        archive_name: safeName,
        sha256: await hashFile(destination),
        bytes: (await stat(destination)).size,
      });
    }
    const after = await inventory();
    if (JSON.stringify(before) !== JSON.stringify(after))
      throw Error("Storage changed during backup; retry in the next run");
    count = objects.length;
    await writeFile(
      join(directory, "manifest.json"),
      JSON.stringify(
        {
          version: 1,
          project: env.LRV_PROJECT_REF,
          started_at: started,
          database_sha256: await hashFile(join(directory, "database.dump")),
          objects,
        },
        null,
        2,
      ),
      { mode: 0o600 },
    );
    await execute("tar", [
      "-czf",
      join(directory, "backup.tar.gz"),
      "-C",
      directory,
      "database.dump",
      "objects",
      "manifest.json",
    ]);
    const encrypted = join(directory, "backup.lrv");
    await encryptArchive(
      join(directory, "backup.tar.gz"),
      encrypted,
      backupKey(env.LRV_BACKUP_KEY_HEX),
    );
    bytes = (await stat(encrypted)).size;
    digest = await hashFile(encrypted);
    phase = "UPLOAD_FAILED";
    const filename = `livingroom-${started.slice(0, 10)}-${id}.lrv`;
    const destination = join(env.LRV_BACKUP_NAS_ROOT, "LivingRoomVetBackups");
    await mkdir(destination, { recursive: true, mode: 0o700 });
    const nasPending = join(destination, filename + ".pending");
    const nasFile = join(destination, filename);
    await copyFile(encrypted, nasPending, constants.COPYFILE_EXCL);
    if ((await hashFile(nasPending)) !== digest)
      throw Error("NAS copy verification failed");
    try {
      await stat(nasFile);
      throw Error("Existing backup must not be overwritten");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    await rename(nasPending, nasFile);
    const driveArgs = [
      "-a",
      env.LRV_BACKUP_DRIVE_ACCOUNT,
      "--json",
      "--results-only",
      "--no-input",
      "drive",
    ];
    const uploaded = JSON.parse(
      await execute("gog", [
        ...driveArgs,
        "upload",
        encrypted,
        "--parent",
        env.LRV_BACKUP_DRIVE_FOLDER,
        "--name",
        filename,
        "--mime-type",
        "application/octet-stream",
      ]),
    );
    const uploadedFile = uploaded.file ?? uploaded;
    const cloudId = z
      .string()
      .regex(/^[a-zA-Z0-9_-]+$/)
      .parse(uploadedFile.id);
    const metadata = JSON.parse(
      await execute("gog", [...driveArgs, "get", cloudId]),
    );
    const cloudFile = metadata.file ?? metadata;
    if (Number(cloudFile.size) !== bytes)
      throw Error("Google Drive upload size could not be verified");
    const downloaded = join(directory, "drive-verification.lrv");
    await execute("gog", [
      ...driveArgs,
      "download",
      cloudId,
      "--out",
      downloaded,
    ]);
    if ((await hashFile(downloaded)) !== digest)
      throw Error("Google Drive round-trip checksum could not be verified");
    const status =
      env.LRV_BACKUP_NAS_MODE === "synology-drive"
        ? "NAS_PENDING"
        : "SUCCEEDED";
    await receipt(status, null);
    console.log(
      JSON.stringify({
        status,
        google_drive_verified: true,
        nas_copy_verified: true,
        remote_nas_sync_verified: status === "SUCCEEDED",
        objects: count,
        encrypted_bytes: bytes,
        sha256: digest,
      }),
    );
  } catch {
    await receipt("FAILED", phase).catch(() => {});
    console.error(
      "Encrypted backup failed. Check configured tools, database access, destination and job history.",
    );
    process.exitCode = 1;
  } finally {
    if (directory) await rm(directory, { recursive: true, force: true });
  }
}
