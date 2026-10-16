"""Check and bundle the invoice-reminder worker without root Node resolution."""
from pathlib import Path
import shutil
import subprocess
import tempfile

root = Path(__file__).resolve().parents[1]
with tempfile.TemporaryDirectory(prefix="lrv-invoice-reminder-edge-") as temporary:
    isolated = Path(temporary)
    for folder in ("_shared", "queue-invoice-reminders"):
        shutil.copytree(root / "supabase/functions" / folder, isolated / folder)
    config = isolated / "queue-invoice-reminders/deno.json"
    entry = isolated / "queue-invoice-reminders/index.ts"
    subprocess.run(["deno", "check", "--frozen", "--config", str(config), str(entry)], cwd=isolated, check=True)
    subprocess.run(["deno", "bundle", "--frozen", "--config", str(config), "--platform", "deno",
                    "--output", str(isolated / "worker.js"), str(entry)], cwd=isolated, check=True)
print("Functions-only frozen invoice-reminder check and bundle passed")
