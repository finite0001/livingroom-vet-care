/** Synthetic detached descendant and whole-VM deadline proof; no clinical input. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { Sandbox } from "@vercel/sandbox";
import { z } from "zod";
assert.equal(process.env.LRV_RUN_SYNTHETIC_RUNTIME_PROOF, "true");
const image = z
  .string()
  .regex(/^lrv-diagnostic-pdf@sha256:[a-f0-9]{64}$/)
  .parse(
    JSON.parse(readFileSync("tmp/renderer-proof/native-image.json", "utf8"))
      .image,
  );
const sandbox = await Sandbox.create({
  name: "lrv-pdf-lifecycle-" + randomUUID(),
  image,
  resources: { vcpus: 1 },
  networkPolicy: "deny-all",
  ports: [],
  persistent: false,
  timeout: 15000,
  env: {},
});
let finalStatus = "",
  descendantCreated = false;
try {
  const command = await sandbox.asUser("lrv-render").runCommand({
    cmd: "node",
    args: [
      "-e",
      "const {spawn}=require('node:child_process');const fs=require('node:fs');const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{detached:true,stdio:'ignore'});child.unref();fs.writeFileSync('/home/lrv-render/work/descendant.pid',String(child.pid));setInterval(()=>{},1000)",
    ],
    cwd: "/home/lrv-render",
    detached: true,
  });
  assert.ok(command.cmdId);
  const check = await sandbox.asUser("lrv-render").runCommand({
    cmd: "node",
    args: [
      "-e",
      "const fs=require('node:fs');const p=Number(fs.readFileSync('/home/lrv-render/work/descendant.pid'));process.kill(p,0);console.log('Synthetic detached descendant is alive before whole-VM expiry')",
    ],
    timeoutMs: 2000,
  });
  descendantCreated = check.exitCode === 0;
  assert.ok(descendantCreated);
  for (let i = 0; i < 40; i++) {
    const current = await Sandbox.get({ name: sandbox.name, resume: false });
    finalStatus = current.status;
    if (finalStatus === "stopped") {
      assert.equal(current.currentSnapshotId, undefined);
      break;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  assert.equal(
    finalStatus,
    "stopped",
    "Whole VM must expire including detached descendants",
  );
  writeFileSync(
    "output/renderer-proof/native-lifecycle-proof.json",
    JSON.stringify(
      {
        image,
        name: sandbox.name,

        whole_vm_deadline_ms: 15000,

        detached_descendant_verified_before_expiry: descendantCreated,
        status: finalStatus,
        persistent: false,
        snapshot_created: false,
        clinical_input: false,
      },
      null,
      2,
    ),
    { mode: 0o600 },
  );
  console.log(
    "Native whole-VM expiry passed; detached descendant cannot persist in a stopped VM.",
  );
} finally {
  const current = await Sandbox.get({ name: sandbox.name, resume: false });
  if (current.status !== "stopped") await current.stop();
}
