"""Disposable engineering-only unmasking of the failing stock preparation API.

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
        super().__init__(*args, profile="ordinary_none")
        self.result.update(kind="narcotics-stock-preparation-engineering-only-v1", engineering_only=True)

    def after_installation(self, runtime):
        root = business.installation.ROOT
        raw = business.installation.prefix.regular(root / "supabase/migrations" / business.installation.prefix.FORWARD[1]).decode()
        marker = "CREATE FUNCTION public.prepare_managed_stock_intent_v1("
        if raw.count(marker) != 1:
            raise ValueError("Exactly one source commissioning API required")
        start = raw.index(marker)
        body_start = raw.index(" AS $$", start) + len(" AS $$")
        end = raw.index("$$;", body_start)
        body = raw[body_start:end]
        static = json.loads((business.HERE / "module-expected.json").read_text())
        expected = static["properties"]["functions"]["public.prepare_managed_stock_intent_v1(jsonb)"]["body_sha256"]
        if hashlib.sha256(body.encode()).hexdigest() != expected:
            raise ValueError("Original uninstrumented source API hash differs")
        original = "raise exception 'stock_entry_request_failed'using errcode='P0001',detail='',hint='';"
        if body.count(original) != 1 or body.count("exception when others or query_canceled or assert_failure then") != 1:
            raise ValueError("Exact source exception fence required")
        program = raw[start:body_start].replace("CREATE FUNCTION", "CREATE OR REPLACE FUNCTION", 1)
        if body.count("declare q jsonb;") != 1:
            raise ValueError("Exact diagnostic declaration anchor required")
        instrumented = body.replace("declare q jsonb;", "declare diagnostic_native_context text;q jsonb;", 1)
        instrumented = instrumented.replace(original,
            "GET STACKED DIAGNOSTICS diagnostic_native_context = PG_EXCEPTION_CONTEXT;"
            "RAISE EXCEPTION USING ERRCODE=SQLSTATE,MESSAGE=SQLERRM,DETAIL=diagnostic_native_context,HINT='';", 1)
        program += instrumented + "$$;"
        wanted = hashlib.sha256(instrumented.encode()).hexdigest()
        # Ingress verifies the entire source module. Declare this one
        # engineering body in its NEW fixture descriptor as well; otherwise an
        # unrelated earlier writer correctly refuses instrumentation. Original
        # 205/206/269 descriptors and all business rows remain untouched.
        expected = business.installation.canonical(self.expected_module).replace("'", "''")
        path = "ARRAY['properties','functions','public.prepare_managed_stock_intent_v1(jsonb)','body_sha256']"
        bind = """ALTER TABLE controlled_count_v1.descriptor DISABLE TRIGGER count_history_immutable;
DO $engineering_source_binding$ DECLARE changed integer;BEGIN
 UPDATE controlled_count_v1.descriptor d SET
 definition=jsonb_set(d.definition,""" + path + ",to_jsonb('" + wanted + "'::text),false)," + """
 definition_hash=encode(sha256(convert_to(jsonb_build_object('domain','lrv.count.local_fixture.module.v1',
 'definition',jsonb_set(d.definition,""" + path + ",to_jsonb('" + wanted + "'::text),false))::text,'UTF8')),'hex')" + " WHERE d.revision=1 AND d.definition='" + expected + "'::jsonb;" + """
 GET DIAGNOSTICS changed=ROW_COUNT;
 IF changed<>1 THEN RAISE EXCEPTION 'engineering_source_binding_refused';END IF;
END$engineering_source_binding$;
ALTER TABLE controlled_count_v1.descriptor ENABLE TRIGGER count_history_immutable;
"""
        # Deliberate diagnostic DDL is committed only in this owned fixture.
        runtime.raw_query("engineering-only-unmask-one-api", "BEGIN;" + program + bind + "COMMIT;")
        checked = runtime.selected_query("engineering-instrumentation-verified",
            "select jsonb_build_object('source_body_matches',encode(sha256(convert_to(prosrc,'UTF8')),'hex')='" + wanted + "')"
            "from pg_proc where oid='public.prepare_managed_stock_intent_v1(jsonb)'::regprocedure;")
        if checked != {"source_body_matches": True}:
            raise ValueError("Engineering-only source instrumentation did not persist")

    def execute(self):
        try:
            super().execute()
        except BaseException:
            transcript = self.evidence / "http-transcript.json"
            if transcript.is_file():
                calls = json.loads(transcript.read_text())
                if calls and calls[-1]["path"] == "/rest/v1/rpc/prepare_managed_stock_intent_v1" and 400 <= calls[-1]["status"] <= 599:
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
