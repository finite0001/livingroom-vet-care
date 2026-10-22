"""Real OpenSSL roundtrips and hostile evidence inputs; never launches a database."""
import hashlib
import gzip
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tarfile
import tempfile
import time
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("ci_bootstrap_crypto", ROOT / "scripts/ci_bootstrap_crypto.py")
crypto = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = crypto
spec.loader.exec_module(crypto)


class CryptoHarness(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.keys = tempfile.TemporaryDirectory(prefix="lrv-crypto-test-keys-")
        cls.keyroot = Path(cls.keys.name)
        for name in ("a", "b"):
            subprocess.run(["openssl", "req", "-x509", "-newkey", "rsa:4096", "-noenc",
                            "-keyout", str(cls.keyroot / (name + ".key")),
                            "-out", str(cls.keyroot / (name + ".pem")), "-days", "1", "-subj", "/CN=synthetic-evidence-test",
                            "-addext", "keyUsage=critical,keyEncipherment", "-addext", "basicConstraints=critical,CA:FALSE"],
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True)
        cls.cert = cls.keyroot / "a.pem"
        cls.key = cls.keyroot / "a.key"
        cls.pem_pin = crypto.sha256_file(cls.cert)
        cls.der_pin = hashlib.sha256(subprocess.check_output(["openssl", "x509", "-in", str(cls.cert), "-outform", "DER"])).hexdigest()

    @classmethod
    def tearDownClass(cls):
        cls.keys.cleanup()

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="lrv-crypto-test-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.capture = self.root / "capture"
        self.capture.mkdir(mode=0o700)
        self.private = self.root / "private"
        self.private.mkdir(mode=0o700)
        self.upload = self.root / "upload"
        (self.capture / "nested").mkdir(mode=0o700)
        self.secret = b"SYNTHETIC_PRIVATE_SENTINEL\x00\xff\r\n"
        (self.capture / "nested/config.toml").write_bytes(self.secret)
        (self.capture / "stderr.bin").write_bytes(self.secret * 2000)
        (self.capture / "empty").write_bytes(b"")

    def seal(self):
        return crypto.seal(self.capture, self.private, self.upload, {"stage": "synthetic"},
                           self.cert, self.pem_pin, self.der_pin)

    def decrypt(self, encrypted=None, key=None):
        encrypted = encrypted or self.upload / "evidence.cms"
        return crypto.decrypt_verified(encrypted, crypto.sha256_file(encrypted), self.cert,
                                       key or self.key, self.root / "quarantine",
                                       pem_pin=self.pem_pin, der_pin=self.der_pin)

    def test_binary_roundtrip_and_public_ciphertext_only(self):
        result = self.seal()
        self.assertEqual(set(p.name for p in self.upload.iterdir()), {"evidence.cms"})
        self.assertNotIn(self.secret, json.dumps(result).encode())
        self.assertNotIn(self.secret, (self.upload / "evidence.cms").read_bytes())
        archive = self.decrypt()
        with tarfile.open(archive, "r:gz") as tar:
            self.assertEqual(tar.extractfile("capture/nested/config.toml").read(), self.secret)
            self.assertEqual(tar.extractfile("capture/empty").read(), b"")
            manifest = json.load(tar.extractfile("manifest.json"))
        self.assertEqual(manifest["entries"], crypto.snapshot(self.capture, time.monotonic() + 20))

    def test_randomized_ciphertexts(self):
        first = self.seal()["ciphertext_sha256"]
        other = self.root / "private2"
        other.mkdir(mode=0o700)
        result = crypto.seal(self.capture, other, self.root / "upload2", {}, self.cert, self.pem_pin, self.der_pin)
        self.assertNotEqual(first, result["ciphertext_sha256"])

    def test_wrong_key_never_promotes(self):
        self.seal()
        with self.assertRaises(crypto.EvidenceError):
            self.decrypt(key=self.keyroot / "b.key")
        self.assertFalse((self.root / "quarantine/verified-evidence.tar.gz").exists())

    def test_corrupt_tag_never_promotes(self):
        self.seal()
        path = self.upload / "evidence.cms"
        data = bytearray(path.read_bytes())
        data[-1] ^= 1
        path.write_bytes(data)
        with self.assertRaises(crypto.EvidenceError):
            self.decrypt()
        self.assertFalse((self.root / "quarantine/verified-evidence.tar.gz").exists())

    def test_corrupt_ciphertext_never_promotes(self):
        self.seal()
        path = self.upload / "evidence.cms"
        data = bytearray(path.read_bytes())
        data[-40] ^= 1
        path.write_bytes(data)
        with self.assertRaises(crypto.EvidenceError):
            self.decrypt()
        self.assertFalse((self.root / "quarantine/verified-evidence.tar.gz").exists())

    def test_tar_read_ahead_cannot_hide_trailing_payload(self):
        raw = io.BytesIO()
        manifest = b'{"schema":1,"metadata":{},"entries":{}}'
        with tarfile.open(fileobj=raw, mode="w") as tar:
            info = tarfile.TarInfo("manifest.json"); info.size = len(manifest)
            tar.addfile(info, io.BytesIO(manifest))
        data = bytearray(raw.getvalue())
        data[2048:2062] = b"HIDDEN-PAYLOAD!"
        archive = self.root / "tail.tar.gz"
        archive.write_bytes(gzip.compress(data))
        with self.assertRaisesRegex(crypto.EvidenceError, "archive_trailing"):
            crypto.validate_archive(archive, time.monotonic() + 20)

    def test_duplicate_manifest_json_and_member_refused(self):
        for index in (0, 1):
            archive = self.root / f"duplicate-{index}.tar.gz"
            manifest = (b'{"schema":1,"schema":1,"entries":{}}' if index == 0 else
                        json.dumps({"schema": 1, "entries": {"x": {"kind": "file", "mode": 0o600, "size": 0, "sha256": hashlib.sha256(b"").hexdigest()}}}).encode())
            with tarfile.open(archive, "w:gz") as tar:
                info = tarfile.TarInfo("manifest.json"); info.size = len(manifest)
                tar.addfile(info, io.BytesIO(manifest))
                if index:
                    for _ in range(2):
                        info = tarfile.TarInfo("capture/x"); info.mode = 0o600
                        tar.addfile(info, io.BytesIO(b""))
            with self.assertRaises(crypto.EvidenceError):
                crypto.validate_archive(archive, time.monotonic() + 20)

    def test_truncation_and_trailing_junk_are_refused(self):
        self.seal()
        original = (self.upload / "evidence.cms").read_bytes()
        identity = crypto.certificate(self.cert, self.pem_pin, self.der_pin, self.private, time.monotonic() + 20)
        for index, data in enumerate((original[:-1], original[:20], original + b"junk")):
            with self.subTest(index=index):
                path = self.root / str(index)
                path.write_bytes(data)
                with self.assertRaises(crypto.EvidenceError):
                    crypto.validate_cms(path, identity)

    def test_wrong_profile_and_multiple_recipients_are_refused(self):
        self.seal()
        identity = crypto.certificate(self.cert, self.pem_pin, self.der_pin, self.private, time.monotonic() + 20)
        for index, args in enumerate((
            ["-aes-256-cbc", str(self.cert)],
            ["-aes-256-gcm", str(self.cert), str(self.keyroot / "b.pem")],
            ["-aes-256-gcm", str(self.cert)],  # default PKCS1 transport is forbidden
        )):
            path = self.root / f"wrong-{index}.cms"
            subprocess.run(["openssl", "cms", "-encrypt", "-binary", "-outform", "DER", "-in", str(self.private / "evidence.tar.gz"), "-out", str(path), *args], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            with self.assertRaises(crypto.EvidenceError):
                crypto.validate_cms(path, identity)

    def test_mismatched_pin_and_recipient(self):
        with self.assertRaises(crypto.EvidenceError):
            crypto.seal(self.capture, self.private, self.upload, {}, self.cert, "0" * 64, self.der_pin)
        self.assertFalse(self.upload.exists())

    def test_symlink_hardlink_and_fifo_fail_closed(self):
        path = self.capture / "bad"
        for kind in ("symlink", "hardlink", "fifo"):
            with self.subTest(kind=kind):
                if kind == "symlink":
                    path.symlink_to(self.capture / "empty")
                elif kind == "hardlink":
                    os.link(self.capture / "empty", path)
                else:
                    os.mkfifo(path)
                with self.assertRaises(crypto.EvidenceError):
                    crypto.snapshot(self.capture, time.monotonic() + 20)
                path.unlink()

    def test_limits_and_existing_upload_refuse(self):
        with patch.object(crypto, "MAX_SOURCE", 10):
            with self.assertRaisesRegex(crypto.EvidenceError, "source_limit"):
                self.seal()
        self.upload.mkdir()
        with self.assertRaisesRegex(crypto.EvidenceError, "upload_exists"):
            self.seal()

    def test_archive_corruption_member_and_manifest_refused(self):
        for index, name in enumerate(("capture/../escape", "capture/empty", "capture/missing")):
            archive = self.root / f"bad-{index}.tar.gz"
            manifest = {"schema": 1, "metadata": {}, "entries": {"empty": {"kind": "file", "mode": 0o600, "size": 1, "sha256": "0" * 64}}}
            with tarfile.open(archive, "w:gz") as tar:
                raw = json.dumps(manifest).encode()
                info = tarfile.TarInfo("manifest.json"); info.size = len(raw)
                tar.addfile(info, io.BytesIO(raw))
                info = tarfile.TarInfo(name); info.mode = 0o600; info.size = 1
                tar.addfile(info, io.BytesIO(b"x"))
            with self.assertRaises(crypto.EvidenceError):
                crypto.validate_archive(archive, time.monotonic() + 20)

    def test_custody_public_certificate_matches_committed_pins(self):
        identity = crypto.certificate(ROOT / "scripts/ci-evidence/bootstrap-recipient.pem",
                                      crypto.RECIPIENT_PEM_SHA256, crypto.RECIPIENT_DER_SHA256,
                                      self.private, time.monotonic() + 20)
        self.assertEqual(len(identity), 2)


if __name__ == "__main__":
    unittest.main()
