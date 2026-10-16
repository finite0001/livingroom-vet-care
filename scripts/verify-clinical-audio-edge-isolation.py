"""Check and bundle the clinical audio handler without root Node resolution."""
from pathlib import Path
import shutil
import subprocess
import tempfile

root = Path(__file__).resolve().parents[1]
with tempfile.TemporaryDirectory(prefix="lrv-clinical-audio-edge-") as temporary:
    isolated = Path(temporary)
    for folder in ("_shared", "clinical-audio-process"):
        shutil.copytree(root / "supabase/functions" / folder, isolated / folder)
    config = isolated / "clinical-audio-process/deno.json"
    entry = isolated / "clinical-audio-process/index.ts"
    subprocess.run(["deno", "check", "--frozen", "--config", str(config), str(entry)], cwd=isolated, check=True)
    subprocess.run(["deno", "bundle", "--frozen", "--config", str(config), "--platform", "deno",
                    "--output", str(isolated / "worker.js"), str(entry)], cwd=isolated, check=True)
print("Functions-only frozen clinical audio check and bundle passed")
