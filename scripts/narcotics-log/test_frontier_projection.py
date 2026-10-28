"""Offline projection-construction controls; no lock or Auth acceptance."""
import unittest
from frontier_projection import namespaces


class FrontierProjectionControls(unittest.TestCase):
    def rows(self):
        return [('public','a',6,'ShareRowExclusiveLock','SHARE ROW EXCLUSIVE'),
                ('auth','sessions',6,'ShareRowExclusiveLock','SHARE ROW EXCLUSIVE'),
                ('public','b',6,'ShareRowExclusiveLock','SHARE ROW EXCLUSIVE')]

    def test_all_source_relations_project_to_exact_distinct_sorted_namespaces(self):
        self.assertEqual(namespaces(self.rows(),3),['auth','public'])
        self.assertEqual(namespaces(list(reversed(self.rows())),3),['auth','public'])

    def test_incomplete_duplicate_or_changed_mode_plan_cannot_supply_projection(self):
        values=self.rows()
        cases=[values[:-1],[values[0],values[1],values[0]],
               [values[0],values[1],('public','b',1,'AccessShareLock','ACCESS SHARE')],
               [values[0],values[1],('public','b',6,'ShareLock','SHARE ROW EXCLUSIVE')],
               [values[0],values[1],(None,'b',6,'ShareRowExclusiveLock','SHARE ROW EXCLUSIVE')],
               [values[0],values[1],('public','b',6,'ShareRowExclusiveLock')]]
        for rows in cases:
            with self.assertRaises(ValueError):namespaces(rows,3)


if __name__=='__main__':unittest.main()
