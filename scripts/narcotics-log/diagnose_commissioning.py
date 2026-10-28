"""Disposable engineering-only tracing of fixed count/clinical API failures.

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

TARGETS = {
    "clinical-execute": ("clinical", "execute_managed_stock_intent_v1", (
        ("public.execute_managed_stock_intent_v1(jsonb)", "stock_entry_request_failed", False),)),
    "count-finalize": ("count_agreement", "finalize_controlled_count_v1", (
        ("controlled_count_v1.dispatch_count_mutation(text,jsonb)", "count_request_failed", False),
        ("public.finalize_controlled_count_v1(jsonb)", "count_request_failed", True))),
}
TARGETS['variance-finalize'] = ('variance_reconciliation', *TARGETS['count-finalize'][1:])
TARGETS['variance-prepare'] = ('variance_reconciliation', 'prepare_controlled_count_reconciliation_v1', (
    ('controlled_count_v1.dispatch_count_management_mutation(text,jsonb)', 'count_request_failed', False),
    ('public.prepare_controlled_count_reconciliation_v1(jsonb)', 'count_request_failed', True)))

TARGETS['variance-execute'] = ('variance_reconciliation', 'execute_controlled_count_reconciliation_v1', (
    ('controlled_count_v1.dispatch_count_management_mutation(text,jsonb)', 'count_request_failed', False),
    ('public.execute_controlled_count_reconciliation_v1(jsonb)', 'count_request_failed', True)))


def instrument(raw, static, signature, failure, rethrow, *, track_execute_only=False):
    name = signature.split("(", 1)[0]
    import re
    matches = list(re.finditer(r"CREATE(?: OR REPLACE)? FUNCTION " + re.escape(name) + r"\(", raw))
    if len(matches) != 1:
        raise ValueError("Exactly one fixed diagnostic function required")
    start = matches[0].start()
    body_start = raw.index(" AS $$", start) + len(" AS $$")
    end = raw.index("$$;", body_start)
    body = raw[body_start:end]
    expected = static["properties"]["functions"][signature]["body_sha256"]
    if hashlib.sha256(body.encode()).hexdigest() != expected:
        raise ValueError("Original uninstrumented source API hash differs")
    original = "raise exception '" + failure + "'using errcode='P0001',detail='',hint='';"
    if body.count(original) != 1 or body.count("exception when others or query_canceled or assert_failure then") != 1:
        raise ValueError("Exact source exception fence required")
    if rethrow:
        changed = body.replace(original, "RAISE;", 1)
    else:
        if body.count("declare q jsonb;") != 1:
            raise ValueError("Exact diagnostic declaration anchor required")
        changed = body.replace("declare q jsonb;", "declare diagnostic_native_context text;q jsonb;", 1)
        changed = changed.replace(original,
            "GET STACKED DIAGNOSTICS diagnostic_native_context = PG_EXCEPTION_CONTEXT;"
            "RAISE EXCEPTION USING ERRCODE=SQLSTATE,MESSAGE=SQLERRM,DETAIL=diagnostic_native_context,HINT='';", 1)
        if signature in ("controlled_count_v1.dispatch_count_mutation(text,jsonb)", "controlled_count_v1.dispatch_count_management_mutation(text,jsonb)"):
            anchor = "begin\n perform controlled_count_entry_v1.count_entry_budget_required();"
            if changed.count(anchor) != 1:
                raise ValueError("Exact finalization profiling anchor required")
            tracked = "p_action='reconciliation_execute'" if track_execute_only else "p_action=ANY(ARRAY['reconciliation_prepare','reconciliation_execute','finalize'])"
            changed = changed.replace(anchor,
                "begin\n if " + tracked + "then perform pg_catalog.set_config('track_functions','all',true);end if;\n"
                " perform controlled_count_entry_v1.count_entry_budget_required();", 1)
            changed = changed.replace(
                "GET STACKED DIAGNOSTICS diagnostic_native_context = PG_EXCEPTION_CONTEXT;",
                "GET STACKED DIAGNOSTICS diagnostic_native_context = PG_EXCEPTION_CONTEXT;"
                "PERFORM pg_catalog.pg_stat_force_next_flush();", 1)
    header = raw[start:body_start].replace("CREATE FUNCTION", "CREATE OR REPLACE FUNCTION", 1)
    return header + changed + "$$;", hashlib.sha256(changed.encode()).hexdigest()



class Diagnosis(business.BusinessInstallation):
    def __init__(self, *args, target):
        self.target = target
        profile, self.api, self.functions = TARGETS[target]
        super().__init__(*args, profile=profile)
        self.result.update(kind="narcotics-fixed-api-engineering-only-v1", engineering_only=True, diagnostic_target=target)

    def after_installation(self, runtime):
        self.diagnostic_runtime = runtime
        if self.target in ("count-finalize", "variance-finalize", "variance-prepare", "variance-execute"):
            # Only this disposable diagnostic grants the database owner access
            # to timing instrumentation; no staff or application role changes.
            self.boot.sql("GRANT SET ON PARAMETER track_functions TO postgres;"
                          "GRANT EXECUTE ON FUNCTION pg_catalog.pg_stat_force_next_flush() TO postgres;", admin=True)
            granted = runtime.selected_query("engineering-timing-permission", "select jsonb_build_object("
                "'track_functions',has_parameter_privilege('postgres','track_functions','SET'),"
                "'flush',has_function_privilege('postgres','pg_catalog.pg_stat_force_next_flush()','EXECUTE'));")
            if granted != {"track_functions": True, "flush": True}:
                raise ValueError("Disposable timing permission was not established")
        root = business.installation.ROOT
        raw = business.installation.prefix.regular(root / "supabase/migrations" / business.installation.prefix.FORWARD[1]).decode()
        static = json.loads((business.HERE / "module-expected.json").read_text())
        programs = []
        changed_definition = json.loads(business.installation.canonical(self.expected_module))
        wanted = {}
        for signature, failure, rethrow in self.functions:
            program, digest = instrument(raw, static, signature, failure, rethrow, track_execute_only=self.target == "variance-execute")
            programs.append(program)
            changed_definition["properties"]["functions"][signature]["body_sha256"] = digest
            wanted[signature] = digest
        expected = business.installation.canonical(self.expected_module).replace("'", "''")
        changed = business.installation.canonical(changed_definition).replace("'", "''")
        # Only this NEW descriptor in this owned engineering database changes.
        # Original sealed descriptors and all business rows remain untouched.
        bind = """ALTER TABLE controlled_count_v1.descriptor DISABLE TRIGGER count_history_immutable;
DO $engineering_source_binding$ DECLARE changed integer;BEGIN
 UPDATE controlled_count_v1.descriptor d SET definition='""" + changed + """'::jsonb,
 definition_hash=encode(sha256(convert_to(jsonb_build_object('domain','lrv.count.local_fixture.module.v1',
 'definition','""" + changed + """'::jsonb)::text,'UTF8')),'hex')
 WHERE d.revision=1 AND d.definition='""" + expected + """'::jsonb;
 GET DIAGNOSTICS changed=ROW_COUNT;
 IF changed<>1 THEN RAISE EXCEPTION 'engineering_source_binding_refused';END IF;
END$engineering_source_binding$;
ALTER TABLE controlled_count_v1.descriptor ENABLE TRIGGER count_history_immutable;
"""
        runtime.raw_query("engineering-only-unmask-fixed-api", "BEGIN;" + "\n".join(programs) + bind + "COMMIT;")
        for index, (signature, digest) in enumerate(wanted.items()):
            checked = runtime.selected_query("engineering-instrumentation-verified-" + str(index),
                "select jsonb_build_object('source_body_matches',encode(sha256(convert_to(prosrc,'UTF8')),'hex')='" + digest + "')"
                "from pg_proc where oid='" + signature + "'::regprocedure;")
            if checked != {"source_body_matches": True}:
                raise ValueError("Engineering-only source instrumentation did not persist")

    def execute(self):
        try:
            super().execute()
        except BaseException:
            transcript = self.evidence / "http-transcript.json"
            if transcript.is_file():
                calls = json.loads(transcript.read_text())
                if calls and calls[-1]["path"] == "/rest/v1/rpc/" + self.api and 400 <= calls[-1]["status"] <= 599:
                    response = business.installation.prefix.regular(self.evidence / f"http-{len(calls):03d}-response.json", 2097152)
                    if hashlib.sha256(response).hexdigest() != calls[-1]["response_sha256"]:
                        raise ValueError("Original diagnostic response changed")
                    error = json.loads(response)
                    if type(error) is not dict or set(error) != {"code", "details", "hint", "message"}:
                        raise ValueError("Exact native error response required")
                    with (self.evidence / ("diagnostic-native-failure-" + self.target + ".txt")).open("xb") as stream:
                        stream.write(response)
            raise
        finally:
            if self.target in ("count-finalize", "variance-finalize", "variance-prepare", "variance-execute") and hasattr(self, "diagnostic_runtime"):
                try:
                    costs = self.diagnostic_runtime.selected_query("engineering-function-costs", """
select jsonb_build_object('engineering_only',true,'scope','fixed API nested user functions; SQL inlining may omit individual functions',
'functions',(select coalesce(jsonb_agg(to_jsonb(s)order by s.self_time desc,s.signature),'[]'::jsonb)
from(select funcid::regprocedure::text as signature,calls,total_time,self_time
from pg_stat_user_functions where schemaname in('public','controlled_count_v1','controlled_count_entry_v1',
'controlled_stock_workflow_v1','controlled_review','controlled_review_v3')
order by self_time desc,funcid limit 80)s));""")
                    business.save(self.evidence, "diagnostic-function-costs", costs)
                except Exception as error:
                    business.save(self.evidence, "diagnostic-function-costs", {
                        "engineering_only": True, "available": False, "error_type": type(error).__name__})
            self.result.update(application_Auth_verified=False, count_business_verified=False,
                               business_profile_verified=False, authenticated_browser_verified=False)
        raise RuntimeError("Engineering-only instrumentation can never grant acceptance")


if __name__ == "__main__":
    if len(sys.argv) != 4 or sys.argv[1:3] != ["--run-synthetic-local", "--target"] or sys.argv[3] not in TARGETS:
        raise ValueError("Explicit fixed local diagnosis required")
    from functools import partial
    os.umask(0o077)
    started = time.monotonic()
    layout, pins = business.source_admission()
    name = str(Path(__file__).resolve().relative_to(business.installation.ROOT))
    pins[name] = business.installation.sha(business.installation.prefix.regular(Path(__file__).resolve()))
    business.installation.execute_owned(layout, pins, started, partial(Diagnosis, target=sys.argv[3]))
