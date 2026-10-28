"""Original linked requests determine audit scope without changing requests."""
from copy import deepcopy
import unittest

from count_attribution import original_scope


class LinkedAttributionControls(unittest.TestCase):
    def context(self):
        return {'management': {'saved': [
            {'action': 'reconciliation_prepare', 'request': {'preparation_id': 'prep', 'reconciliation_id': 'rec'}},
            {'action': 'reconciliation_approve', 'request': {'approval_id': 'approval', 'preparation_id': 'prep'}},
            {'action': 'reconciliation_execute', 'request': {'execution_id': 'execution', 'preparation_id': 'prep', 'approval_id': 'approval'}},
            {'action': 'reconciliation_confirm', 'request': {'confirmation_id': 'confirm', 'execution_id': 'execution'}},
        ]}}

    def test_all_management_scopes_follow_original_links_without_request_mutation(self):
        context = self.context(); before = deepcopy(context)
        for entry in context['management']['saved']:
            self.assertEqual(original_scope(context, entry, 'reconciliation'), 'rec')
            if entry['action'] != 'reconciliation_prepare':
                self.assertNotIn('reconciliation_id', entry['request'])
        self.assertEqual(context, before)

    def test_count_and_cause_scope_still_use_their_exact_original_request_fields(self):
        self.assertEqual(original_scope({}, {'action': 'start', 'request': {'count_id': 'count'}}, 'count'), 'count')
        self.assertEqual(original_scope({}, {'action': 'cause_resolve', 'request': {'cause_id': 'cause'}}, 'cause'), 'cause')

    def test_missing_duplicate_or_mismatched_source_links_refuse(self):
        for action in ('reconciliation_approve', 'reconciliation_execute', 'reconciliation_confirm'):
            context = self.context()
            entry = next(e for e in context['management']['saved'] if e['action'] == action)
            sources = ('reconciliation_prepare',) if action == 'reconciliation_approve' else ('reconciliation_prepare', 'reconciliation_approve') if action == 'reconciliation_execute' else ('reconciliation_prepare', 'reconciliation_approve', 'reconciliation_execute')
            for source_action in sources:
                for duplicate in (False, True):
                    altered = deepcopy(context)
                    source = next(e for e in altered['management']['saved'] if e['action'] == source_action)
                    if duplicate:
                        altered['management']['saved'].append(deepcopy(source))
                    else:
                        altered['management']['saved'].remove(source)
                    with self.assertRaises(ValueError):
                        original_scope(altered, entry, 'reconciliation')
        for action in ('reconciliation_execute', 'reconciliation_confirm'):
            context = self.context()
            entry = next(e for e in context['management']['saved'] if e['action'] == action)
            context['management']['saved'][1]['request']['preparation_id'] = 'another-preparation'
            with self.assertRaises(ValueError):
                original_scope(context, entry, 'reconciliation')


class FullLinkedAttributionControls(unittest.TestCase):
    def fixture(self):
        from test_count_attribution import CountAttributionTests, uid
        context, actual = CountAttributionTests().fixture()
        a, b = context['users']; reconciliation = uid(300); preparation = uid(301)
        approval = uid(302); execution = uid(303)
        entries = [
            ('reconciliation_prepare', a, {'reconciliation_id': reconciliation, 'preparation_id': preparation}),
            ('reconciliation_approve', b, {'preparation_id': preparation, 'approval_id': approval}),
            ('reconciliation_execute', a, {'preparation_id': preparation, 'approval_id': approval, 'execution_id': execution}),
            ('reconciliation_confirm', b, {'execution_id': execution, 'confirmation_id': uid(304)})]
        saved = []
        for index, (action, actor, data) in enumerate(entries):
            operation = uid(310 + index)
            request = dict(schema_version=1, actor_id=actor['id'], operation_id=operation,
                           product_id=context['ids']['product'], site_id=context['ids']['site'], **data)
            receipt = dict(request_digest='request-' + action, receipt_digest='receipt-' + action)
            saved.append(dict(action=action, request=request, receipt=receipt))
            actual['operations'].append(dict(operation_id=operation, action=action,
                scope_kind='reconciliation', scope_id=reconciliation, actor_id=actor['id'],
                original_session_id=actor['session_id'], canonical_request=deepcopy(request),
                receipt=deepcopy(receipt), **receipt))
            pointer = dict(schema_version=1, actor_id=actor['id'], operation_id=operation,
                original_action=action, scope_id=reconciliation, **context['ids'])
            # The actual pointer uses public source key names, not fixture aliases.
            pointer['product_id'] = pointer.pop('product'); pointer['site_id'] = pointer.pop('site')
            actual['closures'].append(dict(operation_id=operation, state='saved',
                saved_operation_id=operation, original_session_id=actor['session_id'],
                actor_id=actor['id'], request_digest=receipt['request_digest'], document=dict(pointer=pointer)))
        context['management'] = dict(saved=saved)
        return context, actual

    def test_full_verifier_admits_linked_scopes_and_retains_original_requests(self):
        from count_attribution import validate
        context, actual = self.fixture(); before = deepcopy(context)
        result = validate(context, actual)
        self.assertEqual(result['original_requests_and_receipts'], 7)
        self.assertEqual(context, before)

    def test_actual_scope_pointer_session_and_canonical_request_corruption_refuse(self):
        from count_attribution import validate
        for mutation in ('scope', 'pointer', 'session', 'request'):
            context, actual = self.fixture(); before = deepcopy(context)
            if mutation == 'scope':
                actual['operations'][-1]['scope_id'] = 'another-scope'
            elif mutation == 'pointer':
                actual['closures'][-1]['document']['pointer']['scope_id'] = 'another-scope'
            elif mutation == 'session':
                actual['operations'][-1]['original_session_id'] = 'another-session'
            else:
                actual['operations'][-1]['canonical_request']['reconciliation_id'] = 'manufactured-key'
            with self.assertRaises(ValueError, msg=mutation):
                validate(context, actual)
            self.assertEqual(context, before)


if __name__ == '__main__':
    unittest.main()
