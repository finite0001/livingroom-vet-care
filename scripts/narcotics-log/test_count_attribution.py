"""Adversarial controls for historical-session attribution, not Auth proof."""
from copy import deepcopy
from pathlib import Path
import sys
import unittest
from uuid import UUID

sys.path.insert(0, str(Path(__file__).resolve().parent / "workflows"))
import count_audit


def uid(number):
    return str(UUID(int=number))


class CountAttributionTests(unittest.TestCase):
    def fixture(self):
        a, b = ({"id": uid(1), "session_id": uid(11)}, {"id": uid(2), "session_id": uid(12)})
        current = {a["id"]: {**a, "session_id": uid(21)}, b["id"]: {**b, "session_id": uid(22)}}
        ctx = {"users": [a, b], "ids": {"product": uid(30), "site": uid(31)}, "current_actors": current}
        actual = {"operations": [], "closures": []}
        saved = []
        for index, (action, actor) in enumerate((("start", a), ("statement", b), ("finalize", a))):
            request = {"schema_version": 1, "actor_id": actor["id"], "count_id": uid(40), "operation_id": uid(50 + index)}
            receipt = {"request_digest": "request-" + action, "receipt_digest": "receipt-" + action}
            entry = {"action": action, "request": request, "receipt": receipt}
            session = current[a["id"]]["session_id"] if action == "finalize" else actor["session_id"]
            actual["operations"].append({"operation_id": request["operation_id"], "action": action, "scope_kind": "count", "scope_id": request["count_id"],
                "actor_id": actor["id"], "original_session_id": session, "canonical_request": deepcopy(request), "receipt": deepcopy(receipt), **receipt})
            pointer = {"schema_version": 1, "actor_id": actor["id"], "operation_id": request["operation_id"], "original_action": action,
                       "scope_id": request["count_id"], "product_id": uid(30), "site_id": uid(31)}
            actual["closures"].append({"operation_id": request["operation_id"], "state": "saved", "saved_operation_id": request["operation_id"],
                "original_session_id": session, "actor_id": actor["id"], "request_digest": receipt["request_digest"], "document": {"pointer": pointer}})
            if action == "finalize":
                ctx["browser_finalization"] = {"request": request, "receipt": receipt}
                final = {"request": request, "receipt": receipt}
            else:
                saved.append(entry)
        ctx["count"] = {"agreement": {"saved": saved, "finalize": final}}
        published = []
        for index in range(3):
            pointer = {"schema_version": 2, "actor_id": a["id"], "operation_id": uid(70 + index), "original_action": "policy_publish",
                       "scope_id": uid(70 + index), "product_id": uid(30), "site_id": uid(31)}
            state = "saved" if index < 2 else "abandoned"
            actual["closures"].append({"operation_id": pointer["operation_id"], "state": state, "original_action": "policy_publish",
                "original_session_id": a["session_id"], "actor_id": a["id"], "saved_operation_id": pointer["operation_id"] if index < 2 else None,
                "document": {"pointer": deepcopy(pointer)}})
            if index < 2:
                published.append({"pointer": pointer})
        ctx["count_policy"] = {"published": published, "abandoned_pointer": pointer}
        return ctx, actual

    def test_later_logins_do_not_rewrite_earlier_attribution(self):
        ctx, actual = self.fixture()
        proof = count_audit.validate(ctx, actual)
        self.assertEqual(proof["original_requests_and_receipts"], 3)
        self.assertTrue(proof["recovery_preserves_historical_attribution"])

    def test_session_pointer_actor_and_request_substitutions_refuse(self):
        for mutation in ("session", "pointer", "policy_actor", "request", "extra"):
            ctx, actual = self.fixture()
            if mutation == "session":
                actual["operations"][1]["original_session_id"] = ctx["current_actors"][uid(2)]["session_id"]
            elif mutation == "pointer":
                actual["closures"][0]["document"]["pointer"]["scope_id"] = uid(90)
            elif mutation == "policy_actor":
                actual["closures"][-1]["actor_id"] = uid(2)
            elif mutation == "request":
                actual["operations"][0]["canonical_request"]["actor_id"] = uid(2)
            else:
                extra = deepcopy(actual["operations"][0]); extra["operation_id"] = uid(90)
                actual["operations"].append(extra)
            with self.assertRaises(ValueError, msg=mutation):
                count_audit.validate(ctx, actual)


if __name__ == "__main__":
    unittest.main()
