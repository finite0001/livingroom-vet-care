"""Check all diagnostic-release consumers with only their deployable files."""

from pathlib import Path
import json
import re
import shutil
import subprocess
import tempfile

root = Path(__file__).resolve().parents[1]
functions = root / "supabase/functions"
validator = (functions / "_shared/record-release-diagnostics.ts").resolve()


def imports(entry, seen=None):
    seen = set() if seen is None else seen
    if entry in seen or not entry.is_file():
        return seen
    seen.add(entry)
    for name in re.findall(r"(?:from\s+|import\s*)[\"']([^\"']+)[\"']", entry.read_text()):
        if name.startswith("."):
            imports((entry.parent / name).resolve(), seen)
    return seen


consumers = sorted(
    entry.parent.name
    for entry in functions.glob("*/index.ts")
    if validator in imports(entry.resolve())
)
assert len(consumers) >= 8, "Diagnostic-release consumers unexpectedly disappeared"
for slug in consumers:
    config = functions / slug / "deno.json"
    assert json.loads(config.read_text())["imports"]["zod"] == "npm:zod@3.25.76", slug
    assert (functions / slug / "deno.lock").is_file(), slug
    with tempfile.TemporaryDirectory(prefix="lrv-record-edge-") as temporary:
        isolated = Path(temporary)
        for folder in ("_shared", slug):
            shutil.copytree(functions / folder, isolated / folder)
        config = isolated / slug / "deno.json"
        entry = isolated / slug / "index.ts"
        subprocess.run(
            ["deno", "check", "--frozen", "--config", str(config), str(entry)],
            cwd=isolated,
            check=True,
        )
        subprocess.run(
            ["deno", "bundle", "--frozen", "--config", str(config), "--platform", "deno", "--output", str(isolated / "handler.js"), str(entry)],
            cwd=isolated,
            check=True,
        )
    print(f"Functions-only frozen check and bundle passed: {slug}", flush=True)
print(f"Verified all {len(consumers)} diagnostic-release consumers")
