"""Check and bundle the patient photo handler without root Node dependency resolution."""
from pathlib import Path
import shutil
import subprocess
import tempfile

root = Path(__file__).resolve().parents[1]
with tempfile.TemporaryDirectory(prefix="lrv-photo-edge-") as temporary:
    isolated = Path(temporary)
    for folder in ("_shared", "verify-patient-photo"):
        shutil.copytree(root / "supabase/functions" / folder, isolated / folder)
    config = isolated / "verify-patient-photo/deno.json"
    entry = isolated / "verify-patient-photo/index.ts"
    subprocess.run(["deno", "check", "--frozen", "--config", str(config), str(entry)], cwd=isolated, check=True)
    subprocess.run(["deno", "bundle", "--frozen", "--config", str(config), "--platform", "deno", "--output", str(isolated / "photo-handler.js"), str(entry)], cwd=isolated, check=True)
print("Functions-only frozen patient photo check and bundle passed")
