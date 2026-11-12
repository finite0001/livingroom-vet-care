"""Exercise actual PostgREST conflict responses on the owned synthetic fixture.

No hosted URL or credentials are accepted. The gateway binds an ephemeral
loopback port and shares only this harness's disposable Docker network.
"""
import base64
import hashlib
import hmac
import http.client
import json
import re
import subprocess
import time
import urllib.error
import urllib.request


def verify_conflict_http(database, actor, cases):
    if not re.fullmatch(r"lrv-appointment-restock-[a-f0-9]{10}", database):
        raise ValueError("Owned disposable appointment fixture required")
    network, gateway = database + "-network", database + "-gateway"
    secret = "synthetic-local-conflict-proof-secret-32-bytes"

    def command(*args):
        result = subprocess.run(args, capture_output=True, text=True, timeout=60)
        if result.returncode:
            raise RuntimeError(result.stderr)
        return result.stdout.strip()

    def encoded(value):
        return base64.urlsafe_b64encode(value).decode().rstrip("=")

    signed = encoded(b'{"alg":"HS256","typ":"JWT"}') + "." + encoded(json.dumps({
        "sub": actor, "role": "authenticated", "exp": int(time.time()) + 120,
    }).encode())
    token = signed + "." + encoded(hmac.new(secret.encode(), signed.encode(), hashlib.sha256).digest())
    try:
        command("docker", "network", "create", network)
        command("docker", "network", "connect", network, database)
        command("docker", "run", "--rm", "-d", "--name", gateway, "--network", network,
                "-p", "127.0.0.1::3000", "-e", f"PGRST_DB_URI=postgresql://postgres@{database}:5432/postgres",
                "-e", "PGRST_DB_ANON_ROLE=anon", "-e", "PGRST_JWT_SECRET=" + secret,
                "public.ecr.aws/supabase/postgrest:v16.3")
        binding = command("docker", "port", gateway, "3000/tcp")
        if not re.fullmatch(r"127\.0\.0\.1:[0-9]+", binding):
            raise ValueError("Exact loopback gateway binding required")
        origin = "http://" + binding
        for _ in range(50):
            try:
                with urllib.request.urlopen(origin, timeout=.5) as response:
                    assert response.status == 200
                    break
            except (urllib.error.URLError, TimeoutError, ConnectionError, http.client.HTTPException):
                time.sleep(.1)
        else:
            raise RuntimeError("Owned gateway did not become ready")
        for name, payload in cases:
            request = urllib.request.Request(origin + "/rpc/" + name,
                data=json.dumps(payload).encode(), headers={
                    "Authorization": "Bearer " + token, "Content-Type": "application/json",
                })
            try:
                with urllib.request.urlopen(request, timeout=5):
                    raise AssertionError("Stale operation unexpectedly succeeded")
            except urllib.error.HTTPError as error:
                reply = json.loads(error.read())
                assert error.code == 409 and reply["code"] == "PT409", (error.code, reply)
        print(f"PostgREST16.3: all {len(cases)} real stale requests returned HTTP409/PT409.")
    finally:
        subprocess.run(["docker", "rm", "-f", gateway], capture_output=True, timeout=20)
        subprocess.run(["docker", "network", "disconnect", network, database], capture_output=True, timeout=20)
        subprocess.run(["docker", "network", "rm", network], capture_output=True, timeout=20)
