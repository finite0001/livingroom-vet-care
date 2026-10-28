"""Project only fixed RPC names/status codes from protected synthetic CI logs.

No raw log, request, Auth response or SQL text is printed or uploaded. Historical
source and harness behavior remain unchanged; this is a failure-only observer.
"""
import json
import os
from pathlib import Path
import re
import stat
import tempfile

PATTERNS = (
    re.compile(r'Local synthetic RPC ([a-z][a-z0-9_]{0,99}) failed: HTTP ([1-5][0-9]{2}), code ([A-Z0-9]{5}|unknown)\b'),
    re.compile(r'Synthetic RPC ([a-z][a-z0-9_]{0,99}): ([A-Z0-9]{5})\b'),
)


def project(raw):
    if type(raw) is not str or len(raw) > 1048576:
        raise ValueError('Bounded private log tail required')
    output = []
    for pattern in PATTERNS:
        for match in pattern.finditer(raw):
            fields = match.groups()
            row = dict(rpc=fields[0], code=fields[-1])
            if len(fields) == 3:
                row['http_status'] = int(fields[1])
            if row not in output:
                output.append(row)
    # Exact known test source location, never the line's arbitrary text.
    locations = sorted({int(m[1]) for m in re.finditer(r'[/\\]tests[/\\]prescriptions[/\\]local-fulfillment\.ts:([1-9][0-9]{0,5}):[1-9][0-9]{0,3}\b', raw)})
    return dict(rpc_failures=output[:32], fulfillment_source_lines=locations[:32], raw_log_disclosed=False)


def main():
    if os.environ.get('GITHUB_ACTIONS') != 'true':
        raise ValueError('Fixed failure-only GitHub CI observer required')
    results = []
    for directory in Path(tempfile.gettempdir()).glob('lrv-prescription-*'):
        if not re.fullmatch(r'lrv-prescription-[0-9a-f]{12}-[a-z0-9_]{8}', directory.name) or directory.is_symlink():
            continue
        path = directory / 'commands.log'
        if not path.exists() or path.is_symlink():
            continue
        with path.open('rb') as stream:
            meta = os.fstat(stream.fileno())
            if not stat.S_ISREG(meta.st_mode) or meta.st_uid != os.getuid() or meta.st_mode & 0o077 or meta.st_size > 16777216:
                raise ValueError('Original private owned synthetic log required')
            stream.seek(max(0, meta.st_size - 1048576))
            value = project(stream.read(1048576).decode('utf-8', errors='replace'))
        results.append(value)
    print(json.dumps(dict(historical_206_unchanged=True, safe_failure_observations=results)))


if __name__ == '__main__':
    main()
