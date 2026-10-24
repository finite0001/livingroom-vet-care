"""Owned-network failure paths with finite fake Docker observations; no daemon."""
import copy
import importlib
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import patch

SOURCE = Path(__file__).resolve().parents[2]/'tests/controlled-drugs/engine/candidate'
sys.dont_write_bytecode = True
sys.path.insert(0, str(SOURCE))
n = importlib.import_module('record_review_v3_owned_network')
OLD = '1'*64
NEW = '2'*64
CONTAINER = '3'*64
ROUTES = '''Routing tables

Internet:
Destination        Gateway            Flags               Netif Expire
default            10.0.0.1           UGScg                 en0
10.0.0/24          link#6             UCS                   en0
10.0.0.10          aa:bb              UHLWI                 en0
127                127.0.0.1          UCS                   lo0
169.254            link#6             UCS                   en0
224.0.0/4          link#6             UmCS                  en0
'''


class FakeRuntime:
    endpoint = 'unix:///local/docker.sock'
    identity = 'lrv-controlled-review-0123456789'
    def __init__(self, folder):
        self.folder = folder
        self.project = folder/'project'
        self.limits = []
    def remaining(self, value):
        self.limits.append(value)
        return min(value, 7)


class FakeNetwork(n.OwnedNetwork):
    def __init__(self, runtime):
        super().__init__(runtime)
        self.calls = []
        self.created = False
        self.deleted = False
        self.routes = ROUTES
        self.create_fault = None
        self.inspect_fault = None
        self.old = dict(Id=OLD, Name='bridge', IPAM={'Config':[{'Subnet':'172.17.0.0/16'}]}, Labels={})
        self.value = dict(Id=NEW, Name=self.name, Labels=dict(self.labels), Driver='bridge', Scope='local',
            Internal=False, Attachable=False, Ingress=False, EnableIPv6=False, Options={},
            IPAM={'Driver':'default', 'Options':{}, 'Config':[{'Subnet':n.SUBNET,'Gateway':n.GATEWAY}]}, Containers={})
        self.container = dict(Id=CONTAINER, Name='/owned_db', Config={'Labels':{
            'com.supabase.cli.project':runtime.identity,'com.supabase.cli.workdir':str(runtime.project)}},
            NetworkSettings={'Networks':{self.name:{'NetworkID':NEW}}})
    def run(self, argv):
        self.calls.append(argv)
        if argv[0] == '/usr/sbin/netstat': return self.routes
        if argv[1:3] == ['network','ls']:
            if '--format' in argv: return ('bridge\n'+(self.name+'\n' if self.created and not self.deleted else ''))
            return OLD+'\n'+(NEW+'\n' if self.created and not self.deleted else '')
        if argv[1:3] == ['network','inspect']:
            if argv[3:] == [OLD]: return json.dumps([self.old])
            if self.inspect_fault: raise self.inspect_fault
            return json.dumps([self.value])
        if argv[1:3] == ['network','create']:
            self.created = True
            if self.create_fault: raise self.create_fault
            return NEW+'\n'
        if argv[1:3] == ['network','rm']:
            self.deleted = True
            return NEW+'\n'
        if argv[1:] == ['inspect',CONTAINER]: return json.dumps([self.container])
        raise AssertionError(argv)


class OwnedNetworkTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.runtime = FakeRuntime(Path(self.temp.name))
        self.net = FakeNetwork(self.runtime)
    def mutations(self):
        return [a for a in self.net.calls if a[1:3] in (['network','create'],['network','rm'])]
    def test_explicit_create_exact_immutable_removal_without_cli_labels(self):
        self.assertEqual(self.net.prepare(), NEW)
        create = self.mutations()[0]
        self.assertIn(n.SUBNET,create); self.assertIn(n.GATEWAY,create)
        self.assertFalse(any('com.supabase' in x for x in create))
        self.net.before_stop(); self.net.remove()
        self.assertEqual(self.mutations()[-1], ['docker','network','rm',NEW])
        self.assertTrue(self.net.removed)
    def test_docker_overlap_and_name_nonce_collisions_never_create(self):
        for mutation in ('subnet','name','nonce'):
            self.setUp()
            if mutation=='subnet':self.net.old['IPAM']['Config'][0]['Subnet']='10.253.0.0/16'
            if mutation=='name':self.net.old['Name']=self.net.name
            if mutation=='nonce':self.net.old['Labels']=self.net.labels
            with self.subTest(mutation=mutation), self.assertRaises(AssertionError): self.net.prepare()
            self.assertEqual(self.mutations(),[])
    def test_empty_subnet_inventory_only_allowed_for_exact_host_none_builtins(self):
        for name,driver in (('host','host'),('none','null')):
            for config in (None,[]):
                item=dict(Id=OLD,Name=name,Driver=driver,Scope='local',Labels={},IPAM={'Driver':'default','Config':config})
                n.assert_disjoint([item],n.route_networks(ROUTES),self.net.name,self.net.labels)
                for key,value in (('Name','custom'),('Driver','bridge'),('Scope','swarm')):
                    bad=copy.deepcopy(item);bad[key]=value
                    with self.subTest(name=name,key=key),self.assertRaisesRegex(AssertionError,'Missing subnet inventory'):
                        n.assert_disjoint([bad],n.route_networks(ROUTES),self.net.name,self.net.labels)
        for config in (None,[]):
            self.net.old.update(Name='custom_bridge',Driver='bridge',Scope='local',IPAM={'Driver':'default','Config':config})
            with self.assertRaisesRegex(AssertionError,'Missing subnet inventory'):self.net.prepare()
            self.assertEqual(self.mutations(),[])

    def test_host_overlap_including_split_default_refused(self):
        for route in ('10.253.205/24','10.253.205.1','10/8','0/1'):
            self.net.routes=ROUTES+route+' link#8 UCS en1\n'
            with self.subTest(route=route), self.assertRaises(AssertionError):self.net.prepare()
            self.assertEqual(self.mutations(),[])
    def test_route_parser_rejects_ambiguity_and_keeps_nonoverlapping_abbreviations(self):
        self.assertIn('127.0.0.0/8',[str(x) for x in n.route_networks(ROUTES)])
        for row in ('bad link#8 UCS en1','10.1/33 link#8 UCS en1','default link#8 UCS en1','10.1 link#8','0/0 10.0.0.1 UG en0'):
            with self.subTest(row=row), self.assertRaises(AssertionError):n.route_networks(ROUTES+row+'\n')
        with self.assertRaises(AssertionError):n.route_networks('unrecognized platform output')
    def test_network_inventory_drift_or_incomplete_inspection_refused(self):
        original=self.net.run
        def drift(argv):
            result=original(argv)
            if argv[1:3]==['network','ls'] and sum(a[1:3]==['network','ls'] for a in self.net.calls)>1:return result+NEW+'\n'
            return result
        self.net.run=drift
        with self.assertRaisesRegex(AssertionError,'inventory changed'):self.net.prepare()
        self.assertEqual(self.mutations(),[])
        for value in ({},[self.net.old,self.net.old],[]):
            with self.subTest(value=value), self.assertRaises(AssertionError):n.assert_disjoint(value,n.route_networks(ROUTES),self.net.name,self.net.labels)
    def test_create_timeout_or_nonzero_is_not_adopted_or_removed(self):
        for error in (subprocess.TimeoutExpired('docker',7),AssertionError('command failed'),OSError('spawn')):
            self.setUp(); self.net.create_fault=error
            with self.assertRaises(type(error)):self.net.prepare()
            self.assertTrue(self.net.create_attempted); self.assertIsNone(self.net.network_id)
            with self.assertRaisesRegex(AssertionError,'Uncertain'):self.net.before_stop()
            self.assertFalse(self.net.deleted)
            with self.assertRaisesRegex(AssertionError,'retried'):self.net.prepare()
    def test_inspection_owner_id_ipam_and_flag_drift_never_removed(self):
        self.net.prepare(); pristine=copy.deepcopy(self.net.value)
        for key,value in [('Id','9'*64),('Name','foreign'),('Labels',{}),('Driver','overlay'),('Scope','swarm'),('Internal',True),('Attachable',True),('Ingress',True),('EnableIPv6',True),('Options',{'x':'y'}),('IPAM',{'Driver':'default','Config':[{'Subnet':n.SUBNET,'Gateway':'10.253.205.2'}]})]:
            self.net.value=copy.deepcopy(pristine);self.net.value[key]=value
            with self.subTest(key=key),self.assertRaises(AssertionError):self.net.remove()
            self.assertFalse(self.net.deleted)
    def attach(self):
        self.net.value['Containers']={CONTAINER:{'Name':'owned_db'}}
    def test_owned_attachment_can_stop_but_must_be_gone_before_remove(self):
        self.net.prepare();self.attach();self.net.before_stop()
        with self.assertRaisesRegex(AssertionError,'still has'):self.net.remove()
        self.assertFalse(self.net.deleted)
        self.net.value['Containers']={};self.net.remove()
    def test_foreign_attached_project_workdir_or_network_refuses_before_stop(self):
        self.net.prepare();self.attach();good=copy.deepcopy(self.net.container)
        for kind in ('project','workdir','id','network','name'):
            self.net.container=copy.deepcopy(good)
            if kind=='project':self.net.container['Config']['Labels']['com.supabase.cli.project']='foreign'
            if kind=='workdir':self.net.container['Config']['Labels']['com.supabase.cli.workdir']='/foreign'
            if kind=='id':self.net.container['Id']='f'*64
            if kind=='network':self.net.container['NetworkSettings']['Networks'][self.net.name]['NetworkID']='f'*64
            if kind=='name':self.net.container['Name']='/other'
            with self.subTest(kind=kind),self.assertRaises(AssertionError):self.net.before_stop()
            self.assertFalse(self.net.deleted)
    def test_no_create_path_cleanup_is_explicit_and_no_mutation(self):
        self.net.before_stop();self.net.remove()
        self.assertTrue(self.net.record['not_created']);self.assertEqual(self.mutations(),[])
    def test_file_backed_runner_pins_endpoint_and_same_bounded_deadline(self):
        net=n.OwnedNetwork(self.runtime)
        def fake(argv,**kwargs):
            self.assertEqual(argv[:3],['docker','--host',self.runtime.endpoint]);self.assertEqual(kwargs['timeout'],7)
            self.assertNotIn('DOCKER_CONTEXT',kwargs['env']);self.assertEqual(kwargs['env']['DOCKER_HOST'],self.runtime.endpoint)
            kwargs['stdout'].write('exact output');kwargs['stderr'].write('private diagnostic')
            return subprocess.CompletedProcess(argv,0)
        with patch.object(n.subprocess,'run',side_effect=fake):self.assertEqual(net.run(['docker','network','ls']), 'exact output')
        self.assertEqual(self.runtime.limits,[120]);self.assertEqual((self.runtime.folder/'network-001-stderr.log').read_text(),'private diagnostic')
        self.assertEqual((self.runtime.folder/'network-001-stdout.log').stat().st_mode&0o777,0o600)
        self.runtime.endpoint='unix:///changed.sock'
        with self.assertRaisesRegex(AssertionError,'endpoint changed'):net.run(['docker','network','ls'])
    def test_file_backed_timeout_retains_partial_output_and_fixed_exception_type(self):
        net=n.OwnedNetwork(self.runtime)
        def timeout(argv,**kwargs):
            kwargs['stdout'].write('partial');raise subprocess.TimeoutExpired(argv,7)
        with patch.object(n.subprocess,'run',side_effect=timeout),self.assertRaises(subprocess.TimeoutExpired):net.run(['docker','network','create'])
        self.assertEqual((self.runtime.folder/'network-001-stdout.log').read_text(),'partial')
        self.assertEqual(json.loads((self.runtime.folder/'network-001-exception.json').read_text()),{'type':'TimeoutExpired'})
    def test_real_inert_subprocess_keeps_private_outputs_without_daemon(self):
        net=n.OwnedNetwork(self.runtime)
        executable=self.runtime.folder/'docker'
        executable.write_text('#!'+sys.executable+'\nimport sys\nprint("inert network observation")\nprint("private sentinel",file=sys.stderr)\n')
        executable.chmod(0o700)
        with patch.dict(os.environ,{'PATH':str(self.runtime.folder)}):
            self.assertEqual(net.run(['docker','network','ls']),'inert network observation\n')
        self.assertEqual((self.runtime.folder/'network-001-stderr.log').read_text(),'private sentinel\n')
        self.assertEqual((self.runtime.folder/'network-001-command.json').stat().st_mode&0o777,0o600)

    def test_failed_network_removal_is_not_retried(self):
        self.net.prepare()
        original=self.net.run
        def fail(argv):
            if argv[1:3]==['network','rm']:raise subprocess.TimeoutExpired(argv,7)
            return original(argv)
        self.net.run=fail
        with self.assertRaises(subprocess.TimeoutExpired):self.net.remove()
        self.assertTrue(self.net.record['removal_attempted'])
        with self.assertRaisesRegex(AssertionError,'cannot be retried'):self.net.remove()
        self.assertFalse(self.net.removed)

    def test_nonlocal_endpoint_refused(self):
        self.runtime.endpoint='tcp://remote:2375'
        with self.assertRaises(AssertionError):n.OwnedNetwork(self.runtime)
    def test_inspection_duplicate_keys_refused(self):
        with self.assertRaises(AssertionError):n.one_json('{"Id":"a","Id":"b"}')


if __name__=='__main__':unittest.main()
