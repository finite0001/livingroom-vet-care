/** Read-only verification of this task's exact owned synthetic VM names. */
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { Sandbox } from "@vercel/sandbox";
import { z } from "zod";
assert.equal(process.env.LRV_RUN_SYNTHETIC_RUNTIME_PROOF, "true");
const inventory = z
  .object({ sandboxes: z.array(z.object({ name: z.string() }).passthrough()) })
  .passthrough()
  .parse(
    JSON.parse(
      readFileSync("tmp/renderer-proof/sandbox-final-audit.json", "utf8"),
    ),
  );
const names = z
  .array(z.string().regex(/^lrv-pdf-(?:lifecycle-)?[a-f0-9-]{36}$/))
  .min(1)
  .max(30)
  .parse(
    inventory.sandboxes
      .filter((s) => s.name.startsWith("lrv-pdf-"))
      .map((s) => s.name),
  );
const rows = await Promise.all(
  names.map(async (name) => {
    const vm = await Sandbox.get({ name, resume: false });
    assert.equal(vm.status, "stopped");
    assert.equal(vm.persistent, false);
    assert.equal(vm.currentSnapshotId, undefined);
    assert.equal(vm.networkPolicy, "deny-all");
    assert.equal(vm.vcpus, 1);
    assert.equal(vm.memory, 2048);
    return {
      name,
      status: vm.status,
      persistent: vm.persistent,
      snapshot_created: false,
      vcpus: vm.vcpus,
      memory_mb: vm.memory,
      network_policy: vm.networkPolicy,
    };
  }),
);
writeFileSync(
  "output/renderer-proof/native-runtime-audit.json",
  JSON.stringify(rows, null, 2),
  { mode: 0o600 },
);
console.log(
  `${rows.length} exact owned VMs verified stopped/nonpersistent/deny-all, with no snapshot.`,
);
