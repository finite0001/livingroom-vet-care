"""Lossless private measurement evidence. Never rewrites existing evidence."""
import gzip
import hashlib
import io
import json
from pathlib import Path
import subprocess
import tempfile
import shutil
import resource
import signal

MAX_MEMBER_BYTES = 128 * 1024**2
MAX_DECODED_BYTES = 32 * 1024**3
MAX_COMPRESSED_BYTES = 4 * 1024**3
CLEANUP_DECODED_BYTES = 1024**3
CLEANUP_COMPRESSED_BYTES = 256*1024**2
INDEX = 'measurement-evidence-index.json'


def limit_output_files():
    # Only this owned local CLI process and its subprocesses inherit the cap.
    resource.setrlimit(resource.RLIMIT_FSIZE,(MAX_MEMBER_BYTES,MAX_MEMBER_BYTES))
    resource.setrlimit(resource.RLIMIT_CORE,(0,0))


def assert_output_bound(result):
    assert result.returncode != -signal.SIGXFSZ, 'Owned output file limit exceeded; exact partial streams retained'
    assert max(len(result.stdout.encode()),len(result.stderr.encode())) < MAX_MEMBER_BYTES, 'Owned output reached file cap; exact partial streams retained'


def digest(data):
    return hashlib.sha256(data).hexdigest()


def unique(pairs):
    result = {}
    for key, value in pairs:
        assert key not in result, 'Duplicate evidence index key'
        result[key] = value
    return result


def bounded_decode(stored, limit):
    assert 0 <= limit <= MAX_MEMBER_BYTES
    with gzip.GzipFile(fileobj=io.BytesIO(stored)) as stream:
        decoded = stream.read(limit + 1)
        assert len(decoded) <= limit, 'Decoded evidence exceeds declared size'
        assert not stream.read(1), 'Additional decoded evidence bytes'
    return decoded


class Evidence:
    def __init__(self, folder):
        self.folder = Path(folder)
        self.entries = {}
        self.phase = 'workload'
        assert not (self.folder / INDEX).exists(), 'Refuse existing evidence index'
        assert not list(self.folder.glob('*.gz')), 'Refuse existing compressed evidence'
        self._index()

    def _index(self):
        value = {'kind': 'record-review-v3-lossless-measurement-evidence-v1',
                 'entries': self.entries}
        (self.folder / INDEX).write_text(json.dumps(value, sort_keys=True, indent=2) + '\n')

    def begin_cleanup(self):
        self.phase='cleanup'

    def write(self, logical, data):
        assert isinstance(data, bytes)
        assert Path(logical).name == logical and logical not in ('', '.', '..', INDEX)
        assert logical not in self.entries and not (self.folder / logical).exists(), 'Never replace evidence'
        assert len(data) <= MAX_MEMBER_BYTES, 'Evidence member exceeds reviewed bound'
        prior=[e for e in self.entries.values() if e['phase']==self.phase]
        decoded_cap=MAX_DECODED_BYTES if self.phase=='workload' else CLEANUP_DECODED_BYTES
        compressed_cap=MAX_COMPRESSED_BYTES if self.phase=='workload' else CLEANUP_COMPRESSED_BYTES
        assert sum(e['decoded_bytes'] for e in prior) + len(data) <= decoded_cap
        stored = gzip.compress(data, compresslevel=1, mtime=0)
        assert sum(e['compressed_bytes'] for e in prior) + len(stored) <= compressed_cap
        archive = logical + '.gz'
        with (self.folder / archive).open('xb') as handle:
            handle.write(stored)
        entry = {'path': archive, 'encoding': 'gzip', 'phase': self.phase, 'decoded_bytes': len(data),
                 'decoded_sha256': digest(data), 'compressed_bytes': len(stored),
                 'compressed_sha256': digest(stored)}
        assert read_member(self.folder, logical, entry) == data, 'Persistence roundtrip failed'
        self.entries[logical] = entry
        self._index()

    def verify(self):
        observed = read_index(self.folder)
        assert observed == self.entries, 'Evidence index differs from writer receipt'
        verify(self.folder)

    def command(self, argv, text, *, stem, scratch, **kwargs):
        """Regular-file I/O with a private pending directory until retention.

        A retention error preserves that directory in this NEW evidence folder;
        owned runtime cleanup never deletes it. Success/nonzero/timeout output
        is compressed and roundtrip-verified before only these scratch files go.
        """
        scratch = Path(scratch)
        assert scratch.is_dir() and not scratch.is_symlink()
        pending=Path(tempfile.mkdtemp(prefix='pending-command-',dir=self.folder))
        if text is not None:self.write(stem + '-executed.sql', text.encode())
        retained=False
        try:
            with (pending/'stdin').open('w+b') as inp, (pending/'stdout').open('w+b') as out, (pending/'stderr').open('w+b') as err:
                if text is not None:inp.write(text.encode());inp.seek(0)
                try:
                    process = subprocess.run(argv, stdin=inp, stdout=out, stderr=err, preexec_fn=limit_output_files, **kwargs)
                finally:
                    out.seek(0);stdout=out.read();err.seek(0);stderr=err.read()
                    self.write(stem + '-stdout.log', stdout)
                    self.write(stem + '-stderr.log', stderr)
                    retained=True
                result=subprocess.CompletedProcess(argv, process.returncode, stdout.decode(), stderr.decode())
                assert_output_bound(result)
                return result
        finally:
            if retained:shutil.rmtree(pending)


def read_index(folder):
    value = json.loads((Path(folder) / INDEX).read_text(), object_pairs_hook=unique)
    assert set(value) == {'kind', 'entries'}
    assert value['kind'] == 'record-review-v3-lossless-measurement-evidence-v1'
    assert isinstance(value['entries'], dict)
    return value['entries']


def read_member(folder, logical, entry=None):
    """Reviewer reader: exact bytes, with bounded decoding and both digests."""
    folder = Path(folder)
    if entry is None:
        entry = read_index(folder)[logical]
    assert Path(logical).name == logical
    assert set(entry) == {'path', 'encoding', 'phase', 'decoded_bytes', 'decoded_sha256',
                          'compressed_bytes', 'compressed_sha256'}
    assert entry['path'] == logical + '.gz' and entry['encoding'] == 'gzip'
    assert entry['phase'] in ('workload','cleanup')
    assert type(entry['decoded_bytes']) is int and type(entry['compressed_bytes']) is int
    assert 0 <= entry['compressed_bytes'] <= MAX_MEMBER_BYTES + 1024**2
    path = folder / entry['path']
    assert path.stat().st_size == entry['compressed_bytes']
    stored = path.read_bytes()
    assert digest(stored) == entry['compressed_sha256']
    decoded = bounded_decode(stored, entry['decoded_bytes'])
    assert len(decoded) == entry['decoded_bytes'] and digest(decoded) == entry['decoded_sha256']
    return decoded


def verify(folder):
    folder = Path(folder)
    entries = read_index(folder)
    assert not list(folder.glob('pending-*')), 'Unretained process evidence remains'
    assert {str(path.relative_to(folder)) for path in folder.rglob('*.gz')} == {e['path'] for e in entries.values()}, 'Exact compressed evidence inventory required'
    for phase,decoded_cap,compressed_cap in [('workload',MAX_DECODED_BYTES,MAX_COMPRESSED_BYTES),('cleanup',CLEANUP_DECODED_BYTES,CLEANUP_COMPRESSED_BYTES)]:
        selected=[e for e in entries.values() if e['phase']==phase]
        assert sum(e['decoded_bytes'] for e in selected)<=decoded_cap
        assert sum(e['compressed_bytes'] for e in selected)<=compressed_cap
    for logical, entry in entries.items():
        assert not (folder / logical).exists(), 'Ambiguous raw/compressed evidence'
        read_member(folder, logical, entry)
    return {'members': len(entries), 'decoded_bytes': sum(e['decoded_bytes'] for e in entries.values()),
            'compressed_bytes': sum(e['compressed_bytes'] for e in entries.values())}
