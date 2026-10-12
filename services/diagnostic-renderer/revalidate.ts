import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Sandbox } from "@vercel/sandbox";
import { z } from "zod";
import { renderInputSchema, readBounded, sha256 } from "./sandbox.ts";
import { admissionSchema, type Admission } from "./processing.ts";
export const CAPTURE_VALIDATION_PROGRAM = `const assert=require('node:assert/strict'),fs=require('node:fs'),crypto=require('node:crypto'),cp=require('node:child_process');
assert.equal(process.platform,'linux');assert.equal(process.getuid(),12001);assert.equal(cp.spawnSync('/usr/bin/sudo',['-n','true'],{stdio:'ignore',timeout:2000}).status,1);
assert.deepEqual(Object.keys(process.env).filter(k=>/TOKEN|SECRET|PASSWORD|API_KEY|SERVICE_ROLE/i.test(k)),[]);
const pdf='/home/lrv-render/work/captured.pdf',expected=JSON.parse(fs.readFileSync('/home/lrv-render/work/expected.json','utf8'));
const hash=b=>crypto.createHash('sha256').update(b).digest('hex'),before=fs.readFileSync(pdf);assert.ok(before.length>0&&before.length<=3145728);
const result=JSON.parse(cp.execFileSync('/usr/bin/python3',['/opt/lrv-renderer/pdf_admission.py',pdf],{timeout:15000,maxBuffer:16384,stdio:['ignore','pipe','pipe']}));
assert.equal(result.sha256,hash(before));assert.equal(result.byte_length,before.length);
const normalize=s=>s.normalize('NFC').replace(/\\s+/gu,' ').trim();const text=normalize(cp.execFileSync('/usr/bin/pdftotext',['-layout',pdf,'-'],{timeout:8000,maxBuffer:1048576,stdio:['ignore','pipe','pipe']}).toString('utf8'));
for(const item of expected)assert.ok(text.includes(normalize(item)),'Frozen expected text missing');
assert.equal(hash(fs.readFileSync(pdf)),hash(before));console.log(JSON.stringify(result));`;
/** Fixed validator-only command in an exact non-resumable session; never regenerates PDF bytes. */
export async function revalidateInSandbox(
  bytes: Uint8Array,
  rawInput: unknown,
  rawImage: unknown,
): Promise<Admission> {
  const input = renderInputSchema.parse(rawInput),
    image = z
      .string()
      .regex(/^lrv-diagnostic-pdf@sha256:[a-f0-9]{64}$/)
      .parse(rawImage);
  assert.ok(bytes.length > 0 && bytes.length <= 3145728);
  const vm = await Sandbox.create({
    name: "lrv-pdf-" + randomUUID(),
    image,
    resources: { vcpus: 1 },
    networkPolicy: "deny-all",
    ports: [],
    persistent: false,
    timeout: 60000,
    env: {},
  });
  try {
    assert.equal(vm.networkPolicy, "deny-all");
    assert.equal(vm.persistent, false);
    assert.equal(vm.vcpus, 1);
    assert.equal(vm.memory, 2048);
    assert.equal(vm.currentSnapshotId, undefined);
    assert.deepEqual(vm.mounts ?? {}, {});
    const session = vm.currentSession();
    await session.writeFiles([
      {
        path: "/home/lrv-render/work/captured.pdf",
        content: Buffer.from(bytes),
        mode: 0o600,
      },
      {
        path: "/home/lrv-render/work/expected.json",
        content: JSON.stringify(input.expected_texts),
        mode: 0o600,
      },
    ]);
    const setup = await session.runCommand({
      cmd: "chown",
      args: [
        "12001:12001",
        "/home/lrv-render/work/captured.pdf",
        "/home/lrv-render/work/expected.json",
      ],
      timeoutMs: 2000,
    });
    assert.equal(setup.exitCode, 0);
    const result = await session.runCommand({
      cmd: "sudo",
      args: [
        "-u",
        "lrv-render",
        "--",
        "node",
        "--max-old-space-size=256",
        "-e",
        CAPTURE_VALIDATION_PROGRAM,
      ],
      timeoutMs: 30000,
    });
    if (result.exitCode !== 0) throw new Error("Captured PDF admission failed");
    const stdout = await result.stdout();
    if (Buffer.byteLength(stdout) > 16384)
      throw new Error("Captured validation output exceeds capacity");
    const admitted = admissionSchema.parse(JSON.parse(stdout));
    assert.equal(admitted.sha256, sha256(bytes));
    assert.equal(admitted.byte_length, bytes.length);
    const recovered = await readBounded(
      await session.readFile({ path: "/home/lrv-render/work/captured.pdf" }),
      3145728,
    );
    assert.equal(sha256(recovered), sha256(bytes));
    return admitted;
  } finally {
    let current = await Sandbox.get({ name: vm.name, resume: false });
    if (current.status !== "stopped") {
      const stopped = await current.stop();
      assert.equal(stopped.snapshot, undefined);
    }
    for (let i = 0; current.status !== "stopped" && i < 20; i++) {
      await new Promise((r) => setTimeout(r, 500));
      current = await Sandbox.get({ name: vm.name, resume: false });
    }
    assert.equal(current.status, "stopped");
    assert.equal(current.currentSnapshotId, undefined);
  }
}
