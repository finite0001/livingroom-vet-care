"""Check and bundle the diagnostic PDF handler without root Node dependency resolution."""

from pathlib import Path
import shutil
import subprocess
import tempfile

root = Path(__file__).resolve().parents[1]
with tempfile.TemporaryDirectory(prefix="lrv-diagnostic-pdf-edge-") as temporary:
    isolated = Path(temporary)
    for folder in ("_shared", "download-diagnostic-pdf"):
        shutil.copytree(root / "supabase/functions" / folder, isolated / folder)
    config = isolated / "download-diagnostic-pdf/deno.json"
    entry = isolated / "download-diagnostic-pdf/index.ts"
    subprocess.run(
        ["deno", "check", "--frozen", "--config", str(config), str(entry)],
        cwd=isolated,
        check=True,
    )
    subprocess.run(
        [
            "deno",
            "bundle",
            "--frozen",
            "--config",
            str(config),
            "--platform",
            "deno",
            "--output",
            str(isolated / "diagnostic-pdf-handler.js"),
            str(entry),
        ],
        cwd=isolated,
        check=True,
    )
print("Functions-only frozen diagnostic PDF check and bundle passed")
