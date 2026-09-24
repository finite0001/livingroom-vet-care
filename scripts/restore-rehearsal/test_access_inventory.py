"""Access drift and missing evidence must not pass the hosted comparison."""
import copy
import importlib.util
from pathlib import Path
import unittest

spec=importlib.util.spec_from_file_location('access_inventory',Path(__file__).with_name('compare-access-inventories.py'))
module=importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
BASE={'versions':['20260913630000'],
 'relations':[{'name':'records','kind':'r','owner':'postgres','rls':True,'force_rls':False,
  'grants':{role:{p:False for p in ['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN']} for role in ['anon','authenticated','service_role']}}],
 'policies':[{'schemaname':'public','tablename':'records','policyname':'staff','permissive':'PERMISSIVE','roles':['authenticated'],'cmd':'SELECT','qual':'is_active_staff(auth.uid())','with_check':None}],
 'default_privileges':[{'owner':'postgres','schema':'public','kind':'r','acl':[{'grantee':'postgres','grantor':'postgres','privilege':'SELECT','grantable':False}]}]}


class AccessInventory(unittest.TestCase):
    def test_exact_match(self):
        self.assertTrue(module.compare(BASE,copy.deepcopy(BASE))['matches'])

    def test_role_grant_and_rls_drift(self):
        for field,value in [('rls',False),('force_rls',True),('owner','other')]:
            observed=copy.deepcopy(BASE);observed['relations'][0][field]=value
            self.assertFalse(module.compare(BASE,observed)['matches'])
        observed=copy.deepcopy(BASE);observed['relations'][0]['grants']['anon']['SELECT']=True
        self.assertFalse(module.compare(BASE,observed)['matches'])

    def test_policy_and_default_privilege_drift(self):
        for field,value in [('qual','true'),('with_check','true'),('roles',['anon']),('permissive','RESTRICTIVE')]:
            observed=copy.deepcopy(BASE);observed['policies'][0][field]=value
            self.assertFalse(module.compare(BASE,observed)['matches'])
        observed=copy.deepcopy(BASE);observed['default_privileges'][0]['acl'][0]['grantable']=True
        self.assertFalse(module.compare(BASE,observed)['matches'])

    def test_missing_policy_and_wrong_ledger(self):
        observed=copy.deepcopy(BASE);observed['policies']=[]
        self.assertFalse(module.compare(BASE,observed)['matches'])
        observed=copy.deepcopy(BASE);observed['versions'].append('20260913900000')
        self.assertFalse(module.compare(BASE,observed)['matches'])

    def test_missing_duplicate_and_malformed_evidence(self):
        for mutation in [lambda v:v.pop('policies'),lambda v:v['relations'].append(copy.deepcopy(v['relations'][0])),lambda v:v['relations'][0]['grants'].pop('anon'),lambda v:v['relations'][0]['grants']['anon'].update(SELECT='false'),lambda v:v['policies'][0].update(roles=[]),lambda v:v['default_privileges'][0]['acl'][0].update(grantable='false')]:
            value=copy.deepcopy(BASE);mutation(value)
            with self.assertRaises(ValueError):module.compare(value,value)


if __name__=='__main__':unittest.main()
