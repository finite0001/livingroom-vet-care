"""Prepare the explicitly historical 206-migration regression worktree in CI.

Current application acceptance runs separately against all 208 migrations.
No historical proof is relabelled as current acceptance.
"""
import json
import os
from pathlib import Path
import subprocess
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))
import prefix_view as prefix


def main():
    root = prefix.ROOT
    if os.environ.get("GITHUB_ACTIONS") != "true":
        raise ValueError("This fixed historical worktree entry point is CI-only")
    parent = Path(os.environ["RUNNER_TEMP"])
    if not parent.is_absolute() or parent.is_symlink() or not parent.is_dir():
        raise ValueError("Real existing runner temp required")
    target = parent / "lrv-canonical206-regression"
    if target.exists() or target.is_symlink():
        raise ValueError("Fresh historical worktree required")
    pins = prefix.canonical206(root)
    forward = json.loads(prefix.regular(root / "scripts/narcotics-log/release-candidate.json"))["migrations"]
    head = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=root, text=True).strip()
    subprocess.run(["git", "worktree", "add", "--detach", str(target), head], cwd=root, check=True, timeout=60)
    for name in prefix.FORWARD:
        path = target / "supabase/migrations" / name
        raw = prefix.regular(path)
        if forward[name] != {"bytes": len(raw), "sha256": prefix.digest(raw)}:
            raise ValueError("Only the exact two admitted forward files may be excluded")
        path.unlink()
    prefix.verify_sources(root, pins)
    prefix.verify_sources(target, pins)
    code = ("import sys;from pathlib import Path;p=Path(sys.argv[1]);"
            "sys.path.insert(0,str(p/'" + prefix.CANDIDATE + "'));"
            "from canonical_review_prefix import admit_canonical206;"
            "r=admit_canonical206(p/'" + prefix.CANDIDATE + "',sorted((p/'supabase/migrations').glob('*.sql')));"
            "assert r['binding206']['canonical_migration_count']==206")
    subprocess.run([sys.executable, "-I", "-B", "-c", code, str(target)], cwd=target, check=True, timeout=60)
    print(json.dumps({"source_commit": head, "historical_prefix_only": 206,
                      "current208_acceptance": False, "verified_original_migrations": len(pins)}))


if __name__ == "__main__":
    main()
