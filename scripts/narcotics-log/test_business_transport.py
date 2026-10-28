"""Real loopback transport controls; no database or clinical writes."""
import hashlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import sys
import tempfile
import threading
import time
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parent / "workflows"))
import http_transport
import owner_capture


class Server(ThreadingHTTPServer):
    daemon_threads = True

    def handle_error(self, request, client_address):
        pass  # Expected peer close in the finite deadline control.


class Handler(BaseHTTPRequestHandler):
    mode = "complete"

    def log_message(self, *args):
        pass

    def do_POST(self):
        self.rfile.read(int(self.headers["Content-Length"]))
        raw = b'{"saved":true}'
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        if self.mode == "truncated":
            self.wfile.write(raw[:3])
        elif self.mode == "slow":
            for byte in raw:
                self.wfile.write(bytes([byte]))
                self.wfile.flush()
                time.sleep(.05)
        else:
            self.wfile.write(raw)


class Runtime:
    def __init__(self, limit):
        self.limit = limit

    def verify(self):
        return None

    def remaining(self, limit):
        return min(limit, self.limit)


class HttpControls(unittest.TestCase):
    def exercise(self, mode, limit=2):
        with tempfile.TemporaryDirectory(prefix="lrv-wire-control-") as directory:
            folder = Path(directory).resolve()
            folder.chmod(0o700)
            Handler.mode = mode
            server = Server(("127.0.0.1", 64661), Handler)
            thread = threading.Thread(target=server.serve_forever, kwargs={"poll_interval": .01})
            thread.start()
            try:
                transport = http_transport.Http(Runtime(limit), folder, "synthetic-public", "synthetic-admin")
                if mode == "complete":
                    status, value = transport.post("/rest/v1/rpc/prepare_managed_stock_intent_v1", {"synthetic": True})
                    self.assertEqual((status, value), (200, {"saved": True}))
                    original = transport.raw_response_at(1)
                    self.assertEqual(original["raw"], b'{"saved":true}')
                    self.assertEqual(original["response_sha256"], hashlib.sha256(original["raw"]).hexdigest())
                    (folder / "http-001-response.json").write_bytes(b'{"saved":false}')
                    with self.assertRaises(ValueError):
                        transport.raw_response_at(1)
                else:
                    started = time.monotonic()
                    with self.assertRaises((ValueError, TimeoutError, OSError)):
                        transport.post("/rest/v1/rpc/prepare_managed_stock_intent_v1", {"synthetic": True})
                    self.assertLess(time.monotonic() - started, 1)
                    self.assertFalse(transport.calls)
                    self.assertTrue((folder / "http-001-request.json").exists())
                    self.assertTrue((folder / "http-001-response.json").exists())
            finally:
                server.shutdown()
                server.server_close()
                thread.join(timeout=2)
                self.assertFalse(thread.is_alive())

    def test_original_private_http_bytes_and_hash_binding(self):
        self.exercise("complete")

    def test_short_declared_entity_is_never_a_complete_reply(self):
        self.exercise("truncated")

    def test_whole_deadline_expires_even_when_bytes_keep_arriving(self):
        self.exercise("slow", .12)

    def test_service_key_cannot_authorize_business_request(self):
        transport = http_transport.Http(Runtime(1), None, "synthetic-public", "synthetic-admin")
        with self.assertRaises(ValueError):
            transport.post("/rest/v1/rpc/prepare_managed_stock_intent_v1", {}, admin=True)

    def test_owner_pb50_retains_every_original49_byte(self):
        sql = (owner_capture.HERE / "owner-pb50.sql").read_text()
        start = sql.rindex(" capture_total_bytes:=capture_total_bytes+26;")
        end = sql.index(" if octet_length(capture_boundary::text)<>", start)
        original = (sql[:start] + sql[end:]).replace("))<>50 then", "))<>49 then")
        original = original.replace(",controlled_stock_workflow_v1.witness_operations in access share mode;", " in access share mode;")
        self.assertEqual(hashlib.sha256(original.encode()).hexdigest(), "a5410d9af1b727fa54884b62c58c848efd82eb2bcfd2cc01202fdf646b075a30")


if __name__ == "__main__":
    unittest.main()
