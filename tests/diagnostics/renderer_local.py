#!/usr/bin/env python3
"""Synthetic-only Docker execution proof. Never claims native hosted parity on arm64."""

import argparse, hashlib, json, os, subprocess, tempfile, time, uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
p = argparse.ArgumentParser(description=__doc__)
p.add_argument("--run-synthetic-local", action="store_true")
args = p.parse_args()
assert args.run_synthetic_local
nonce = uuid.uuid4().hex
name = "lrv-renderer-proof-" + nonce
image = "lrv-diagnostic-renderer:20261011"
out = ROOT / "output/renderer-proof"
out.mkdir(parents=True, exist_ok=True)


def run(argv, **kwargs):
    return subprocess.run(
        argv, check=True, capture_output=True, text=True, timeout=60, **kwargs
    ).stdout.strip()


def owned():
    d = json.loads(run(["docker", "inspect", name]))[0]
    assert d["Config"]["Labels"]["com.lrv.renderer.proof"] == nonce
    assert d["Config"]["Labels"]["com.lrv.renderer.workdir"] == str(ROOT)
    return d


assert run(["docker", "info", "--format", "{{.Architecture}}"]) == "x86_64", (
    "Native amd64 host required; arm64 emulation cannot prove seccomp parity"
)
created = False
started = time.monotonic()
with tempfile.TemporaryDirectory(prefix="lrv-renderer-input-") as temporary:
    directory = Path(temporary)
    directory.chmod(0o755)
    input_path = directory / "input.json"
    input_path.write_bytes((ROOT / "tmp/renderer-proof/input/input.json").read_bytes())
    input_path.chmod(0o644)
    body = json.loads(input_path.read_text())
    assert "SYNTHETIC Juniper" in body["html"]
    os.environ["LRV_PROOF_PARENT_SECRET"] = (
        nonce  # Deliberately never sent/mounted in the child.
    )
    try:
        run(
            [
                "docker",
                "create",
                "--name",
                name,
                "--label",
                "com.lrv.renderer.proof=" + nonce,
                "--label",
                "com.lrv.renderer.workdir=" + str(ROOT),
                "--platform",
                "linux/amd64",
                "--user",
                "12001:12001",
                "--network",
                "none",
                "--read-only",
                "--cap-drop",
                "ALL",
                "--security-opt",
                "no-new-privileges",
                "--security-opt",
                "seccomp="
                + str(ROOT / "services/diagnostic-renderer/seccomp-profile.json"),
                "--memory",
                "2g",
                "--cpus",
                "1",
                "--pids-limit",
                "256",
                "--shm-size",
                "256m",
                "--tmpfs",
                "/tmp:rw,nosuid,nodev,noexec,size=256m",
                "--tmpfs",
                "/home/lrv-render/work:rw,nosuid,nodev,noexec,size=64m,uid=12001,gid=12001,mode=700",
                "--mount",
                "type=bind,src="
                + str(input_path)
                + ",dst=/home/lrv-render/input.json,readonly",
                "--entrypoint",
                "/usr/bin/sleep",
                image,
                "60",
            ]
        )
        created = True
        d = owned()
        assert (
            d["HostConfig"]["NetworkMode"] == "none"
            and d["HostConfig"]["ReadonlyRootfs"]
            and not d["HostConfig"]["Privileged"]
        )
        assert d["HostConfig"]["CapDrop"] == ["ALL"]
        assert d["HostConfig"]["IpcMode"] == "private"
        assert not d["HostConfig"]["PortBindings"]
        run(["docker", "start", name])
        owned()
        result = subprocess.run(
            [
                "docker",
                "exec",
                name,
                "node",
                "--max-old-space-size=256",
                "/opt/lrv-renderer/worker.mjs",
                "--proof",
            ],
            capture_output=True,
            text=True,
            timeout=45,
        )
        if result.returncode:
            (out / "local-command-failure.json").write_text(
                json.dumps(
                    {
                        "returncode": result.returncode,
                        "stdout": result.stdout[:2000],
                        "stderr": result.stderr[:2000],
                    },
                    indent=2,
                )
            )
            diagnostic = subprocess.run(
                ["docker", "exec", name, "cat", "/home/lrv-render/work/failure.json"],
                check=False,
                capture_output=True,
                text=True,
                timeout=10,
            )
            if diagnostic.returncode == 0:
                (out / "local-failure.json").write_text(diagnostic.stdout)
            raise RuntimeError(
                "Restricted worker failed closed; inspect synthetic output/renderer-proof/local-failure.json"
            )
        for filename in ["report.pdf", "receipt.json"]:
            owned()
            data = subprocess.run(
                ["docker", "exec", name, "cat", "/home/lrv-render/work/" + filename],
                check=True,
                capture_output=True,
                timeout=10,
            ).stdout
            assert len(data) <= (3145728 if filename.endswith(".pdf") else 16384)
            (out / ("local-" + filename)).write_bytes(data)
        receipt = json.loads((out / "local-receipt.json").read_text())
        data = (out / "local-report.pdf").read_bytes()
        assert receipt["validation"]["sha256"] == hashlib.sha256(data).hexdigest()
        assert receipt["uid"] == 12001 and receipt["credentials_absent"]
        assert all(receipt["network"].values())
        receipt["docker_image"] = d["Image"]
        receipt["host_arch"] = run(["docker", "info", "--format", "{{.Architecture}}"])
        receipt["native_amd64"] = receipt["host_arch"] == "x86_64"
        receipt["elapsed_seconds"] = round(time.monotonic() - started, 3)
        (out / "local-runtime-proof.json").write_text(json.dumps(receipt, indent=2))
        print(
            "Restricted Docker proof passed;actual PDF bytes, sandbox and DNS/TCP/metadata denial verified."
        )
    finally:
        if created:
            owned()
            run(["docker", "rm", "-f", name])
            assert not run(
                [
                    "docker",
                    "ps",
                    "-a",
                    "--filter",
                    "label=com.lrv.renderer.proof=" + nonce,
                    "--format",
                    "{{.Names}}",
                ]
            )
            print(
                "Owned proof container and all descendants removed;other containers untouched."
            )
