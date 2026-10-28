"""Guard the PL/pgSQL interpolation boundary, not database/Auth acceptance."""
import re
from pathlib import Path
import unittest

import build_operational_module as operational
from history_document_reuse import code_mask
import recovery_admission_source as source
from sql_framing import split_reviewed_statements


class AdmissionSourceTests(unittest.TestCase):
    def test_injected_seal_cannot_reference_inherited_record_variables(self):
        sql = (Path(__file__).resolve().parents[2] / 'supabase/migrations'
               / '20261027223544_narcotics_count_and_stock_workflows.sql').read_text()
        names = {'acquire_shared_product_relation_frontier', 'acquire_stock_workflow_relation_frontier'}
        records = {}
        for statement in split_reviewed_statements(sql):
            match = re.match(r'^CREATE(?: OR REPLACE)? FUNCTION controlled_count_entry_v1\.([a-z_]+)\(', statement, re.I)
            if match and match[1] in names:
                body = next(iter(operational.functions(statement + ';').values()))['body']
                declaration = body[:re.search(r'\bbegin\b', body, re.I).start()]
                records[match[1]] = set(re.findall(r'\b([a-z_]+)\s+record\b', declaration, re.I))
        self.assertEqual(set(records), names)
        injected = set(re.findall(r'\b[a-z_][a-z_0-9]*\b', code_mask(source.derive()['entry_check']).lower()))
        for function, variables in records.items():
            self.assertTrue(variables, 'The inherited record-variable boundary must actually be exercised')
            self.assertFalse(variables & injected, function + ' interpolates a record-variable reference')


if __name__ == '__main__':
    unittest.main()
