"""Failure projection must never copy arbitrary protected log contents."""
import unittest
from collect_historical_failure import project


class FailureProjectionTests(unittest.TestCase):
    def test_projects_only_rpc_status_and_source_location(self):
        text = 'Authorization: Bearer PRIVATE\nError: Local synthetic RPC save_client failed: HTTP 409, code PT409\n at x (/tmp/private/tests/prescriptions/local-fulfillment.ts:55:9)\nSQL VALUES(SECRET);'
        self.assertEqual(project(text), dict(rpc_failures=[dict(rpc='save_client', http_status=409, code='PT409')], fulfillment_source_lines=[55], raw_log_disclosed=False))

    def test_ignores_other_errors_json_and_secret_headers(self):
        self.assertEqual(project('Error: PRIVATE {"access_token":"SECRET"}\nSQLSTATE 42501\n'), dict(rpc_failures=[], fulfillment_source_lines=[], raw_log_disclosed=False))

    def test_refuses_unbounded_log(self):
        with self.assertRaises(ValueError):
            project('x' * 1048577)


if __name__ == '__main__':
    unittest.main()
