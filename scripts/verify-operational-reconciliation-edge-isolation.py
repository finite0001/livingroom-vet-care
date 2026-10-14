"""Check and bundle the reconciliation worker without root Node resolution."""
from pathlib import Path
import shutil
import subprocess
import tempfile

root = Path(__file__).resolve().parents[1]
with tempfile.TemporaryDirectory(prefix="lrv-reconciliation-edge-") as temporary:
    isolated = Path(temporary)
    for folder in ("_shared", "reconcile-operational-tasks"):
        shutil.copytree(root / "supabase/functions" / folder, isolated / folder)
    config = isolated / "reconcile-operational-tasks/deno.json"
    entry = isolated / "reconcile-operational-tasks/index.ts"
    subprocess.run(["deno", "check", "--frozen", "--config", str(config), str(entry)], cwd=isolated, check=True)
    subprocess.run(["deno", "bundle", "--frozen", "--config", str(config), "--platform", "deno",
                    "--output", str(isolated / "worker.js"), str(entry)], cwd=isolated, check=True)
print("Functions-only frozen reconciliation check and bundle passed")
