"""Private, bounded CMS evidence packaging; no plaintext upload or automatic extraction."""
from __future__ import annotations

import gzip
import hashlib
import io
import json
import mmap
import os
from pathlib import Path, PurePosixPath
import stat
import subprocess
import tarfile
import time

RECIPIENT_PEM_SHA256 = "8b6bfa3adf3272e430be6f7e8f4ce9bf2defa55821cfd9d74fe29ed5ed8ecc6f"
RECIPIENT_DER_SHA256 = "98d6751ac1fec4dea5f303f066ce4960957cd7c8041866b8c47d4cae8391473a"
MAX_SOURCE = 2 * 1024**3
MAX_ARCHIVE = 256 * 1024**2
MAX_ENVELOPE = 512 * 1024**2
MAX_ENTRIES = 50000
SEAL_SECONDS = 180
CHUNK = 1024**2


class EvidenceError(RuntimeError):
    def __init__(self, code: str):
        self.code = code
        super().__init__(code)


def require(condition: bool, code: str) -> None:
    if not condition:
        raise EvidenceError(code)


def sha256_file(path: Path, deadline: float | None = None) -> str:
    digest = hashlib.sha256()
    before = path.lstat()
    require(stat.S_ISREG(before.st_mode) and before.st_nlink == 1, "capture_type")
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(fd, "rb") as stream:
        actual = os.fstat(stream.fileno())
        require((before.st_dev, before.st_ino, before.st_size) ==
                (actual.st_dev, actual.st_ino, actual.st_size), "capture_changed")
        count = 0
        for chunk in iter(lambda: stream.read(CHUNK), b""):
            if deadline is not None:
                remaining(deadline)
            count += len(chunk)
            require(count <= before.st_size, "capture_changed")
            digest.update(chunk)
        require(count == before.st_size, "capture_changed")
    return digest.hexdigest()


def remaining(deadline: float) -> float:
    value = deadline - time.monotonic()
    require(value > 0, "seal_timeout")
    return value


def private_write(path: Path, data: bytes) -> None:
    with path.open("xb") as stream:
        os.chmod(path, 0o600)
        stream.write(data)


def openssl(args: list[str], private: Path, deadline: float) -> bytes:
    # Every invocation gets its own retained stderr. No tool output reaches CI logs.
    import tempfile
    fd, name = tempfile.mkstemp(prefix="openssl-", suffix=".stderr", dir=private)
    with os.fdopen(fd, "wb") as error:
        try:
            result = subprocess.run(["openssl", *args], stdout=subprocess.PIPE,
                                    stderr=error, timeout=remaining(deadline), check=False)
        except subprocess.TimeoutExpired as exc:
            raise EvidenceError("seal_timeout") from exc
        except OSError as exc:
            raise EvidenceError("openssl_unavailable") from exc
    require(result.returncode == 0, "openssl_failed")
    return result.stdout


class Der:
    """Read only definite, minimal DER TLVs at the admitted CMS metadata positions.

    OpenSSL performs all cryptography. Ciphertext is never parsed recursively.
    This narrow reader rejects alternate CMS profiles and trailing bytes.
    """
    def __init__(self, data, start=0, limit=None):
        limit = len(data) if limit is None else limit
        require(start + 2 <= limit, "cms_profile")
        self.data, self.start, self.tag = data, start, data[start]
        require(self.tag & 31 != 31, "cms_profile")
        length, cursor = data[start + 1], start + 2
        if length & 128:
            count = length & 127
            require(1 <= count <= 4 and cursor + count <= limit, "cms_profile")
            require(data[cursor] != 0, "cms_profile")
            length = int.from_bytes(data[cursor:cursor + count], "big")
            require(length >= 128, "cms_profile")
            cursor += count
        self.begin, self.end = cursor, cursor + length
        require(self.end <= limit, "cms_profile")

    def value(self):
        return self.data[self.begin:self.end]

    def raw(self):
        return self.data[self.start:self.end]

    def children(self, tags):
        nodes, cursor = [], self.begin
        for tag in tags:
            node = Der(self.data, cursor, self.end)
            require(node.tag == tag, "cms_profile")
            nodes.append(node)
            cursor = node.end
        require(cursor == self.end, "cms_profile")
        return nodes


def single(data, tag=0x30):
    node = Der(data)
    require(node.tag == tag and node.end == len(data), "cms_profile")
    return node


def certificate(recipient: Path, pem_pin: str, der_pin: str, private: Path,
                deadline: float) -> tuple[bytes, bytes]:
    st = recipient.lstat()
    require(stat.S_ISREG(st.st_mode) and st.st_nlink == 1 and st.st_size <= 16384,
            "recipient_invalid")
    pem = recipient.read_bytes()
    require(pem.count(b"-----BEGIN CERTIFICATE-----") == 1
            and pem.count(b"-----END CERTIFICATE-----") == 1
            and b"PRIVATE KEY" not in pem
            and hashlib.sha256(pem).hexdigest() == pem_pin, "recipient_pin")
    der = openssl(["x509", "-in", str(recipient), "-outform", "DER"], private, deadline)
    require(hashlib.sha256(der).hexdigest() == der_pin, "recipient_pin")
    tbs, _, _ = single(der).children([0x30, 0x30, 0x03])
    fields = tbs.children([0xa0, 0x02, 0x30, 0x30, 0x30, 0x30, 0x30, 0xa3])
    serial, issuer, spki = fields[1], fields[3], fields[6]
    algorithm, key = spki.children([0x30, 0x03])
    require(algorithm.raw() == bytes.fromhex("300d06092a864886f70d0101010500"), "recipient_invalid")
    require(key.value()[0] == 0, "recipient_invalid")
    modulus, exponent = single(key.value()[1:]).children([0x02, 0x02])
    require(int.from_bytes(modulus.value(), "big").bit_length() == 4096
            and int.from_bytes(exponent.value(), "big") == 65537, "recipient_invalid")
    return issuer.raw(), serial.raw()


def validate_cms(path: Path, identity: tuple[bytes, bytes]) -> None:
    st = path.lstat()
    require(stat.S_ISREG(st.st_mode) and st.st_nlink == 1
            and 0 < st.st_size <= MAX_ENVELOPE, "cms_size")
    with path.open("rb") as stream, mmap.mmap(stream.fileno(), 0, access=mmap.ACCESS_READ) as data:
        kind, explicit = single(data).children([0x06, 0xa0])
        require(kind.value() == bytes.fromhex("2a864886f70d0109100117"), "cms_profile")
        (body,) = explicit.children([0x30])
        version, recipients, encrypted, tag = body.children([0x02, 0x31, 0x30, 0x04])
        require(version.value() == b"\x00" and len(tag.value()) == 16, "cms_profile")
        (recipient,) = recipients.children([0x30])
        version, identifier, algorithm, wrapped = recipient.children([0x02, 0x30, 0x30, 0x04])
        issuer, serial = identifier.children([0x30, 0x02])
        require(version.value() == b"\x00" and (issuer.raw(), serial.raw()) == identity
                and len(wrapped.value()) == 512, "cms_profile")
        require(algorithm.raw() == bytes.fromhex(
            "303806092a864886f70d010107302ba00d300b0609608648016503040201"
            "a11a301806092a864886f70d010108300b0609608648016503040201"), "cms_profile")
        content, cipher, payload = encrypted.children([0x06, 0x30, 0x80])
        require(content.value() == bytes.fromhex("2a864886f70d010701")
                and payload.end > payload.begin, "cms_profile")
        cipher_oid, params = cipher.children([0x06, 0x30])
        nonce, tag_length = params.children([0x04, 0x02])
        require(cipher_oid.value() == bytes.fromhex("60864801650304012e")
                and len(nonce.value()) == 12 and tag_length.value() == b"\x10", "cms_profile")


def safe_name(name: str) -> bool:
    path = PurePosixPath(name)
    return bool(name) and not path.is_absolute() and all(
        part not in ("", ".", "..") for part in name.split("/")) and "\\" not in name and "\x00" not in name


def snapshot(root: Path, deadline: float) -> dict:
    require(root.is_dir() and not root.is_symlink(), "capture_invalid")
    entries, total = {}, 0
    for current, directories, files in os.walk(root, followlinks=False):
        for name in sorted(directories + files):
            remaining(deadline)
            path = Path(current) / name
            relative = path.relative_to(root).as_posix()
            st = path.lstat()
            require(safe_name(relative), "capture_path")
            require(stat.S_ISDIR(st.st_mode) or (stat.S_ISREG(st.st_mode) and st.st_nlink == 1), "capture_type")
            item = {"mode": stat.S_IMODE(st.st_mode), "kind": "directory" if stat.S_ISDIR(st.st_mode) else "file"}
            if item["kind"] == "file":
                total += st.st_size
                require(total <= MAX_SOURCE, "source_limit")
                item.update(size=st.st_size, sha256=sha256_file(path, deadline))
                require((st.st_ino, st.st_dev, st.st_size, st.st_mtime_ns) ==
                        (path.lstat().st_ino, path.lstat().st_dev, path.lstat().st_size, path.lstat().st_mtime_ns), "capture_changed")
            entries[relative] = item
            require(len(entries) <= MAX_ENTRIES, "entry_limit")
    return entries


class BoundedWriter:
    def __init__(self, stream, deadline):
        self.stream, self.deadline, self.count = stream, deadline, 0

    def write(self, data):
        remaining(self.deadline)
        self.count += len(data)
        require(self.count <= MAX_ARCHIVE, "archive_limit")
        return self.stream.write(data)

    def flush(self):
        return self.stream.flush()


def build_archive(capture: Path, archive: Path, metadata: dict, deadline: float) -> dict:
    entries = snapshot(capture, deadline)
    manifest = {"schema": 1, "metadata": metadata, "entries": entries}
    encoded = json.dumps(manifest, sort_keys=True, separators=(",", ":")).encode()
    require(len(encoded) <= 32 * 1024**2, "manifest_limit")
    with archive.open("xb") as output:
        os.chmod(archive, 0o600)
        with gzip.GzipFile(fileobj=BoundedWriter(output, deadline), mode="wb", mtime=0) as zipped:
            with tarfile.open(fileobj=zipped, mode="w|", format=tarfile.PAX_FORMAT) as tar:
                info = tarfile.TarInfo("manifest.json")
                info.size, info.mode = len(encoded), 0o600
                tar.addfile(info, io.BytesIO(encoded))
                for name, item in sorted(entries.items()):
                    remaining(deadline)
                    path = capture / name
                    info = tarfile.TarInfo("capture/" + name)
                    info.mode = item["mode"]
                    if item["kind"] == "directory":
                        info.type = tarfile.DIRTYPE
                        tar.addfile(info)
                    else:
                        info.size = item["size"]
                        fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
                        with os.fdopen(fd, "rb") as source:
                            st = os.fstat(source.fileno())
                            require(stat.S_ISREG(st.st_mode) and st.st_nlink == 1
                                    and st.st_size == info.size, "capture_changed")
                            tar.addfile(info, source)
    require(snapshot(capture, deadline) == entries, "capture_changed")
    validate_archive(archive, deadline)
    return manifest


class BoundedReader:
    def __init__(self, stream, deadline):
        self.stream, self.deadline, self.count = stream, deadline, 0

    def read(self, size=-1):
        remaining(self.deadline)
        require(0 <= size <= 32 * 1024**2, "archive_read_limit")
        data = self.stream.read(size)
        self.count += len(data)
        require(self.count <= MAX_SOURCE + 128 * 1024**2, "source_limit")
        return data


def validate_archive(archive: Path, deadline: float) -> dict:
    require(archive.stat().st_size <= MAX_ARCHIVE, "archive_limit")
    with gzip.open(archive, "rb") as zipped:
        bounded = BoundedReader(zipped, deadline)
        with tarfile.open(fileobj=bounded, mode="r|") as tar:
            first = tar.next()
            require(first is not None and first.name == "manifest.json" and first.isfile()
                    and first.size <= 32 * 1024**2, "archive_manifest")
            def unique_object(pairs):
                value = {}
                for key, item in pairs:
                    require(key not in value, "archive_manifest")
                    value[key] = item
                return value
            manifest = json.load(tar.extractfile(first), object_pairs_hook=unique_object)
            require(manifest.get("schema") == 1 and isinstance(manifest.get("entries"), dict), "archive_manifest")
            expected, seen = manifest["entries"], set()
            require(len(expected) <= MAX_ENTRIES, "entry_limit")
            for member in tar:
                if member is first:
                    continue
                require(member.name.startswith("capture/"), "archive_path")
                name = member.name[len("capture/"):]
                require(safe_name(name) and name in expected and name not in seen, "archive_path")
                item = expected[name]
                require(member.mode == item["mode"], "archive_metadata")
                if item["kind"] == "directory":
                    require(member.isdir(), "archive_type")
                else:
                    require(item["kind"] == "file" and member.isfile() and member.size == item["size"], "archive_type")
                    digest = hashlib.sha256()
                    with tar.extractfile(member) as source:
                        for chunk in iter(lambda: source.read(CHUNK), b""):
                            remaining(deadline)
                            digest.update(chunk)
                    require(digest.hexdigest() == item["sha256"], "archive_hash")
                seen.add(name)
            require(seen == set(expected), "archive_members")
            # Drain tarfile's buffered stream, not just gzip: its 10KiB read-ahead
            # may already contain bytes after the first zero tar header.
            for chunk in iter(lambda: tar.fileobj.read(CHUNK), b""):
                require(not chunk.strip(b"\x00"), "archive_trailing")
    return manifest


def seal(capture: Path, private_dir: Path, upload: Path, metadata: dict,
         recipient: Path, expected_pem_sha256: str, expected_der_sha256: str) -> dict:
    deadline = time.monotonic() + SEAL_SECONDS
    require(private_dir.is_dir() and not private_dir.is_symlink()
            and not private_dir.is_relative_to(capture), "private_directory")
    require(not upload.exists() and not upload.is_symlink(), "upload_exists")
    version = openssl(["version"], private_dir, deadline)
    require(version.startswith(b"OpenSSL 3."), "openssl_version")
    identity = certificate(recipient, expected_pem_sha256, expected_der_sha256, private_dir, deadline)
    archive = private_dir / "evidence.tar.gz"
    build_archive(capture, archive, {**metadata, "recipient_fingerprint": expected_der_sha256,
                                  "openssl_version": version.decode("ascii").strip()}, deadline)
    encrypted = private_dir / "evidence.cms.partial"
    openssl(["cms", "-encrypt", "-binary", "-aes-256-gcm", "-outform", "DER", "-recip", str(recipient),
             "-keyopt", "rsa_padding_mode:oaep", "-keyopt", "rsa_oaep_md:sha256",
             "-keyopt", "rsa_mgf1_md:sha256", "-in", str(archive), "-out", str(encrypted)], private_dir, deadline)
    os.chmod(encrypted, 0o600)
    validate_cms(encrypted, identity)
    remaining(deadline)
    result = {"ciphertext_sha256": sha256_file(encrypted, deadline), "ciphertext_bytes": encrypted.stat().st_size,
              "recipient_fingerprint": expected_der_sha256, "raw_evidence_encrypted": True}
    upload.mkdir(mode=0o700)
    encrypted.rename(upload / "evidence.cms")
    return result


def decrypt_verified(encrypted: Path, expected_cipher_sha256: str, recipient: Path,
                     private_key: Path, quarantine: Path, *, pem_pin=RECIPIENT_PEM_SHA256,
                     der_pin=RECIPIENT_DER_SHA256) -> Path:
    """Authenticate and verify in fresh local quarantine; return archive, never extract."""
    require(not quarantine.exists() and not quarantine.is_symlink(), "quarantine_exists")
    quarantine.mkdir(mode=0o700)
    deadline = time.monotonic() + SEAL_SECONDS
    st = encrypted.lstat()
    require(stat.S_ISREG(st.st_mode) and st.st_nlink == 1
            and 0 < st.st_size <= MAX_ENVELOPE, "cms_size")
    require(sha256_file(encrypted, deadline) == expected_cipher_sha256, "ciphertext_hash")
    identity = certificate(recipient, pem_pin, der_pin, quarantine, deadline)
    validate_cms(encrypted, identity)
    partial = quarantine / "evidence.tar.gz.partial"
    openssl(["cms", "-decrypt", "-binary", "-inform", "DER", "-recip", str(recipient),
             "-inkey", str(private_key), "-in", str(encrypted), "-out", str(partial)], quarantine, deadline)
    os.chmod(partial, 0o600)
    manifest = validate_archive(partial, deadline)
    require(manifest["metadata"]["recipient_fingerprint"] == der_pin, "recipient_pin")
    result = quarantine / "verified-evidence.tar.gz"
    partial.rename(result)
    return result
