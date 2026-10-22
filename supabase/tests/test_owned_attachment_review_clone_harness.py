"""Explicit206 clone admission contracts; no database or provider operations."""
import ast
import copy
import json
from pathlib import Path
import sys
import unittest

SOURCE=Path(__file__).resolve().parent
sys.path.insert(0,str(SOURCE))
import owned_attachment_clone as m
from canonical_review_prefix import admit_canonical206
from secondary_review_cli_body import check_cli_body
from secondary_review_restore_ownership import MAP_SQL

CANDIDATE=m.ROOT/'tests/controlled-drugs/engine/candidate'
PACKAGE=check_cli_body(CANDIDATE)
BINDING=admit_canonical206(CANDIDATE,sorted((m.ROOT/'supabase/migrations').glob('*.sql')))['binding206']
PARENT=m.reviewed_inputs()[2]
FIXTURE="select 'db690000-0000-4000-8000-000000000001'::uuid;"


def state():
    rows=copy.deepcopy(PACKAGE['expected_ledger'])+[dict(version=BINDING['version'],name=BINDING['name'],statements=BINDING['expected_statements'])]
    return {'catalog':{'schemas':{name:{'oid':100}for name in ('public','auth','storage','extensions','supabase_migrations','controlled_review')},
                       'functions':{'controlled_review.required()':{'oid':200}},'relations':{'controlled_review.descriptor':{'oid':300}}},
            'rows':{'auth.users':[],'auth.sessions':[],'supabase_migrations.schema_migrations':rows,
                    'public.patient_documents':[{'synthetic_private':'PRIVATE CLINICAL DATA'}],
                    **{'controlled_review.'+name:[]for name in ('definitions','preparations','decisions','cancellations')},
                    'controlled_review.descriptor':[{'id':True,'definition':PACKAGE['expected']}]},
            'types':{'controlled_review.descriptor':{'oid':400}},'ledger':rows,
            'parent':PARENT['expected_technical_manifest'],
            'parent_literal':[{'revision':1,'definition':PARENT['expected_technical_manifest'],'definition_hash':'a'*64,'recorded_at':'2026-10-21T00:00:00Z'}],
            'parent_literal_hash_valid':True,'writers':PARENT['canonical_writer_definition_hashes']}


def auth():
    return [{'kind':'schema','identity':'auth','owner':'supabase_auth_admin','acl':None,'detail':None,'extension':None},
            {'kind':'relation:r','identity':'auth.users','owner':'supabase_auth_admin',
             'acl':['supabase_auth_admin=arwdDxt/supabase_auth_admin'],'detail':{'columns':{'id':None}},'extension':None}]


class Callback:
    def __init__(self):
        self.before=state();self.after=copy.deepcopy(self.before)
        self.before_auth=auth();self.after_auth=copy.deepcopy(self.before_auth)
        self.parent_check=True;self.review_check=True;self.clean=True;self.count=0;self.queries=[]

    def sql(self,query):
        self.queries.append(query)
        if "select jsonb_build_object('passed'"in query:return json.dumps({'passed':self.parent_check})
        if "select jsonb_build_object('review_private'"in query:return json.dumps({'review_private':self.review_check})
        if "select jsonb_build_object('fixture_clean'"in query:return json.dumps({'fixture_clean':self.clean})
        if query==MAP_SQL:return json.dumps({'entries':self.before_auth if self.count==1 else self.after_auth,'extensions':[]})
        self.count+=1
        return json.dumps(self.before if self.count==1 else self.after)

    def admit(self):return m.admit_source(self.sql,[FIXTURE],canonical_baseline=206)


class OwnedAttachmentReviewCloneTests(unittest.TestCase):
    def test_source_clone_and_source_recheck_are_explicit_private206(self):
        c=Callback();before=c.admit();c.count=0
        proof=m.verify_clone(c.sql,before,canonical_baseline=206)
        self.assertIs(proof['passed'],True);self.assertEqual(proof['canonical_migrations'],206)
        self.assertTrue(proof['independent_private_review_metadata_verified'])
        self.assertTrue(proof['auth_owner_and_raw_acl_preserved'])
        self.assertFalse(proof['oid_catalog_equality_across_databases_claimed'])
        self.assertNotIn('PRIVATE CLINICAL DATA',json.dumps(proof))
        c.count=0;self.assertTrue(m.verify_source_unchanged(c.sql,before,canonical_baseline=206))
        self.assertTrue(any('controlled_stock_manifest_snapshot()'in q for q in c.queries))
        self.assertTrue(any('Secondary-review independent private metadata mismatch'in q for q in c.queries))

    def test_cross_database_oid_changes_are_allowed_after_independent_checks(self):
        original=Callback();before=original.admit()
        clone=Callback()
        clone.before['catalog']['schemas']['controlled_review']['oid']=901
        clone.before['catalog']['relations']['controlled_review.descriptor']['oid']=902
        clone.before['types']['controlled_review.descriptor']['oid']=903
        self.assertTrue(m.verify_clone(clone.sql,before,canonical_baseline=206)['passed'])

    def test_formal_booleans_and_private_metadata_refusal(self):
        for key in ('parent_check','review_check','clean'):
            for value in (False,1,None,'true'):
                c=Callback();setattr(c,key,value)
                with self.subTest(key=key,value=value),self.assertRaises(AssertionError):c.admit()
        for key in ('parent_literal_hash_valid','descriptor_id'):
            c=Callback()
            if key=='descriptor_id':c.before['rows']['controlled_review.descriptor'][0]['id']=1
            else:c.before[key]=1
            with self.assertRaises(AssertionError):c.admit()

    def test_missing_extra_changed_old_or_new_ledger_cannot_admit(self):
        for mode in ('missing','extra','old_name','old_statements','new_version','new_name','new_statements'):
            c=Callback();rows=c.before['ledger']
            if mode=='missing':rows.pop()
            elif mode=='extra':rows.append(rows[-1])
            elif mode=='old_name':rows[0]['name']='wrong'
            elif mode=='old_statements':rows[0]['statements']=['changed old SQL']
            elif mode=='new_version':rows[-1]['version']='20261022010001'
            elif mode=='new_name':rows[-1]['name']='wrong'
            else:rows[-1]['statements']=['select 1']
            with self.subTest(mode=mode),self.assertRaises(AssertionError):c.admit()

    def test_missing_extension_or_seeded_review_data_is_refused(self):
        for mode in ('schema','table','descriptor','definitions','preparations','decisions','cancellations','fixture'):
            c=Callback()
            if mode=='schema':del c.before['catalog']['schemas']['controlled_review']
            elif mode=='table':del c.before['rows']['controlled_review.decisions']
            elif mode=='descriptor':c.before['rows']['controlled_review.descriptor'][0]['definition']={}
            elif mode=='fixture':c.before['catalog']['schemas']['controlled_review_cli_fixture']={}
            else:c.before['rows']['controlled_review.'+mode]=[{'seeded':True}]
            with self.subTest(mode=mode),self.assertRaises(AssertionError):c.admit()

    def test_explicit_wrong_profile_never_falls_back(self):
        c=Callback()
        for value in (True,'206',204,207,None):
            with self.subTest(value=value),self.assertRaises(AssertionError):
                m.admit_source(c.sql,[FIXTURE],canonical_baseline=value)
        with self.assertRaises(AssertionError):m.admit_source(c.sql,[FIXTURE],canonical_baseline=205)
        before=Callback().admit()
        with self.assertRaises(AssertionError):m.verify_clone(c.sql,before,canonical_baseline=205)

    def test_changed_frozen_parent_and_writer_are_refused(self):
        for mode in ('parent','literal','writer','revision'):
            c=Callback()
            if mode=='parent':c.before['parent']={}
            elif mode=='literal':c.before['parent_literal'][0]['definition']={}
            elif mode=='revision':c.before['parent_literal'][0]['revision']=True
            else:c.before['writers']={}
            with self.subTest(mode=mode),self.assertRaises(AssertionError):c.admit()

    def test_clone_rows_and_auth_owner_raw_acl_null_state_must_match(self):
        before=Callback().admit()
        for mode in ('rows','auth_owner','auth_acl','column_acl','literal_time'):
            c=Callback()
            if mode=='rows':c.before['rows']['public.patient_documents']=[]
            elif mode=='auth_owner':c.before_auth[1]['owner']='postgres'
            elif mode=='auth_acl':c.before_auth[0]['acl']=[]
            elif mode=='column_acl':c.before_auth[1]['detail']['columns']['id']=['authenticated=r/postgres']
            else:c.before['parent_literal'][0]['recorded_at']='different'
            with self.subTest(mode=mode),self.assertRaises(AssertionError):m.verify_clone(c.sql,before,canonical_baseline=206)

    def test_source_changed_during_admission_or_after_clone_refused_with_safe_diagnostics(self):
        c=Callback();c.after['catalog']['functions']['controlled_review.required()']={'source':'PRIVATE BODY'}
        with self.assertRaisesRegex(AssertionError,'Source changed during clone admission'):c.admit()
        before=Callback().admit()
        for key in ('rows','catalog','types','auth_acl'):
            c=Callback()
            if key=='rows':c.before['rows']['controlled_review.decisions']=[{'private':'PRIVATE RECEIPT'}]
            elif key=='catalog':c.before['catalog']['functions']['controlled_review.required()']={'source':'PRIVATE BODY'}
            elif key=='types':c.before['types']['controlled_review.descriptor']={'private':'PRIVATE TYPE'}
            else:c.before_auth[1]['acl']=['PRIVATE ACL']
            with self.subTest(key=key),self.assertRaises(AssertionError)as caught:
                m.verify_source_unchanged(c.sql,before,canonical_baseline=206)
            self.assertNotIn('PRIVATE',str(caught.exception))

    def test_entrypoint_profile_is_passed_to_all_checks_and_conditional_dump(self):
        for name in ('ezyvet_attachment_metadata_concurrency.py','ezyvet_attachment_originals_concurrency.py'):
            text=(SOURCE/name).read_text();tree=ast.parse(text)
            option=next(node for node in ast.walk(tree)if isinstance(node,ast.Call)and node.args and isinstance(node.args[0],ast.Constant)and node.args[0].value=='--canonical-baseline')
            keywords={k.arg:k.value for k in option.keywords}
            self.assertEqual(ast.literal_eval(keywords['choices']),(205,206));self.assertEqual(ast.literal_eval(keywords['default']),206)
            for node in ast.walk(tree):
                if isinstance(node,ast.Call)and isinstance(node.func,ast.Name)and node.func.id in ('admit_source','verify_clone','verify_source_unchanged'):
                    self.assertTrue(any(k.arg=='canonical_baseline'and ast.unparse(k.value)=='args.canonical_baseline'for k in node.keywords))
            self.assertIn("(['--schema=controlled_review']if args.canonical_baseline==206 else[])",text)
            self.assertNotIn('--no-owner',text)
        timer=(SOURCE/'probe_attachment_scheduler.py').read_text()
        self.assertIn("'--canonical-baseline', '205'",timer)


if __name__=='__main__':unittest.main()
