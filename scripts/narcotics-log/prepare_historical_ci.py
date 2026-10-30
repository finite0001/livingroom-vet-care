"""Prepare the explicitly historical 206-migration regression worktree in CI.

Current application acceptance runs separately against all 208 migrations.
The historical application is pinned to the approved PR312 commit as well;
current controlled-write adapters require the new backend and cannot be
relabelled as compatible with an intentionally historical206 installation.
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
    if Path(os.environ["GITHUB_WORKSPACE"]).resolve() != root:
        raise ValueError("Exact checked-out CI workspace required")
    parent = root.parent
    if parent.is_symlink() or not parent.is_dir():
        raise ValueError("Real existing runner workspace parent required")
    target = parent / "lrv-canonical206-regression"
    if target.exists() or target.is_symlink():
        raise ValueError("Fresh historical worktree required")
    pins = prefix.canonical206(root)
    forward = json.loads(prefix.regular(root / "scripts/narcotics-log/release-candidate.json"))["migrations"]
    head = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=root, text=True).strip()
    historical_head = "217a8e97bb32bdaafc555b16a196450a57a5d1bd"
    available = subprocess.run(["git", "cat-file", "-e", historical_head + "^{commit}"], cwd=root, capture_output=True, timeout=10)
    if available.returncode:
        subprocess.run(["git", "fetch", "--no-tags", "--depth=1", "origin", historical_head], cwd=root, check=True, timeout=60)
    subprocess.run(["git", "worktree", "add", "--detach", str(target), historical_head], cwd=root, check=True, timeout=60)
    for name in prefix.FORWARD:
        path = root / "supabase/migrations" / name
        raw = prefix.regular(path)
        if forward[name] != {"bytes": len(raw), "sha256": prefix.digest(raw)}:
            raise ValueError("Only the exact two admitted forward files may be excluded")
        if (target / "supabase/migrations" / name).exists():
            raise ValueError("Pinned historical application unexpectedly contains a forward migration")
    prefix.verify_sources(root, pins)
    prefix.verify_sources(target, pins)
    code = ("import sys;from pathlib import Path;p=Path(sys.argv[1]);"
            "sys.path.insert(0,str(p/'" + prefix.CANDIDATE + "'));"
            "from canonical_review_prefix import admit_canonical206;"
            "r=admit_canonical206(p/'" + prefix.CANDIDATE + "',sorted((p/'supabase/migrations').glob('*.sql')));"
            "assert r['binding206']['canonical_migration_count']==206")
    subprocess.run([sys.executable, "-I", "-B", "-c", code, str(target)], cwd=target, check=True, timeout=60)
    print(json.dumps({"current_candidate_commit": head, "historical_application_commit": historical_head, "historical_prefix_only": 206,
                      "current208_acceptance": False, "verified_original_migrations": len(pins)}))


if __name__ == "__main__":
    main()
