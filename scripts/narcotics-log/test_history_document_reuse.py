"""Offline source-edit controls, not Auth or stock acceptance."""
import unittest
import history_document_reuse as source


class HistoricalSourceControls(unittest.TestCase):
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
