/** Source-only209 framing through the unchanged pinned official CLI parser. */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { frameSource, readRegular } from "./frame-cli.mjs";

const here=path.dirname(fileURLToPath(import.meta.url)),root=path.resolve(here,"../..");
const hash=raw=>crypto.createHash("sha256").update(raw).digest("hex");
const pin=raw=>({bytes:raw.length,sha256:hash(raw)});
const origin=JSON.parse(readRegular(path.join(here,"operational-cli-origin.json")));
if(origin.kind!=="official-cli-created-operational-migration-v1"||origin.cli_version!=="2.118.0"||origin.migration!=="20261028170038_narcotics_register_exports_and_recovery.sql"||origin.original_created_file_bytes!==0||JSON.stringify(origin.creation_command)!==JSON.stringify(["supabase","migration","new","narcotics_register_exports_and_recovery"]))throw Error("Actual pinned CLI-created209 filename required");
const sources=["build_operational_module.py","recovery_admission_source.py","sql_framing.py","operational-cli-origin.json","operational-source-proof.json","operational_release.py","frame-operational.mjs","frame-cli.mjs",
  ...["common.sql","register.sql","register-operations.sql","recovery-state.sql","recovery-operations.sql","recovery-inventory.sql","recovery-coordinator.sql","recovery-evidence.sql","recovery-release.sql","recovery-status.sql","metadata.sql","recovery-gateway.sql"].map(name=>"operational-module/"+name)];
const source_files=Object.fromEntries(sources.map(name=>["scripts/narcotics-log/"+name,pin(readRegular(path.join(here,name)))]));
const framing=frameSource(readRegular(path.join(root,"supabase/migrations",origin.migration)));
const manifest={kind:"narcotics-operational-cli209-source-v1",cli_version:"2.118.0",prefix_migration_count:208,migration_count:209,migration:origin.migration,framing,source_files,
  parser_provenance_sha256:"28bcd6a27b93fb7a31c3e20519b5ebb6540737b26e2f333e3f44cb3340327884",typescript_sha256:"dd17428736a07e1db1a138d8a14295ddb2699ba780ee15038acdd2c6da5373a0",database_operations:0};
const output=Buffer.from(JSON.stringify(manifest,null,2)+"\n"),destination=path.join(here,"operational-release.json");
if(process.argv.length!==3||!["--write-manifest","--check"].includes(process.argv[2]))throw Error("Explicit source framing mode required");
if(process.argv[2]==="--write-manifest")fs.writeFileSync(destination,output,{mode:0o600});
else if(!readRegular(destination).equals(output))throw Error("Source-derived209 framing changed");
console.log(JSON.stringify({database_operations:0,migration:manifest.migration,bytes:framing.bytes,statements:framing.statement_count,postgres_array_sha256:framing.postgres_array_sha256}));
