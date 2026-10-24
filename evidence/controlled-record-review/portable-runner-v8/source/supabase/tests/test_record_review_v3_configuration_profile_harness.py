"""Offline private profile metadata/lineage tests; no database realization."""
from copy import deepcopy
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from pglast import parse_sql,parse_plpgsql

ROOT=Path(__file__).resolve().parents[2]
HERE=ROOT/'tests/controlled-drugs/engine/candidate'
spec=importlib.util.spec_from_file_location('configuration_profile',HERE/'record_review_v3_configuration_profile.py')
p=importlib.util.module_from_spec(spec);spec.loader.exec_module(p)
d=p.descriptor


class ProfileTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.admitted=p.frozen_a1.admit();cls.base=cls.admitted['package'];cls.bundle=p.build()

    def test_complete_predecessor_map_and_new_six_inputs(self):
        b=self.bundle;original=self.base['input_source_hashes'];old=self.admitted['input_source_hashes'];new=b['input_source_hashes']
        self.assertEqual(len(original),246);self.assertEqual(len(old),248);self.assertEqual(len(new),254)
        self.assertEqual({name:new[name]for name in original},original)
        self.assertEqual(d.sha(d.canonical(original).encode()),p.MAP_A1)
        self.assertEqual({name:new[name]for name in old},old)
        wanted={str((HERE/name).relative_to(p.SOURCE.parents[3]))for name in ('record-review-v3-configuration-profile.json','record-review-v3-configuration-schema.sql','record-review-v3-configuration-input.sql','record_review_v3_configuration_descriptor.py','record_review_v3_configuration_profile.py')}
        wanted.add(str((HERE/'record-review-v3-configuration-metadata.json').relative_to(p.SOURCE.parents[3])))
        self.assertEqual(set(new)-set(old),wanted)
        for name,digest in new.items():self.assertEqual(d.sha((p.SOURCE.parents[3]/name).read_bytes()),digest)

    def test_lineage_rejects_added_deleted_drifted_keys_and_expected(self):
        for label in ('add','delete','drift','expected','install'):
            bad=deepcopy(self.base)
            if label=='add':bad['input_source_hashes']['unreviewed.py']='0'*64
            if label=='delete':del bad['input_source_hashes'][next(iter(bad['input_source_hashes']))]
            if label=='drift':bad['input_source_hashes'][next(iter(bad['input_source_hashes']))]='0'*64
            if label=='expected':bad['expected_sha256']='0'*64
            if label=='install':bad['install_sha256']='0'*64
            with self.subTest(label=label),self.assertRaises(AssertionError):p.lineage(bad)

    def test_exact_shape_and_all29_prior_function_bodies(self):
        old=self.base['expected'];new=self.bundle['expected'];p.finite_delta(old,new)
        for key in old:
            if key not in ('kind','functions'):self.assertEqual(old[key],new[key],key)
        self.assertEqual(len(new['relations']),13);self.assertEqual(len(new['foreign_key_triggers']),60)
        changed={name for name in old['functions']if old['functions'][name]!=new['functions'][name]}
        self.assertEqual(changed,{'controlled_review_v3.required()','controlled_review_v3.snapshot()'})
        for name in set(old['functions'])-changed:self.assertEqual(old['functions'][name],new['functions'][name])
        self.assertEqual(len(old['functions'])-len(changed),29)
        self.assertIsNot(d.TABLES,d.base.TABLES);self.assertEqual(d.TABLES,d.base.TABLES)

    def test_delta_rejects_old_body_grant_attribute_table_or_parent_drift(self):
        for kind in ('stub','acl','definer','column','parent','extra','required_attribute'):
            bad=deepcopy(self.bundle['expected']);signature='controlled_review_v3.validate_configuration(p_request jsonb)'
            if kind=='stub':bad['functions']['controlled_review_v3.materialize_one(p_request jsonb)']['source']+='\n'
            if kind=='acl':bad['functions'][signature]['acl'].append(dict(grantee='authenticated',grantor='postgres',privilege='EXECUTE',grantable=False))
            if kind=='definer':bad['functions'][signature]['security_definer']=True
            if kind=='column':bad['relations']['operation_claims']['columns'][0]['not_null']=False
            if kind=='parent':bad['parents']['parent205']['revision']=2
            if kind=='extra':bad['extra']='undeclared'
            if kind=='required_attribute':bad['functions']['controlled_review_v3.required()']['cost']=101
            with self.subTest(kind=kind),self.assertRaises(AssertionError):p.finite_delta(self.base['expected'],bad)

    def test_new_function_exact_declared_attributes_and_source(self):
        function=self.bundle['expected']['functions']['controlled_review_v3.validate_configuration(p_request jsonb)']
        self.assertEqual(function['source'],d.read_input(HERE)[4])
        for key,value in {'owner':'postgres','language':'plpgsql','return_type':'jsonb','kind':'f','security_definer':False,'strict':False,'leakproof':False,'volatility':'v','parallel':'u','cost':100,'rows':0,'argument_names':['p_request'],'configuration':['search_path=pg_catalog, public, pg_temp','TimeZone=UTC']}.items():self.assertEqual(function[key],value,key)
        self.assertEqual(function['acl'],[dict(grantee='postgres',grantor='postgres',privilege='EXECUTE',grantable=False)])

    def test_manifest_and_validator_bytes_are_independently_pinned(self):
        with tempfile.TemporaryDirectory()as directory:
            root=Path(directory);q=root/'profile';q.mkdir()
            (q/'record-review-v3-configuration-metadata.json').write_bytes((HERE/'record-review-v3-configuration-metadata.json').read_bytes())
            (q/'record-review-v3-configuration-profile.json').write_bytes((HERE/'record-review-v3-configuration-profile.json').read_bytes())
            d.admit_manifest(q)
            (q/'record-review-v3-configuration-profile.json').write_bytes((q/'record-review-v3-configuration-profile.json').read_bytes()+b' ')
            with self.assertRaises(AssertionError):d.admit_manifest(q)
            (q/'record-review-v3-configuration-input.sql').write_bytes((HERE/'record-review-v3-configuration-input.sql').read_bytes()+b'\n')
            with self.assertRaises(AssertionError):d.read_input(q)

    def test_install_is_fresh206_private_atomic_and_fails_closed(self):
        b=self.bundle;s=b['install']
        self.assertTrue(s.startswith('begin;\n'));self.assertTrue(s.endswith('commit;\n'))
        self.assertEqual(len(b['expected_ledger206']),206)
        self.assertEqual(len(b['expected_ledger206'][-2]['statements']),94)
        self.assertEqual(len(b['expected_ledger206'][-1]['statements']),304)
        for marker in b['markers'].values():self.assertEqual(s.count(marker),1)
        for fragment in ('pg_advisory_xact_lock(90271040,0)','package must be wholly absent','from pg_type where typnamespace','from pg_class where relnamespace','Configuration-input effective private privileges changed','Configuration-input must not seed configuration or evidence','Configuration-input original206 rows ledger or raw catalog changed'):self.assertIn(fragment,s)
        # Whole install embeds historical migration text that contains old grants;
        # assess only the newly executed extension DDL for this privilege assertion.
        self.assertNotIn('grant execute',b['ddl'].lower())
        self.assertEqual(b['ddl'].count('create function '),32)
        self.assertFalse(b['acceptance']);self.assertFalse(b['auth_acceptance']);self.assertFalse(b['configuration_publication_implemented'])
        self.assertTrue(b['source_integration']);self.assertFalse(b['runtime_executed'])

    def test_full_sql_and_plpgsql_parse_and_determinism(self):
        s=self.bundle['install']
        self.assertEqual(len(parse_sql(s)),405)
        self.assertEqual(len(parse_plpgsql(s)),249)
        again=p.build()
        for key in ('ddl','expected','expected_sha256','install','install_sha256','input_source_hashes'):self.assertEqual(self.bundle[key],again[key],key)


if __name__=='__main__':unittest.main(verbosity=2)
