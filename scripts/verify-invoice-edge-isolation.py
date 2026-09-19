"""Check and bundle the invoice handler without root Node dependency resolution."""
from pathlib import Path
import shutil
import subprocess
import tempfile

root = Path(__file__).resolve().parents[1]
with tempfile.TemporaryDirectory(prefix="lrv-invoice-edge-") as temporary:
    isolated = Path(temporary)
    for folder in ("_shared", "prepare-invoice-email"):
        shutil.copytree(root / "supabase/functions" / folder, isolated / folder)
    config = isolated / "prepare-invoice-email/deno.json"
    entry = isolated / "prepare-invoice-email/index.ts"
    subprocess.run(["deno", "check", "--frozen", "--config", str(config), str(entry)], cwd=isolated, check=True)
    subprocess.run(["deno", "bundle", "--frozen", "--config", str(config), "--platform", "deno", "--output", str(isolated / "invoice-handler.js"), str(entry)], cwd=isolated, check=True)
print("Functions-only frozen invoice check and bundle passed")
