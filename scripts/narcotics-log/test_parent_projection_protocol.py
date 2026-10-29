"""Source-control refusals; not PostgreSQL or Auth acceptance."""
import hashlib
import unittest

from parent_projection_protocol import ANCHOR, instrument


class ProjectionSourceControls(unittest.TestCase):
    def fixture(self):
        body = '\nBEGIN\n' + ANCHOR + ' RETURN NULL;\nEND '
        sql = 'CREATE FUNCTION controlled_count_v1.reconciliation_live_causes(p_scope jsonb) RETURNS jsonb LANGUAGE plpgsql AS $$' + body + '$$;'
        return sql, hashlib.sha256(body.encode()).hexdigest()

    def test_only_exact_admitted_source_gets_the_guard_spy(self):
        source, digest = self.fixture()
        changed = instrument(source, digest)
        self.assertIn('synthetic_projection_guard_reached', changed)
        self.assertIn('narcotics_parent_projection_count.reconciliation_live_causes', changed)

    def test_changed_or_duplicate_source_refuses(self):
        source, digest = self.fixture()
        for value, pin in ((source, '0' * 64), (source + source, digest)):
            with self.assertRaises(ValueError):
                instrument(value, pin)

    def test_absent_or_duplicate_completed_guard_anchor_refuses(self):
        source, _ = self.fixture()
        for value in (source.replace(ANCHOR, ''), source.replace(ANCHOR, ANCHOR + ANCHOR)):
            begin = value.index(' AS $$') + len(' AS $$')
            end = value.index('$$;', begin)
            digest = hashlib.sha256(value[begin:end].encode()).hexdigest()
            with self.assertRaises(ValueError):
                instrument(value, digest)


if __name__ == '__main__':
    unittest.main()
