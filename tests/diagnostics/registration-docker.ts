/** Synthetic native-amd64 CI adapter. No host env, credentials, network, ports or writable binds. */
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import { mkdtemp, writeFile, chmod, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import {
  admissionSchema,
  type RendererAdapters,
} from "../../services/diagnostic-renderer/processing.ts";
import {
  bindRenderedBytes,
  renderInputSchema,
  renderReceiptSchema,
  sha256,
} from "../../services/diagnostic-renderer/sandbox.ts";
import { CAPTURE_VALIDATION_PROGRAM } from "../../services/diagnostic-renderer/revalidate.ts";
import {
  verifyTrustedProvenance,
  trustedProvenance,
} from "../../services/diagnostic-renderer/trusted.ts";
const execute = promisify(execFile);
async function docker(args: string[], maxBuffer = 16384) {
  return (
    await execute("docker", args, {
      timeout: 45000,
      maxBuffer,
      encoding: "buffer",
    })
  ).stdout;
}
async function isolated(raw: unknown, bytes?: Uint8Array) {
  const input = renderInputSchema.parse(raw);
  assert.ok(input.html.includes("SYNTHETIC PDF registration patient"));
  assert.equal(
    (await docker(["info", "--format", "{{.Architecture}}"])).toString().trim(),
    "x86_64",
  );
  const nonce = randomUUID(),
    name = "lrv-registration-" + nonce,
    dir = await mkdtemp(tmpdir() + "/lrv-registration-");
  await chmod(dir, 0o755);
  const files: Array<[string, Uint8Array | string, string]> = bytes
    ? [
        ["captured.pdf", bytes, "/home/lrv-render/work/captured.pdf"],
        [
          "expected.json",
          JSON.stringify(input.expected_texts),
          "/home/lrv-render/work/expected.json",
        ],
      ]
    : [["input.json", JSON.stringify(input), "/home/lrv-render/input.json"]];
  let created = false;
  const owned = async () => {
    const d = JSON.parse((await docker(["inspect", name])).toString())[0];
    assert.equal(d.Config.Labels["com.lrv.registration"], nonce);
    assert.equal(d.HostConfig.NetworkMode, "none");
    assert.equal(d.HostConfig.ReadonlyRootfs, true);
    assert.equal(d.HostConfig.Privileged, false);
    assert.deepEqual(d.HostConfig.CapDrop, ["ALL"]);
    assert.equal(d.Config.User, "12001:12001");
    assert.equal(d.HostConfig.IpcMode, "private");
    assert.ok(
      !d.HostConfig.PortBindings ||
        Object.keys(d.HostConfig.PortBindings).length === 0,
    );
    return d;
  };
  try {
    const mounts: string[] = [];
    for (const [file, content, destination] of files) {
      await writeFile(dir + "/" + file, content, { mode: 0o644 });
      mounts.push(
        "--mount",
        `type=bind,src=${dir}/${file},dst=${destination},readonly`,
      );
    }
    await docker([
      "create",
      "--name",
      name,
      "--label",
      "com.lrv.registration=" + nonce,
      "--platform",
      "linux/amd64",
      "--user",
      "12001:12001",
      "--network",
      "none",
      "--read-only",
      "--cap-drop",
      "ALL",
      "--security-opt",
      "no-new-privileges",
      "--security-opt",
      "seccomp=" + resolve("services/diagnostic-renderer/seccomp-profile.json"),
      "--memory",
      "2g",
      "--cpus",
      "1",
      "--pids-limit",
      "256",
      "--shm-size",
      "256m",
      "--env",
      "XDG_CONFIG_HOME=/home/lrv-render/work/config",
      "--env",
      "XDG_CACHE_HOME=/home/lrv-render/work/cache",
      "--tmpfs",
      "/tmp:rw,nosuid,nodev,noexec,size=256m",
      "--tmpfs",
      "/home/lrv-render/work:rw,nosuid,nodev,noexec,size=64m,uid=12001,gid=12001,mode=700",
      ...mounts,
      "--entrypoint",
      "/usr/bin/sleep",
      "lrv-diagnostic-renderer:20261011",
      "60",
    ]);
    created = true;
    await owned();
    await docker(["start", name]);
    const p = trustedProvenance();
    const hashes = (
      await docker([
        "exec",
        name,
        "sha256sum",
        "/opt/lrv-renderer/worker.mjs",
        "/opt/lrv-renderer/pdf_admission.py",
        "/usr/share/fonts/truetype/noto/NotoSans-Regular.ttf",
      ])
    )
      .toString()
      .trim()
      .split("\n")
      .map((row) => row.split(/\s+/)[0]);
    assert.deepEqual(hashes, [p.worker_sha, p.validator_sha, p.font_sha]);
    if (bytes) {
      const output = await docker([
        "exec",
        name,
        "node",
        "--max-old-space-size=256",
        "-e",
        CAPTURE_VALIDATION_PROGRAM,
      ]);
      const admission = admissionSchema.parse(JSON.parse(output.toString()));
      assert.equal(admission.sha256, sha256(bytes));
      assert.equal(admission.byte_length, bytes.length);
      const recovered = await docker(
        ["exec", name, "cat", "/home/lrv-render/work/captured.pdf"],
        3145728,
      );
      assert.deepEqual(recovered, Buffer.from(bytes));
      return { admission };
    }
    await docker([
      "exec",
      name,
      "node",
      "--max-old-space-size=256",
      "/opt/lrv-renderer/worker.mjs",
      "--proof",
    ]);
    const pdf = await docker(
      ["exec", name, "cat", "/home/lrv-render/work/report.pdf"],
      3145728,
    );
    const receipt = renderReceiptSchema.parse(
      JSON.parse(
        (
          await docker([
            "exec",
            name,
            "cat",
            "/home/lrv-render/work/receipt.json",
          ])
        ).toString(),
      ),
    );
    bindRenderedBytes(input, pdf, receipt);
    return { bytes: pdf, receipt };
  } finally {
    if (created) {
      await owned();
      await docker(["rm", "-f", name]);
      assert.equal(
        (
          await docker([
            "ps",
            "-a",
            "--filter",
            "label=com.lrv.registration=" + nonce,
            "--format",
            "{{.Names}}",
          ])
        ).length,
        0,
      );
    }
    await rm(dir, { recursive: true, force: true });
  }
}
export const dockerAdapters: RendererAdapters = {
  verifyProvenance: verifyTrustedProvenance,
  async generate(input) {
    const result = await isolated(input);
    assert.ok(result.bytes && result.receipt);
    return { bytes: result.bytes, receipt: result.receipt };
  },
  async validate(bytes, input) {
    const result = await isolated(input, bytes);
    assert.ok(result.admission);
    return result.admission;
  },
};
