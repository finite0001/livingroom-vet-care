import { mkdirSync, writeFileSync } from "node:fs";
import { diagnosticRenderInput } from "../../services/diagnostic-renderer/template.ts";
import { longSource } from "../../tests/diagnostics/renderer-fixture.ts";
mkdirSync("tmp/renderer-proof/input", { recursive: true });
writeFileSync(
  "tmp/renderer-proof/input/input.json",
  JSON.stringify(diagnosticRenderInput(longSource())),
  { mode: 0o600 },
);
console.log("Synthetic 100-finding input generated; no clinical records read.");
