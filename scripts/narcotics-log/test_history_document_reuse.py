"""Offline source-edit controls, not Auth or stock acceptance."""
import unittest
from pathlib import Path
import history_document_reuse as source


class HistoricalSourceControls(unittest.TestCase):
    def test_body_grammar_is_separate_from_completed_graph_authority(self):
        for complete in(source.REUSE_BLOCK,source.SNAPSHOT_REUSE_BLOCK,source.POLICY_REUSE_BLOCK):
            self.assertNotIn('body_grammar:',complete)
        seed=source.BODY_GRAMMAR_SEED
        self.assertIn("'body_grammar:'||p_kind||':'||p_id::text",seed)
        self.assertIn("d::text is not distinct from(r->'document')::text",seed)
        self.assertIn("r->id_key=to_jsonb(p_id)",seed)
        self.assertIn('16777216',seed)
        self.assertNotIn("'reconciliation_approval'",seed)
        sql=(Path(__file__).resolve().parents[2]/'supabase/migrations/20261027223544_narcotics_count_and_stock_workflows.sql').read_text()
        start=sql.index('CREATE FUNCTION controlled_count_v1.history_scan_saved_result_graph(')
        begin=sql.index(' AS $$',start)+len(' AS $$');end=sql.index('$$;',begin);body=sql[begin:end]
        self.assertEqual(body.count(source.BODY_GRAMMAR_SEED),1)
        self.assertLess(body.index(source.BODY_GRAMMAR_ANCHOR),body.index(source.BODY_GRAMMAR_SEED))
        self.assertLess(body.index(source.BODY_GRAMMAR_SEED),body.index('history_scan_saved_registry_values('))

    def test_saved_closure_cut_preserves_initial_proof_and_non_saved_branches(self):
        sql=(Path(__file__).resolve().parents[2]/'supabase/migrations/20261027223544_narcotics_count_and_stock_workflows.sql').read_text()
        start=sql.index('CREATE OR REPLACE FUNCTION controlled_count_v1.operation_closure_deferred()')
        begin=sql.index(' AS $$',start)+len(' AS $$');end=sql.index('$$;',begin)
        candidate=sql[begin:end]
        anchor=""" if c->>'state'='saved'then perform controlled_count_v1.validate_operation_graph_v3(NEW.operation_id);
 perform controlled_count_entry_v1.assert_read_frontier();end if;"""
        self.assertEqual(candidate.count(anchor),1)
        before=candidate.replace(anchor," if c->>'state'='saved'then perform controlled_count_v1.validate_operation_graph(NEW.operation_id);end if;",1)
        after,proof=source.deduplicate_saved_closure(before)
        self.assertEqual(after,candidate)
        self.assertIn('c:=controlled_count_v1.validated_operation_closure(NEW.operation_id);',after)
        self.assertIn('validated_policy_operation_closure(NEW.operation_id);return null;',after)
        self.assertTrue(proof['whole_body_inverse'])
        with self.assertRaises(ValueError):source.deduplicate_saved_closure(before.replace("c->>'state'='saved'","c->>'state'='abandoned'"))

    def test_deferred_child_cut_preserves_the_exact_original_callback(self):
        sql=(Path(__file__).resolve().parents[2]/'supabase/migrations/20261027223544_narcotics_count_and_stock_workflows.sql').read_text()
        start=sql.index('CREATE FUNCTION controlled_count_v1.count_graph_deferred()')
        begin=sql.index(' AS $$',start)+len(' AS $$');end=sql.index('$$;',begin)
        candidate=sql[begin:end]
        anchor="""  if operation_value is null then raise exception 'count_source_invalid'using errcode='P0001',detail='',hint='';end if;
  perform controlled_count_entry_v1.assert_read_frontier();
  select o.product_id into strict product_value"""
        self.assertEqual(candidate.count(anchor),1)
        before=candidate.replace(anchor,anchor.replace('perform controlled_count_entry_v1.assert_read_frontier();',
            'perform controlled_count_v1.validate_operation_graph(operation_value);'),1)
        after,proof=source.deduplicate_deferred_operation(before)
        self.assertEqual(after,candidate)
        self.assertEqual(after.count('perform controlled_count_entry_v1.assert_read_frontier();'),2)
        self.assertNotIn('validate_operation_graph(operation_value)',after)
        self.assertEqual(after.count('perform controlled_count_v1.product_live_causes(product_value);'),1)
        self.assertIn('select o.product_id into strict product_value from controlled_count_v1.operations o where o.operation_id=operation_value;',after)
        self.assertTrue(proof['whole_body_inverse'])
        for altered in (before+' ',before.replace('o.product_id into strict','o.site_id into strict'),
                        before.replace('perform controlled_count_v1.product_live_causes(product_value);','return null;')):
            with self.assertRaises(ValueError):source.deduplicate_deferred_operation(altered)

    def registry_receipt_fixture(self):
        parent="""begin
 action_name:=p_registry->>'action';action_value:=controlled_count_v1.saved_action_values(action_name);
 request_value:=controlled_count_v1.saved_original_request_values(action_name,p_registry->'canonical_request');
 result_value:=controlled_count_v1.result_header_values(action_value->>'result_kind',p_result);
 receipt_value:=controlled_count_v1.saved_public_receipt_values(action_name,request_value,result_value,p_registry->'receipt');
 perform check_registry(receipt_value);end"""
        receipt="""declare action_value jsonb;request_value jsonb;result_value jsonb;receipt_value jsonb;
begin
 action_value:=controlled_count_v1.saved_action_values(p_action);
 request_value:=controlled_count_v1.saved_original_request_values(p_action,p_original_request);
 -- The result grammar has already run in the caller.
 result_value:=controlled_count_v1.result_header_values(action_value->>'result_kind',p_result);
 if action_value->>'request_kind'='count'then
 receipt_value:=controlled_count_v1.count_receipt_bound(p_action,request_value,p_receipt);
 else receipt_value:=controlled_count_v1.management_receipt_bound(p_action,request_value,p_receipt);end if;
 if receipt_value->'id'is distinct from result_value->'id'then raise exception 'receipt_value p_action';end if;
 return receipt_value;
end"""
        return parent,receipt

    def test_registry_inline_preserves_bindings_literals_and_whole_inverse(self):
        parent,receipt=self.registry_receipt_fixture()
        changed,call,inline,proof=source.inline_registry_receipt(parent,receipt)
        self.assertEqual(changed.replace(inline,call,1),parent)
        self.assertIn("management_receipt_bound(action_name,request_value,(p_registry->'receipt'))",inline)
        self.assertIn("'receipt_value p_action'",inline)
        self.assertIn("inline_receipt->'id'is distinct from result_value->'id'",inline)
        self.assertNotIn('return',source.code_mask(inline))
        self.assertEqual(changed.count('result_header_values('),1)
        self.assertTrue(proof['whole_registry_clone_inverse'])
        self.assertTrue(proof['complete_identifier_substitution_inverse'])

    def test_registry_inline_refuses_changed_dominance_or_callee_side_effects(self):
        parent,receipt=self.registry_receipt_fixture()
        for altered in (parent.replace('result_value:=controlled_count_v1','other:=controlled_count_v1',1),
                        parent.replace(' receipt_value:=',' result_value:=NULL;receipt_value:=',1)):
            with self.assertRaises(ValueError):source.inline_registry_receipt(altered,receipt)
        for altered in (receipt.replace(' -- The result',' perform unreviewed();\n -- The result',1),
                        receipt.replace(' return receipt_value;',' return NULL;'),
                        receipt.replace(' if action_value',' return receipt_value;\n if action_value',1)):
            with self.assertRaises(ValueError):source.inline_registry_receipt(parent,altered)

    def parent_cell_fixture(self):
        prior="perform controlled_count_v1.history_scan_historical_parent_preparation_boundary_values(parent_prep,b->'boundary',p_validated_documents);"
        call="perform controlled_count_v1.history_scan_historical_parent_preparation_cell_values(parent_prep,b->'boundary',cell_value,p_validated_documents);"
        helper="""declare actual_cells uuid[];begin
perform controlled_count_v1.historical_parent_preparation_boundary_values(p_preparation,p_boundary);
select array_agg(cell.id order by cell.id)into actual_cells from controlled_count_v1.historical_rows_controlled_stock_cells(p_boundary)cell
where cell.lot_id=(p_preparation#>>'{canonical_arguments,lot_id}')::uuid;
if p_cause_cell is null or cardinality(actual_cells)is distinct from 1 or actual_cells[1]is distinct from p_cause_cell then
raise exception 'p_boundary stays literal'using errcode='P0001',detail='',hint='';end if;end;"""
        return prior,call,helper

    def test_cell_inline_preserves_the_full_dominating_check_and_exact_inverse(self):
        prior,call,helper=self.parent_cell_fixture();original='begin '+prior+'\n'+call+' end;'
        changed,old,inline,proof=source.inline_parent_cell(original,helper)
        self.assertEqual(changed.replace(inline,old,1),original)
        self.assertIn(prior,changed)
        self.assertIn("'p_boundary stays literal'",changed)
        self.assertIn("historical_rows_controlled_stock_cells((b->'boundary'))",changed)
        self.assertIn('actual_cells[1]is distinct from cell_value',changed)
        self.assertTrue(proof['whole_management_clone_inverse'])

    def test_cell_inline_refuses_reordering_changed_arguments_writes_or_return(self):
        prior,call,helper=self.parent_cell_fixture()
        for parent in [call+'\n'+prior,prior+"\nb:='{}';\n"+call,
                       prior+'\nupdate public.pets set name=name;\n'+call,
                       prior+'\n'+call.replace('cell_value','other_cell')]:
            with self.assertRaises(ValueError):source.inline_parent_cell(parent,helper)
        with self.assertRaises(ValueError):source.inline_parent_cell(prior+'\n'+call,helper.replace('end;','return;end;'))

    def test_optional_function_terminator_becomes_required_nested_delimiter(self):
        prior,call,helper=self.parent_cell_fixture()
        helper=helper[:-1]+' '
        changed,old,inline,proof=source.inline_parent_cell(prior+'\n'+call,helper)
        self.assertTrue(inline.rstrip().endswith(';'))
        self.assertTrue(proof['nested_block_delimiter_added'])
        self.assertEqual(changed.replace(inline,old,1),prior+'\n'+call)

    def test_leading_helper_newlines_cannot_shift_identifier_replacement_offsets(self):
        prior,call,helper=self.parent_cell_fixture()
        for prefix in ('\n','\n\n'):
            changed,old,inline,proof=source.inline_parent_cell(prior+'\n'+call,prefix+helper)
            self.assertIn("historical_rows_controlled_stock_cells((b->'boundary'))cell",inline)
            self.assertIn("(parent_prep#>>'{canonical_arguments,lot_id}')",inline)
            self.assertIn('actual_cells[1]is distinct from cell_value then',inline)
            self.assertTrue(proof['complete_identifier_substitution_inverse'])

    def test_policy_seed_proves_original_grammar_before_publishing_full_document(self):
        for name in ('preparation_row','approval_row','execution_row','resolution_row'):
            sql=source.seed_policy_grammar(name)
            self.assertLess(sql.index('perform controlled_count_v1.policy_values(grammar_document)'),
                            sql.index('validated_documents:=validated_documents||'))
            self.assertIn('grammar_document->\'version\'=to_jsonb(grammar_row.version)',sql)
            self.assertIn('16777216',sql)
            expected="{document,policy,id}"if name in('execution_row','resolution_row')else"->>'policy_id'"
            self.assertIn(expected,sql)
        with self.assertRaises(ValueError):source.seed_policy_grammar('unreviewed_expression')

    def test_nested_calls_recover_original_bytes_and_leave_literals_untouched(self):
        body = '''begin
 select controlled_count_v1.readcore_x((1+(2)),controlled_count_v1.readcore_y(')'));
 -- controlled_count_v1.readcore_x(ignored)
 perform z('controlled_count_v1.readcore_x(ignored)', $$controlled_count_v1.readcore_y(ignored)$$);
 /* outer /* controlled_count_v1.readcore_x(ignored) */ still a comment */
end'''
        mapping = {'controlled_count_v1.readcore_x': 'controlled_count_v1.history_scan_x',
                   'controlled_count_v1.readcore_y': 'controlled_count_v1.history_scan_y'}
        changed, count = source.retarget_calls(body, mapping)
        self.assertEqual(count, 2)
        self.assertIn("history_scan_y(')',p_validated_documents),p_validated_documents)", changed)
        self.assertIn('-- controlled_count_v1.readcore_x(ignored)', changed)
        self.assertIn('$$controlled_count_v1.readcore_y(ignored)$$', changed)
        inverse, inverse_count = source.retarget_calls(changed, {v: k for k, v in mapping.items()}, inverse=True)
        self.assertEqual((inverse, inverse_count), (body, 2))

    def test_escaped_strings_and_quoted_identifiers_are_not_code(self):
        body = r'''select E'escaped \' controlled_count_v1.readcore_x(ignored)', "controlled_count_v1.readcore_x(ignored)", controlled_count_v1.readcore_y(1);'''
        self.assertEqual(source.qualified_calls(body), {'controlled_count_v1.readcore_y'})
        self.assertEqual(len(source.code_mask(body)), len(body))

    def test_closure_context_uses_outer_map_and_preserves_complete_inverse(self):
        body = "begin perform controlled_count_v1.readcore_operation_closure_required(item.operation_id); end;"
        mapping = {'controlled_count_v1.readcore_operation_closure_required':
                   'controlled_count_v1.history_scan_operation_closure_required'}
        changed, count = source.retarget_calls(body, mapping, argument='validated_documents')
        self.assertEqual(count, 1)
        self.assertIn('(item.operation_id,validated_documents)', changed)
        inverse, inverse_count = source.retarget_calls(
            changed, {v: k for k, v in mapping.items()}, inverse=True,
            argument='validated_documents')
        self.assertEqual((inverse, inverse_count), (body, 1))
        with self.assertRaises(ValueError):
            source.retarget_calls(changed, {v: k for k, v in mapping.items()}, inverse=True)
        with self.assertRaises(ValueError):
            source.retarget_calls(body, mapping, argument='validated_documents); perform unsafe(')

    def test_incomplete_source_or_argument_inverse_refuses(self):
        for text in ("select 'unclosed", '/* unclosed', 'select $tag$unclosed'):
            with self.assertRaises(ValueError):
                source.code_mask(text)
        mapping = {'controlled_count_v1.readcore_x': 'controlled_count_v1.history_scan_x'}
        with self.assertRaises(ValueError):
            source.retarget_calls('select controlled_count_v1.readcore_x((1);', mapping)
        with self.assertRaises(ValueError):
            source.retarget_calls('select controlled_count_v1.history_scan_x(1);', {v: k for k, v in mapping.items()}, inverse=True)


if __name__ == '__main__':
    unittest.main()
