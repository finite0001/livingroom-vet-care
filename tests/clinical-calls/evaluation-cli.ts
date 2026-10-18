/** Offline only: no fetch, provider SDK, environment secrets or database client. */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";
import { adjudicateCallReview, buildFrozenCallBundle, createCallReviewPacket, renderCallReviewMarkdown } from "./evaluation-offline.ts";
const path = z.string().min(1).max(4000);
const args = z.discriminatedUnion("command", [
  z.object({ command: z.literal("export"), paths: z.tuple([path]) }).strict(),
  z.object({ command: z.literal("packet"), paths: z.tuple([path, path, path]) }).strict(),
  z.object({ command: z.literal("adjudicate"), paths: z.tuple([path, path, path, path]) }).strict(),
]).parse({ command: process.argv[2], paths: process.argv.slice(3) });
const readJson = (file: string): unknown => {
  const bytes = readFileSync(resolve(file));
  if (bytes.length > 32000000) throw Error("Offline input exceeds 32 MB.");
  return JSON.parse(bytes.toString("utf8"));
};
function output(directory: string, files: Record<string, unknown>) {
  const destination = resolve(directory);
  // Exclusive directory creation rejects even empty existing paths; never overwrite evidence.
  mkdirSync(destination, { mode: 0o700 });
  for (const [name, value] of Object.entries(files)) writeFileSync(resolve(destination, name), (name.endsWith(".md") ? String(value) : JSON.stringify(value, null, 2) + "\n"), { flag: "wx", mode: 0o600 });
  console.log(JSON.stringify({ offline_only: true, provider_requests: 0, files: Object.keys(files), destination }));
}
if (args.command === "export") {
  const bundle = await buildFrozenCallBundle();
  output(args.paths[0], { "bundle.json": bundle, "raw-import-template.json": {
    contract: "lrv-call-fidelity-raw-v1", bundle_sha256: bundle.bundle_sha256,
    cases: bundle.cases.map((c) => ({ case_id: c.id, request_sha256: c.request_sha256, outcome: null })),
  } });
} else if (args.command === "packet") {
  const { packet, form } = await createCallReviewPacket(readJson(args.paths[0]), readJson(args.paths[1]));
  output(args.paths[2], { "packet.json": packet, "review.md": renderCallReviewMarkdown(packet), "adjudication-pending.json": form });
} else {
  const receipt = await adjudicateCallReview(readJson(args.paths[0]), readJson(args.paths[1]), readJson(args.paths[2]));
  output(args.paths[3], { "adjudication-receipt.json": receipt });
}
