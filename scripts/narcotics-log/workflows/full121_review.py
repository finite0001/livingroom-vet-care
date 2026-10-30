"""Genuine second-user signing/recovery; owner observations never supply Auth."""
from copy import deepcopy
from hashlib import sha256
import full121_values as v
import full121_gateway as gateway
from install_rehearsal import preserve

RPCS = frozenset(("get_controlled_record_review_event_v3", "prepare_controlled_record_review_v3",
                 "read_controlled_record_review_v3", "execute_controlled_record_review_v3"))


def transport_digest(request):
    fields = ("actor_id", "operation_id", "event_id", "policy_id", "read_eligibility_id",
              "review_eligibility_id", "decision", "reason")
    parts = [b"lrv-record-review-request-v3\n"]
    for name in fields:
        raw = request[name].encode("utf-8", errors="strict")
        parts.extend((str(len(raw)).encode() + b":", raw))
    return sha256(b"".join(parts)).hexdigest()


def run(ctx, methods, runtime, folder, query, save):
    gateway.run(ctx, methods, runtime, folder, query, save)
    http = ctx["http"]
    recorder, reviewer = ctx["users"]
    event = ctx["gateway"]["pointer"]["operation_id"]
    calls = []

    def rpc(label, name, request, actor=reviewer, status=200):
        if name not in RPCS:
            raise ValueError("Fixed review endpoint required")
        response = http.rpc(name, {"p_request": request}, actor, expected=status)
        save(folder, "record-review-" + label, response)
        calls.append({"rpc": name, "actor_id": actor["id"], "session_id": actor["session_id"], "status": status})
        return response

    target = {"actor_id": reviewer["id"], "event_id": event}
    detail = rpc("before", "get_controlled_record_review_event_v3", target)
    if detail["version"] != 3 or detail["state"] != "detail":
        raise ValueError("Original actual event must be readable by the independent reviewer")
    data = detail["data"]
    if data["summary"]["signing_state"] != "available" or data["terminal_review"] is not None:
        raise ValueError("Current source must offer an unsigned independent review")
    operation = v.uid()
    request = {**target, "operation_id": operation, "decision": "approve", "reason": v.NOTE,
               **{key: v.uid(data[key]) for key in ("policy_id", "read_eligibility_id", "review_eligibility_id")}}
    before = runtime.install.rows("before-record-review-permanent-rows")
    self_request = {**request, "actor_id": recorder["id"], "operation_id": v.uid()}
    denied = rpc("self-review-denied", "prepare_controlled_record_review_v3", self_request, recorder, 400)
    if denied.get("code") not in ("23514", "42501"):
        raise ValueError("Recorder self-review did not receive an explicit authorization rejection")
    prepared = rpc("prepare", "prepare_controlled_record_review_v3", request)
    if prepared["version"] != 3 or prepared["state"] != "prepared" or prepared["data"]["request"] != request:
        raise ValueError("Actual review preparation does not retain its exact original request")
    digest = transport_digest(request)
    if prepared["data"]["transport_digest"] != digest or prepared["data"]["operation_id"] != operation:
        raise ValueError("Independent review request framing differs")
    packet = prepared["data"]["packet"]
    if packet["event"]["id"] != event or packet["event"]["actor_id"] != recorder["id"] or packet["event"]["actor_id"] == reviewer["id"]:
        raise ValueError("Review source is not the first user's exact recorded movement")
    owned = {"actor_id": reviewer["id"], "operation_id": operation}
    if rpc("read-prepared", "read_controlled_record_review_v3", owned) != prepared:
        raise ValueError("Reading the preparation changed its original evidence")
    saved = rpc("execute", "execute_controlled_record_review_v3", owned)
    v.keys(saved, ("version", "state", "data"))
    value = v.keys(saved["data"], ("operation_id", "receipt"))
    receipt = v.keys(value["receipt"], ("version", "actor_id", "operation_id", "transport_digest", "decision", "recorded_at", "receipt_hash"))
    if (saved["version"] != 3 or saved["state"] != "saved" or value["operation_id"] != operation
            or receipt["version"] != 3 or receipt["actor_id"] != reviewer["id"]
            or receipt["operation_id"] != operation or receipt["transport_digest"] != digest or receipt["decision"] != "approve"):
        raise ValueError("Actual saved review belongs to different facts or a different reviewer")
    v.instant(receipt["recorded_at"])
    if (rpc("recover-saved", "read_controlled_record_review_v3", owned) != saved
            or rpc("idempotent-execute", "execute_controlled_record_review_v3", owned) != saved):
        raise ValueError("Original saved review changed or duplicated during recovery")
    terminal = rpc("after", "get_controlled_record_review_event_v3", target)
    if (terminal["state"] != "detail" or terminal["data"]["summary"]["signing_state"] != "terminal"
            or terminal["data"]["summary"]["review_state"] != "approved"
            or terminal["data"]["terminal_review"]["actor_id"] != reviewer["id"]
            or terminal["data"]["terminal_review"]["receipt_hash"] != receipt["receipt_hash"]):
        raise ValueError("The event's final review does not match the saved owned signature")
    # These rows are source-declared before any database observation. Every
    # existing row, including the already posted stock balance, stays identical.
    additions = {"controlled_review_v3." + name: 1 for name in ("operation_claims", "preparations", "decisions", "obligations")}
    preserve(before, runtime.install.rows("after-record-review-permanent-rows"), additions)
    proof = {"event_id": event, "request": request, "transport_digest": digest,
             "receipt": receipt, "calls": calls, "stock_and_all_existing_rows_unchanged": True,
             "original_preparation": prepared, "terminal_detail": terminal}
    ctx["record_review"] = deepcopy(proof)
    save(folder, "full121-record-review-proof", proof)
    return proof
