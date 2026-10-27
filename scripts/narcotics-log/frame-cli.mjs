/** Offline official CLI framing; SQL is parsed as text and is never executed. */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import vm from "node:vm";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const sourceCap = 64 * 1024 * 1024;
const provenanceSha = "28bcd6a27b93fb7a31c3e20519b5ebb6540737b26e2f333e3f44cb3340327884";
const typescriptSha = "dd17428736a07e1db1a138d8a14295ddb2699ba780ee15038acdd2c6da5373a0";
const vendor = path.join(root, "tests/controlled-drugs/engine/candidate/vendor/supabase-cli-2.118.0");
const filenames = [
  "20261027223535_controlled_record_review_workflows.sql",
  "20261027223544_narcotics_count_and_stock_workflows.sql",
];
const digest = value => crypto.createHash("sha256").update(value).digest("hex");
const require = createRequire(import.meta.url);

function readRegular(filename, cap = sourceCap) {
  if (!path.isAbsolute(filename) || path.resolve(filename) !== filename) throw Error("Canonical absolute source required");
  for (let current = filename; ; current = path.dirname(current)) {
    if (fs.lstatSync(current).isSymbolicLink()) throw Error("Source symlink refused");
    if (current === path.dirname(current)) break;
  }
  const fd = fs.openSync(filename, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  try {
    const info = fs.fstatSync(fd);
    if (!info.isFile() || info.size > cap) throw Error("Bounded regular source required");
    const bytes = Buffer.alloc(info.size + 1);
    let length = 0;
    while (length < bytes.length) {
      const size = fs.readSync(fd, bytes, length, bytes.length - length, null);
      if (size === 0) break;
      length += size;
    }
    if (length !== info.size) throw Error("Source size changed while reading");
    return bytes.subarray(0, length);
  } finally {
    fs.closeSync(fd);
  }
}

function utf8(raw) {
  return new TextDecoder("utf-8", { fatal: true }).decode(raw);
}

function arrayHashes(statements) {
  const compact = crypto.createHash("sha256");
  const postgres = crypto.createHash("sha256");
  compact.update("["); postgres.update("[");
  let bytes = 2;
  statements.forEach((statement, index) => {
    const encoded = JSON.stringify(statement);
    if (index) { compact.update(","); postgres.update(", "); bytes += 2; }
    compact.update(encoded); postgres.update(encoded);
    bytes += Buffer.byteLength(encoded);
    // A JSON string can expand an ASCII control byte to six bytes. This is
    // an internal representation bound, separate from the raw SQL and wire caps.
    if (bytes > sourceCap * 6 + statements.length * 2 + 2) throw Error("Framing representation bound exceeded");
  });
  compact.update("]"); postgres.update("]");
  return { compact_array_sha256: compact.digest("hex"), postgres_array_sha256: postgres.digest("hex"), postgres_array_bytes: bytes };
}

function derive() {
  const rawProvenance = readRegular(path.join(vendor, "provenance.json"));
  if (digest(rawProvenance) !== provenanceSha) throw Error("Pinned CLI provenance required");
  const provenance = JSON.parse(utf8(rawProvenance));
  if (provenance.kind !== "supabase-cli-statement-source-v2.118.0" || provenance.typescript_version !== "5.8.3") throw Error("Pinned parser contract required");
  for (const [name, pin] of Object.entries(provenance.files)) {
    if (path.basename(name) !== name || digest(readRegular(path.join(vendor, name))) !== pin.sha256) throw Error("Official parser source changed");
  }
  const typescript = path.join(root, "node_modules/typescript/lib/typescript.js");
  if (digest(readRegular(typescript)) !== typescriptSha) throw Error("Pinned TypeScript source required");
  const ts = require(typescript);
  if (ts.version !== "5.8.3") throw Error("Pinned TypeScript version required");
  function load(name, dependency) {
    const raw = utf8(readRegular(path.join(vendor, name + ".ts")));
    const compiled = ts.transpileModule(raw, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
      reportDiagnostics: true,
    });
    if ((compiled.diagnostics || []).some(d => d.category === ts.DiagnosticCategory.Error)) throw Error("Official parser transpilation failed");
    const module = { exports: {} };
    const requireExact = name => {
      if (name !== "./sql-split.ts" || !dependency) throw Error("Unreviewed parser dependency");
      return dependency;
    };
    vm.runInNewContext(compiled.outputText, { exports: module.exports, module, require: requireExact });
    return module.exports;
  }
  const splitter = load("sql-split");
  const parser = load("migration-file", splitter);
  const candidate = JSON.parse(utf8(readRegular(path.join(root, "scripts/narcotics-log/release-candidate.json"))));
  if (Object.keys(candidate.migrations).sort().join("\n") !== filenames.join("\n")) throw Error("Exact two forward files required");
  const migrations = {};
  for (const name of filenames) {
    const raw = readRegular(path.join(root, "supabase/migrations", name));
    const pin = candidate.migrations[name];
    if (pin.bytes !== raw.length || pin.sha256 !== digest(raw)) throw Error("Forward candidate bytes changed");
    const body = utf8(raw);
    if (body.includes("\0")) throw Error("NUL in SQL source refused");
    const parsed = parser.parseMigrationContent(body);
    const statements = Array.from(parsed.statements);
    if (parsed.transactionMode !== "transactional" || statements.length === 0 || statements.length > 5000 || statements.some(s => typeof s !== "string" || !s)) throw Error("Bounded transactional CLI framing required");
    migrations[name] = { ...pin, statement_count: statements.length, ...arrayHashes(statements), statement_sha256s: statements.map(digest) };
  }
  return { kind: "narcotics-official-cli-framing-candidate-v1", cli_version: "2.118.0", parser_provenance_sha256: provenanceSha, typescript_sha256: typescriptSha, migrations, database_operations: 0 };
}

function main() {
  const mode = process.argv.slice(2);
  if (mode.length !== 1 || !["--write-candidate", "--check"].includes(mode[0])) throw Error("Choose --write-candidate or --check");
  const result = derive();
  const destination = path.join(root, "scripts/narcotics-log/cli-framing.json");
  const encoded = Buffer.from(JSON.stringify(result, null, 2) + "\n");
  if (mode[0] === "--write-candidate") {
    if (fs.existsSync(destination) && !readRegular(destination).equals(encoded)) throw Error("Differing framing candidate already exists");
    if (!fs.existsSync(destination)) fs.writeFileSync(destination, encoded, { flag: "wx", mode: 0o600 });
  } else if (!readRegular(destination).equals(encoded)) throw Error("Official CLI framing changed");
  console.log(JSON.stringify({ database_operations: 0, migrations: Object.fromEntries(Object.entries(result.migrations).map(([name, data]) => [name, { bytes: data.bytes, statements: data.statement_count, postgres_array_sha256: data.postgres_array_sha256 }])) }));
}

export { arrayHashes };
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
