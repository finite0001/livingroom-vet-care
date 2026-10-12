#!/usr/bin/env python3
"""Publish one bounded synthetic renderer image, preserving global Docker credentials."""

import argparse, hashlib, json, os, subprocess, tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
p = argparse.ArgumentParser(description=__doc__)
p.add_argument("--run-synthetic-runtime-proof", action="store_true")
args = p.parse_args()
assert args.run_synthetic_runtime_proof
context = ROOT / "services/diagnostic-renderer"
names = [
    "Dockerfile",
    "worker.mjs",
    "pdf_admission.py",
    "package.json",
    "package-lock.json",
]
sha = hashlib.sha256(b"".join((context / n).read_bytes() for n in names)).hexdigest()
tag = "proof-20261011-" + sha[:12]
out = ROOT / "tmp/renderer-proof"
out.mkdir(parents=True, exist_ok=True)
global_config = Path("/Users/davidedler/.docker/config.json")
before = hashlib.sha256(global_config.read_bytes()).hexdigest()
with tempfile.TemporaryDirectory(prefix="lrv-vcr-auth-") as temporary:
    config = Path(temporary)
    config.chmod(0o700)
    plugins = Path("/Users/davidedler/.docker/cli-plugins")
    if plugins.exists():
        (config / "cli-plugins").symlink_to(plugins, target_is_directory=True)
    env = dict(os.environ)
    env["DOCKER_CONFIG"] = str(config)
    env["DOCKER_HOST"] = "unix:///Users/davidedler/.docker/run/docker.sock"
    env.pop("DOCKER_CONTEXT", None)
    command = [
        "vercel",
        "vcr",
        "build",
        "docker",
        str(context),
        "lrv-diagnostic-pdf:" + tag,
        "--platform",
        "linux/amd64",
        "--project",
        "prj_Dn1g9AIBEth78S7V3pqhYHueICl7",
        "--scope",
        "team_BDI4hvAq1AWGIREoc8sRwNLH",
        "--push",
    ]
    with (out / "vcr-build.log").open("w") as log:
        os.chmod(log.name, 0o600)
        subprocess.run(
            [
                "vercel",
                "vcr",
                "login",
                "docker",
                "--project",
                "prj_Dn1g9AIBEth78S7V3pqhYHueICl7",
                "--scope",
                "team_BDI4hvAq1AWGIREoc8sRwNLH",
            ],
            cwd=ROOT,
            env=env,
            stdout=log,
            stderr=log,
            timeout=60,
            check=True,
        )
        result = subprocess.run(
            command, cwd=ROOT, env=env, stdout=log, stderr=log, timeout=600
        )
    if result.returncode:
        raise RuntimeError(
            "Scoped image publication failed; protected build log retained; temporary authentication removed"
        )
    (out / "published-image-inputs.json").write_text(
        json.dumps(
            {
                "project": "prj_Dn1g9AIBEth78S7V3pqhYHueICl7",
                "team": "team_BDI4hvAq1AWGIREoc8sRwNLH",
                "repository": "lrv-diagnostic-pdf",
                "tag": tag,
                "source_sha256": sha,
                "file_hashes": {
                    n: hashlib.sha256((context / n).read_bytes()).hexdigest()
                    for n in names
                },
            },
            indent=2,
        )
    )
assert hashlib.sha256(global_config.read_bytes()).hexdigest() == before, (
    "Global Docker configuration changed"
)
print(
    "Scoped synthetic image published;temporary Docker authentication removed;global configuration preserved."
)
