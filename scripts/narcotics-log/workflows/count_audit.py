"""Compare committed count requests, receipts and original real sessions."""
import full121_queries as sql


def program():
    return sql.read("""do $count_audit_capacity$begin
 if(select count(*)from controlled_count_v1.operations)>32
 or(select count(*)from controlled_count_v1.operation_closures)>32 then
 raise exception 'finite_count_audit_capacity';end if;end$count_audit_capacity$;
 select jsonb_build_object(
 'operations',(select coalesce(jsonb_agg(to_jsonb(o)order by operation_id),'[]'::jsonb)from controlled_count_v1.operations o),
 'closures',(select coalesce(jsonb_agg(to_jsonb(c)order by operation_id),'[]'::jsonb)from controlled_count_v1.operation_closures c));""")


def validate(context, actual):
    actors = {user["id"]: user for user in context["users"]}
    source = []
    for name, proof in context.get("count", {}).items():
        if name == "cancel_and_abandon":
            source += [{"action": "start", "request": proof["start_request"], "receipt": proof["start_receipt"]},
                       {"action": "cancel", "request": proof["cancellation_request"], "receipt": proof["cancellation_receipt"]}]
        else:
            source += proof["saved"]
            if "finalize" in proof:
                source.append({"action": "finalize", **proof["finalize"]})
    source += context.get("management", {}).get("saved", [])
    expected = {entry["request"]["operation_id"]: entry for entry in source}
    operations = {entry["operation_id"]: entry for entry in actual["operations"]}
    closures = {entry["operation_id"]: entry for entry in actual["closures"]}
    if len(expected) != len(source) or len(operations) != len(actual["operations"]) or set(operations) != set(expected) or len(closures) != len(actual["closures"]):
        raise ValueError("Complete committed count operation membership differs")
    for identifier, entry in expected.items():
        request, receipt = entry["request"], entry["receipt"]
        row = operations[identifier]
        actor = actors[request["actor_id"]]
        kind = "count" if "count_id" in request else "cause" if entry["action"] == "cause_resolve" else "reconciliation"
        scope = request[kind + "_id"]
        session = actor["session_id"]
        browser = context.get("browser_finalization")
        if browser is not None and identifier == browser["request"]["operation_id"]:
            session = context["current_actors"][actor["id"]]["session_id"]
        if row["action"] != entry["action"] or row["scope_kind"] != kind or row["scope_id"] != scope or row["actor_id"] != actor["id"] or row["original_session_id"] != session or row["canonical_request"] != request or row["receipt"] != receipt or row["request_digest"] != receipt["request_digest"] or row["receipt_digest"] != receipt["receipt_digest"]:
            raise ValueError("Committed count request/receipt/original real session differs")
        closure = closures[identifier]
        pointer = dict(schema_version=1, actor_id=actor["id"], operation_id=identifier,
            original_action=entry["action"], scope_id=scope,
            product_id=context["ids"]["product"], site_id=context["ids"]["site"])
        if closure["state"] != "saved" or closure["saved_operation_id"] != identifier or closure["original_session_id"] != session or closure["document"]["pointer"] != pointer or closure["request_digest"] != receipt["request_digest"] or closure["actor_id"] != actor["id"]:
            raise ValueError("Committed count closure changed its original operation/session")
    policy = context["count_policy"]
    remaining = set(closures) - set(expected)
    policy_ids = {entry["pointer"]["operation_id"] for entry in policy["published"]}
    abandoned_policy = policy["abandoned_pointer"]["operation_id"]
    if not (policy_ids | {abandoned_policy}) <= remaining:
        raise ValueError("Expected policy closure membership missing")
    for entry in policy["published"]:
        row = closures[entry["pointer"]["operation_id"]]
        if row["state"] != "saved" or row["actor_id"] != entry["pointer"]["actor_id"] or row["original_action"] != "policy_publish" or row["original_session_id"] != actors[entry["pointer"]["actor_id"]]["session_id"] or row["document"]["pointer"] != entry["pointer"]:
            raise ValueError("Saved policy closure changed its original pointer/session")
    row = closures[abandoned_policy]
    if row["state"] != "abandoned" or row["actor_id"] != policy["abandoned_pointer"]["actor_id"] or row["saved_operation_id"] is not None or row["original_action"] != "policy_publish" or row["document"]["pointer"] != policy["abandoned_pointer"] or row["original_session_id"] != actors[policy["abandoned_pointer"]["actor_id"]]["session_id"]:
        raise ValueError("Unsent policy crossed its terminal fence")
    remaining -= policy_ids | {abandoned_policy}
    abandoned = context.get("count", {}).get("cancel_and_abandon")
    if abandoned is not None:
        pointer = abandoned["abandoned_pointer"]
        remaining -= {pointer["operation_id"]}
        row = closures[pointer["operation_id"]]
        if row["state"] != "abandoned" or row["actor_id"] != pointer["actor_id"] or row["original_session_id"] != actors[pointer["actor_id"]]["session_id"] or row["saved_operation_id"] is not None or row["document"]["pointer"] != pointer or pointer["operation_id"] in operations:
            raise ValueError("Unsent count crossed its terminal fence")
    if remaining:
        raise ValueError("Unexpected committed count closure")
    return {"original_requests_and_receipts": len(expected), "original_real_sessions_verified": True,
            "complete_closures": len(closures), "recovery_preserves_historical_attribution": True}


def verify(context, query):
    return validate(context, query("committed-count-original-attribution", program()))
