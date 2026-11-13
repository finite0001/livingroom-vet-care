"""Current-source count-finalize driver, with whole historical protocol inverses."""
import argparse
import hashlib
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
ORIGINAL_DRIVER = "tests/controlled-drugs/run-local-authenticated-count-finalize.mjs"
CURRENT_DRIVER = "tests/controlled-drugs/run-beta-authenticated-count-finalize.mjs"


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def materialize(write=False):
    source = json.loads((HERE / "business-source.json").read_bytes())
    driver = (ROOT / ORIGINAL_DRIVER).read_bytes()
    supervisor = (HERE / "workflows/browser_runner.py").read_bytes()
    for raw, pin in ((driver, source["browser_sources"][ORIGINAL_DRIVER]),
                     (supervisor, source["workflows"]["browser_runner.py"])):
        if pin != {"bytes": len(raw), "sha256": sha(raw)}:
            raise ValueError("Exact original browser protocol source required")
    old = driver.decode()
    start = old.index("function verifySources(){")
    end = old.index("\nconst sourcesSha=verifySources();", start)
    previous = old[start:end]
    current = """function verifySources(){
 const frozenRaw=regular(resolve(root,'tests/controlled-drugs/narcotics-finalize-browser-bindings.json'),65536);
 assert.equal(sha(frozenRaw),'fa3282a22c9864a979b778979d975ae1cb037d9930fedf55cd19dadeb4992d92');
 const frozen=JSON.parse(frozenRaw);assert.equal(Object.keys(frozen.files).length,146);
 const raw=regular(resolve(root,'scripts/narcotics-log/picture-security-html-entry-candidate-source.json'),2097152);
 const binding=JSON.parse(raw);assert.equal(binding.kind,'livingroom-beta-current-source-v1');
 assert.equal(binding.database_operations,0);assert.equal(binding.runtime_acceptance,false);
 for(const name of Object.keys(frozen.files))assert(Object.hasOwn(binding.files,name));
 const files=Object.entries(binding.files).filter(([name])=>name.startsWith('src/')||Object.hasOwn(frozen.files,name));
 assert(files.length>=146);
 for(const[name,wanted]of files){assert(!name.startsWith('/')&&!name.split('/').includes('..'));const path=resolve(root,name);assert(path.startsWith(root));const data=regular(path,2*1024*1024);assert.equal(data.length,wanted.bytes);assert.equal(sha(data),wanted.sha256);}
 return sha(raw);
}"""
    after = old[:start] + current + old[end:]
    if after.replace(current, previous, 1) != old:
        raise ValueError("Complete historical browser driver inverse required")
    old_supervisor = supervisor.decode()
    replacements = [("Path(__file__).resolve().parents[3]", "Path(__file__).resolve().parents[2]"),
                    (ORIGINAL_DRIVER, CURRENT_DRIVER)]
    new_supervisor = old_supervisor
    for before, replacement in replacements:
        if new_supervisor.count(before) != 1:
            raise ValueError("One exact historical supervisor source anchor required")
        new_supervisor = new_supervisor.replace(before, replacement, 1)
    inverse = new_supervisor
    for before, replacement in reversed(replacements):
        inverse = inverse.replace(replacement, before, 1)
    if inverse != old_supervisor:
        raise ValueError("Complete historical browser supervisor inverse required")
    proof = dict(kind="current-beta-finalize-browser-source-v1", database_operations=0,
        historical_driver_sha256=sha(driver), current_driver_sha256=sha(after.encode()),
        historical_supervisor_sha256=sha(supervisor), current_supervisor_sha256=sha(new_supervisor.encode()),
        whole_driver_inverse=True, whole_supervisor_inverse=True, historical_binding_unchanged=True,
        original_network_Auth_business_and_cleanup_protocol_unchanged=True,
        original120second_deadline_unchanged=True, current_source_closure="all src plus original146 minimum")
    outputs = {ROOT / CURRENT_DRIVER: after.encode(), HERE / "beta_browser_runner.py": new_supervisor.encode(),
               HERE / "picture-security-html-entry-browser-source-proof.json": (json.dumps(proof, sort_keys=True, indent=2) + "\n").encode()}
    for path, raw in outputs.items():
        if write:
            path.write_bytes(raw)
        elif not path.is_file() or path.read_bytes() != raw:
            raise ValueError("Current browser source differs: " + path.name)
    return proof


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--write-candidate", action="store_true")
    mode.add_argument("--check-source", action="store_true")
    args = parser.parse_args()
    print(json.dumps(materialize(args.write_candidate), sort_keys=True))
