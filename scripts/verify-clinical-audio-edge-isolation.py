"""Check and bundle clinical drafting handlers without root Node resolution."""
from pathlib import Path
import shutil
import subprocess
import tempfile

root = Path(__file__).resolve().parents[1]
with tempfile.TemporaryDirectory(prefix="lrv-clinical-audio-edge-") as temporary:
    isolated = Path(temporary)
    functions = ("clinical-audio-process", "clinical-note-process", "clinical-recap-process")
    for folder in ("_shared", *functions):
        shutil.copytree(root / "supabase/functions" / folder, isolated / folder)
    for function in functions:
        config = isolated / function / "deno.json"
        entry = isolated / function / "index.ts"
        subprocess.run(["deno", "check", "--frozen", "--config", str(config), str(entry)], cwd=isolated, check=True)
        subprocess.run(["deno", "bundle", "--frozen", "--config", str(config), "--platform", "deno",
                        "--output", str(isolated / (function + ".js")), str(entry)], cwd=isolated, check=True)
print("Functions-only frozen clinical audio, template note and cited recap checks and bundles passed")
