"""Disposable engineering-only unmasking of one failing commissioning API.

This cannot grant business acceptance. It uses actual local GoTrue and HTTP,
never fabricated claims, and always refuses a passing rehearsal result.
"""
import hashlib
import json
import os
from pathlib import Path
import sys
import time

sys.path.insert(0, str(Path(__file__).resolve().parent))
import business_rehearsal as business


class Diagnosis(business.BusinessInstallation):
    def __init__(self, *args):
        super().__init__(*args, profile="commission_all")
        self.result.update(kind="narcotics-commissioning-engineering-only-v1", engineering_only=True)

    def after_installation(self, runtime):
        root = business.installation.ROOT
        raw = business.installation.prefix.regular(root / "supabase/migrations" / business.installation.prefix.FORWARD[1]).decode()
        marker = "CREATE FUNCTION public.execute_controlled_stock_administration_v1("
        if raw.count(marker) != 1:
            raise ValueError("Exactly one source commissioning API required")
        start = raw.index(marker)
        body_start = raw.index(" AS $$", start) + len(" AS $$")
        end = raw.index("$$;", body_start)
        body = raw[body_start:end]
        static = json.loads((business.HERE / "module-expected.json").read_text())
        expected = static["properties"]["functions"]["public.execute_controlled_stock_administration_v1(jsonb)"]["body_sha256"]
        if hashlib.sha256(body.encode()).hexdigest() != expected:
            raise ValueError("Original uninstrumented source API hash differs")
        original = "raise exception 'stock_administration_request_failed'using errcode='P0001',detail='',hint='';"
        if body.count(original) != 1 or body.count("exception when others or query_canceled or assert_failure then") != 1:
            raise ValueError("Exact source exception fence required")
        program = raw[start:body_start].replace("CREATE FUNCTION", "CREATE OR REPLACE FUNCTION", 1)
        program += body.replace(original, "RAISE;", 1) + "$$;"
        runtime.raw_query("engineering-only-unmask-one-api", program)

    def execute(self):
        try:
            super().execute()
        except BaseException:
            transcript = self.evidence / "http-transcript.json"
            if transcript.is_file():
                calls = json.loads(transcript.read_text())
                if calls and calls[-1]["path"] == "/rest/v1/rpc/execute_controlled_stock_administration_v1" and calls[-1]["status"] == 400:
                    response = business.installation.prefix.regular(self.evidence / f"http-{len(calls):03d}-response.json", 2097152)
                    if hashlib.sha256(response).hexdigest() != calls[-1]["response_sha256"]:
                        raise ValueError("Original diagnostic response changed")
                    error = json.loads(response)
                    if type(error) is not dict or set(error) != {"code", "details", "hint", "message"}:
                        raise ValueError("Exact native error response required")
                    with (self.evidence / "diagnostic-native-failure.txt").open("xb") as stream:
                        stream.write(response)
            raise
        finally:
            self.result.update(application_Auth_verified=False, count_business_verified=False,
                               business_profile_verified=False, authenticated_browser_verified=False)
        raise RuntimeError("Engineering-only instrumentation can never grant acceptance")


if __name__ == "__main__":
    if sys.argv[1:] != ["--run-synthetic-local"]:
        raise ValueError("Explicit fixed local diagnosis required")
    os.umask(0o077)
    started = time.monotonic()
    layout, pins = business.source_admission()
    name = str(Path(__file__).resolve().relative_to(business.installation.ROOT))
    pins[name] = business.installation.sha(business.installation.prefix.regular(Path(__file__).resolve()))
    business.installation.execute_owned(layout, pins, started, Diagnosis)
