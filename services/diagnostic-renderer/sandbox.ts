import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { Sandbox } from "@vercel/sandbox";
import { z } from "zod";
const hash = z.string().regex(/^[a-f0-9]{64}$/);
export const renderInputSchema = z
  .object({
    version: z.literal(1),
    job_id: z.string().uuid(),
    source_hash: hash,
    snapshot_hash: hash,
    html_sha256: hash,
    html_bytes: z.number().int().positive().max(524288),
    html: z.string().max(524288),
    expected_texts: z.array(z.string().min(1).max(4000)).min(1).max(500),
  })
  .strict()
  .superRefine((v, c) => {
    if (
      Buffer.byteLength(v.html) !== v.html_bytes ||
      sha256(v.html) !== v.html_sha256
    )
      c.addIssue({
        code: "custom",
        message: "Exact frozen HTML identity required",
      });
    if (Buffer.byteLength(JSON.stringify(v)) > 1048576)
      c.addIssue({
        code: "custom",
        message: "Frozen runtime input capacity exceeded",
      });
  });
const validationSchema = z
  .object({
    sha256: hash,
    byte_length: z.number().int().positive().max(3145728),
    page_count: z.number().int().min(1).max(40),
    object_count: z.number().int().min(1).max(5000),
    stream_count: z.number().int().nonnegative().max(5000),
    inflated_bytes: z.number().int().nonnegative().max(16777216),
    admission: z.literal("chromium-classic-pdf1.4-v1"),
    qpdf_clean: z.literal(true),
  })
  .strict();
export const renderReceiptSchema = z
  .object({
    version: z.literal(1),
    job_id: z.string().uuid(),
    source_hash: hash,
    snapshot_hash: hash,
    html_sha256: hash,
    validation: validationSchema,
    node: z.string().max(100),
    chromium: z.string().max(100),
    browser_sandbox: z
      .string()
      .max(4000)
      .refine(
        (v) =>
          /Seccomp-BPF sandbox\s+Yes/i.test(v) &&
          /PID namespaces\s+Yes/i.test(v),
        "Effective Chromium sandbox required",
      ),
    uid: z.literal(12001),
    credentials_absent: z.literal(true),
    sudo_denied: z.literal(true),
    network: z
      .object({
        dns_denied: z.literal(true),
        tcp_denied: z.literal(true),
        metadata_denied: z.literal(true),
      })
      .strict()
      .nullable(),
    semantic_text_checks: z.number().int().min(1).max(500),
  })
  .strict();
export interface RenderInput extends z.infer<typeof renderInputSchema> {}
export interface RenderReceipt extends z.infer<typeof renderReceiptSchema> {}
export function sha256(bytes: string | Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}
export async function readBounded(
  stream: NodeJS.ReadableStream | null,
  limit: number,
): Promise<Buffer> {
  if (!stream) throw new Error("Renderer output missing");
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of stream) {
    if (!(chunk instanceof Uint8Array))
      throw new Error("Binary runtime output required");
    total += chunk.byteLength;
    if (total > limit) {
      (
        stream as NodeJS.ReadableStream & { destroy?: () => unknown }
      ).destroy?.();
      throw new Error("Renderer output capacity exceeded");
    }
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks, total);
}
export function bindRenderedBytes(
  input: RenderInput,
  data: Uint8Array,
  rawReceipt: unknown,
): RenderReceipt {
  const r = renderReceiptSchema.parse(rawReceipt);
  if (
    r.job_id !== input.job_id ||
    r.source_hash !== input.source_hash ||
    r.snapshot_hash !== input.snapshot_hash ||
    r.html_sha256 !== input.html_sha256 ||
    r.semantic_text_checks !== input.expected_texts.length ||
    r.validation.byte_length !== data.length ||
    r.validation.sha256 !== sha256(data)
  )
    throw new Error("Actual rendered bytes or frozen identity differ");
  return r;
}
export async function renderInSandbox(
  rawInput: unknown,
  rawImage: unknown,
  syntheticProof = false,
): Promise<{
  bytes: Buffer;
  receipt: RenderReceipt;
  runtime: Record<string, unknown>;
}> {
  const input = renderInputSchema.parse(rawInput),
    image = z
      .string()
      .regex(/^lrv-diagnostic-pdf@sha256:[a-f0-9]{64}$/)
      .parse(rawImage);
  const sandbox = await Sandbox.create({
    name: "lrv-pdf-" + randomUUID(),
    image,
    resources: { vcpus: 1 },
    networkPolicy: "deny-all",
    ports: [],
    persistent: false,
    timeout: syntheticProof ? 120000 : 60000,
    env: {},
  });
  let output: {
    bytes: Buffer;
    receipt: RenderReceipt;
    runtime: Record<string, unknown>;
  } | null = null;
  const trace = (stage: string) => {
    if (syntheticProof) console.log("Runtime stage: " + stage);
  };
  try {
    trace("created");
    assert.equal(sandbox.networkPolicy, "deny-all");
    assert.equal(sandbox.persistent, false);
    assert.equal(sandbox.vcpus, 1);
    assert.equal(sandbox.memory, 2048);
    assert.equal(sandbox.currentSnapshotId, undefined);
    assert.deepEqual(sandbox.mounts ?? {}, {});
    const user = sandbox.asUser("lrv-render");
    await user.writeFiles([
      {
        path: "/home/lrv-render/input.json",
        content: JSON.stringify(input),
        mode: 0o600,
      },
    ]);
    trace("input-written");
    const result = await user.runCommand({
      cmd: "node",
      args: [
        "--max-old-space-size=256",
        "/opt/lrv-renderer/worker.mjs",
        ...(syntheticProof ? ["--proof"] : []),
      ],
      cwd: "/home/lrv-render",
      env: {
        PLAYWRIGHT_BROWSERS_PATH: "/ms-playwright",
        NODE_ENV: "production",
        TZ: "UTC",
        LANG: "C.UTF-8",
      },
      timeoutMs: 45000,
    });
    trace("worker-exited-" + result.exitCode);
    if (result.exitCode !== 0) {
      if (syntheticProof) {
        const detail = await readBounded(
          await sandbox.currentSession().readFile({
            path: "/home/lrv-render/work/failure.json",
          }),
          16384,
        );
        throw new Error(
          "Synthetic renderer failure: " + detail.toString("utf8"),
        );
      }
      throw new Error("Renderer failed closed");
    }
    const bytes = await readBounded(
      await sandbox
        .currentSession()
        .readFile({ path: "/home/lrv-render/work/report.pdf" }),
      3145728,
    );
    const metadata = await readBounded(
      await sandbox
        .currentSession()
        .readFile({ path: "/home/lrv-render/work/receipt.json" }),
      16384,
    );
    trace("output-read");
    const receipt = bindRenderedBytes(
      input,
      bytes,
      JSON.parse(metadata.toString("utf8")),
    );
    output = {
      bytes,
      receipt,
      runtime: {
        name: sandbox.name,
        image,
        network_policy: "deny-all",
        persistent: false,
        ports: [],
        vcpus: 1,
        timeout_ms: syntheticProof ? 120000 : 60000,
      },
    };
  } finally {
    trace("stopping");
    let current = await Sandbox.get({ name: sandbox.name, resume: false });
    if (current.status !== "stopped") {
      const stopped = await current.stop();
      assert.equal(
        stopped.snapshot,
        undefined,
        "Scratch runtime must not persist a snapshot",
      );
    }
    for (let i = 0; current.status !== "stopped" && i < 20; i++) {
      await new Promise((r) => setTimeout(r, 500));
      current = await Sandbox.get({ name: sandbox.name, resume: false });
    }
    const finalStatus = current.status;
    assert.equal(finalStatus, "stopped");
    assert.equal(current.currentSnapshotId, undefined);
    assert.equal(current.persistent, false);
    if (output)
      output.runtime = {
        ...output.runtime,
        status: finalStatus,
        snapshot_created: false,
      };
  }
  assert.ok(output);
  return output;
}
