"""Run unchanged historical proofs in an explicitly verified 206-file source view.

This preserves the historical admission boundary. It grants no acceptance to
the subsequent narcotics migrations or to the current application.
"""
from contextlib import contextmanager
import argparse
import hashlib
import json
import os
import re
from pathlib import Path
import stat
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[2]
CANDIDATE = "tests/controlled-drugs/engine/candidate"
PIN_SHA = "4755a1f1c53008003a11e94ada3963ae416f6c81f163ec43ed2ffea21d6d2f78"
TAIL = {
    "20261020151157_controlled_stock_private_engine.sql":
        "9977696d3d6271cbbfe1dee3767dd71b8512d55bcec0c0d65d108745726252b3",
    "20261022010000_controlled_secondary_review_private.sql":
        "de8e0f4c0d2100b47a490dbd9b8e65c957fa49d003d447cb1af6f37aa8a75bfc",
}
FORWARD = (
    "20261027223535_controlled_record_review_workflows.sql",
    "20261027223544_narcotics_count_and_stock_workflows.sql",
)
PROGRAMS = {
    "artifacts": (
        ("release_assembly.py", "--check"),
        ("cli_migration_body.py", "--check"),
        ("secondary_review_release.py", "--check"),
        ("secondary_review_cli_body.py", "--check"),
    ),
    "secondary-cli": (("run-secondary-review-cli-atomicity.py", "--run-synthetic-local", "--acceptance"),),
    "ordinary": (("run-local.py", "--run-synthetic-local", "--use-canonical-migration", "--include-sql-regression", "--include-correction-capacity", "--include-correction-restore"),),
    "native": (("run-native-history.py", "--run-synthetic-local", "--use-canonical-migration"),),
    "cli": (("run-cli-atomicity.py", "--run-synthetic-local"),),
    "secondary-admission": (("probe-secondary-review.py", "--run-synthetic-local", "--gate-a"),),
    "secondary-protocol": (("probe-secondary-review-protocol.py", "--run-synthetic-local", "--acceptance"),),
}


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


def regular(path, cap=64 * 1024 * 1024):
    path = Path(path)
    if not path.is_absolute() or ".." in path.parts:
        raise ValueError("Absolute bounded source path required")
    for item in (path, *path.parents):
        if stat.S_ISLNK(item.lstat().st_mode):
            raise ValueError("Symlinked source refused")
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(fd, "rb") as stream:
        info = os.fstat(stream.fileno())
        if not stat.S_ISREG(info.st_mode) or info.st_size > cap:
            raise ValueError("Bounded regular source required")
        raw = stream.read(cap + 1)
    if len(raw) > cap:
        raise ValueError("Source byte cap exceeded")
    return raw


def canonical206(root):
    root = Path(root)
    raw = regular(root / CANDIDATE / "release-expected-204.json")
    if digest(raw) != PIN_SHA:
        raise ValueError("Frozen original migration pin changed")
    expected = json.loads(raw)["canonical_migration_hashes"]
    if len(expected) != 204 or set(expected) & set(TAIL):
        raise ValueError("Exact independent 204-file pin required")
    expected = {**expected, **TAIL}
    directory = root / "supabase/migrations"
    actual = sorted(path.name for path in directory.glob("*.sql"))
    if actual not in (sorted(expected), sorted([*expected, *FORWARD])):
        manifest=json.loads(regular(root / "scripts/narcotics-log/operational-release.json"))
        name=manifest.get("migration")
        if manifest.get("kind")!="narcotics-operational-cli209-source-v1"or manifest.get("cli_version")!="2.118.0"or manifest.get("prefix_migration_count")!=208 or manifest.get("migration_count")!=209 or manifest.get("database_operations")!=0:
            raise ValueError("Exact separately framed209 manifest required")
        if name!="20261028170038_narcotics_register_exports_and_recovery.sql" or actual!=sorted([*expected,*FORWARD,name]):
            raise ValueError("Only the complete206, named208 or exact source-pinned209 inventory is admitted")
        body=regular(directory/name);framing=manifest["framing"]
        if framing["bytes"]!=len(body)or framing["sha256"]!=digest(body):
            raise ValueError("Operational209 source differs from its declared framing")
    if len(actual) >= 208:
        candidate = json.loads(regular(root / "scripts/narcotics-log/release-candidate.json"))
        if candidate["prefix_migration_count"] != 206 or candidate["migration_count"] != 208 or set(candidate["migrations"]) != set(FORWARD):
            raise ValueError("Exact named forward source binding required")
        for name, pin in candidate["migrations"].items():
            body = regular(directory / name)
            if pin != {"bytes": len(body), "sha256": digest(body)}:
                raise ValueError("Forward source differs from its declared candidate")
    for name, wanted in expected.items():
        if digest(regular(directory / name)) != wanted:
            raise ValueError("Historical migration bytes changed: " + name)
    return {"supabase/migrations/" + name: wanted for name, wanted in expected.items()}


def source_inputs(root):
    pins = canonical206(root)
    # Only version-controlled historical proof dependencies are copied. No
    # local environment, linked-project metadata, secrets, Git internals or
    # node_modules enter this view.
    result = subprocess.run(
        ["git", "ls-files", "-z"], cwd=root, check=True, capture_output=True,
        timeout=10,
    )
    explicit = {".github/workflows/ci.yml", "scripts/owned_canonical_bootstrap.py",
                "tests/controlled-drugs/owned_scheduler.py"}
    directories = ("tests/controlled-drugs/engine/", "supabase/tests/", "scripts/restore-rehearsal/")
    for raw in result.stdout.split(b"\0"):
        if not raw:
            continue
        name = raw.decode("utf-8", errors="strict")
        path = Path(name)
        if path.is_absolute() or ".." in path.parts:
            raise ValueError("Unsafe tracked source name")
        if name in explicit or name.startswith(directories):
            if any(part in (".git", "node_modules", "__pycache__", ".temp") for part in path.parts) or path.name.startswith(".env"):
                raise ValueError("Environment or generated dependency in historical source closure")
            pins[name] = digest(regular(root / name))
    if not explicit <= set(pins) or CANDIDATE + "/canonical_review_prefix.py" not in pins:
        raise ValueError("Historical dependency closure missing")
    return pins


def verify_sources(root, pins):
    for name, wanted in pins.items():
        if digest(regular(root / name)) != wanted:
            raise ValueError("Proof source changed: " + name)


@contextmanager
def materialize(root=ROOT):
    root = Path(root)
    pins = source_inputs(root)
    with tempfile.TemporaryDirectory(prefix="lrv-206-proof-view-") as directory:
        view = Path(directory).resolve()
        os.chmod(view, 0o700)
        for name, wanted in pins.items():
            raw = regular(root / name)
            if digest(raw) != wanted:
                raise ValueError("Source changed while copying")
            target = view / name
            target.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
            fd = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            with os.fdopen(fd, "wb") as stream:
                stream.write(raw)
        verify_sources(root, pins)
        verify_sources(view, pins)
        # Run the unchanged complete-directory admission in a fresh interpreter.
        code = (
            "import sys;from pathlib import Path;v=Path(sys.argv[1]);"
            "s=v/'" + CANDIDATE + "';sys.path.insert(0,str(s));"
            "from canonical_review_prefix import admit_canonical206;"
            "r=admit_canonical206(s,sorted((v/'supabase/migrations').glob('*.sql')));"
            "assert r['binding206']['canonical_migration_count']==206"
        )
        subprocess.run([sys.executable, "-I", "-B", "-c", code, str(view)],
                       cwd=view, check=True, timeout=60)
        try:
            yield view, pins
        finally:
            verify_sources(root, pins)
            verify_sources(view, pins)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--proof", choices=sorted(PROGRAMS))
    parser.add_argument("--check-only", action="store_true")
    args = parser.parse_args()
    if args.check_only == bool(args.proof):
        parser.error("Choose exactly one of --check-only or --proof")
    with materialize() as (view, pins):
        environment = dict(os.environ)
        for name in ("PYTHONPATH", "PYTHONHOME", "PYTHONSTARTUP", "PYTHONINSPECT", "PYTHONWARNINGS", "PYTHONOPTIMIZE"):
            environment.pop(name, None)
        environment["PYTHONNOUSERSITE"] = "1"
        for program in PROGRAMS.get(args.proof, ()):
            subprocess.run([sys.executable, "-B", str(view / CANDIDATE / program[0]), *program[1:]],
                           cwd=view, env=environment, check=True)
        print(json.dumps({"historical_prefix_only": 206, "copied_source_files": len(pins),
                          "current208_acceptance": False, "proof": args.proof}))


if __name__ == "__main__":
    main()
