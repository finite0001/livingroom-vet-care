"""One explicit, disposable local bridge; no global Docker pool mutation.

CLI 2.118.0 inspects an explicit network ID and reuses it unchanged. Its stop
path prunes CLI-project-labelled networks; this network has custom labels only.
An uncertain create is never adopted by name or automatically deleted.
"""
import hashlib
import ipaddress
import json
import os
from pathlib import Path
import re
import subprocess
import uuid

SUBNET = '10.253.205.0/24'
GATEWAY = '10.253.205.1'
LABEL_PREFIX = 'org.lrv.review.network.'
ID = re.compile(r'[0-9a-f]{64}\Z')
NONCE = re.compile(r'[0-9a-f]{32}\Z')
MAX_NETWORKS = 1024


def one_json(text):
    def unique(pairs):
        result = {}
        for key, value in pairs:
            assert key not in result, 'Duplicate inspection key'
            result[key] = value
        return result
    return json.loads(text, object_pairs_hook=unique)


def route_networks(text):
    """Finite macOS `netstat -rn -f inet` format; never guess an unknown row."""
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    assert len(lines) >= 4 and lines[:2] == ['Routing tables', 'Internet:'], 'Unsupported host route inventory'
    assert lines[2].split()[:4] == ['Destination', 'Gateway', 'Flags', 'Netif'], 'Unsupported route columns'
    result = []
    for line in lines[3:]:
        cells = line.split()
        assert len(cells) in (4, 5), 'Malformed route row'
        destination, _, flags, _ = cells[:4]
        if destination == 'default':
            assert 'U' in flags and 'G' in flags, 'Unrecognized default route'
            continue
        address, slash, prefix = destination.partition('/')
        parts = address.split('.')
        assert 1 <= len(parts) <= 4 and all(re.fullmatch(r'0|[1-9][0-9]{0,2}', p) and int(p) <= 255 for p in parts), 'Malformed IPv4 route'
        if slash:
            assert re.fullmatch(r'0|[1-9][0-9]?', prefix) and int(prefix) <= 32, 'Malformed route prefix'
            length = int(prefix)
        else:
            length = 32 if 'H' in flags or len(parts) == 4 else len(parts)*8
        value = '.'.join(parts+['0']*(4-len(parts)))+'/'+str(length)
        network = ipaddress.ip_network(value, strict=False)
        # A literal 0/0 is still a default route, but do not accept VPN split routes.
        assert network.prefixlen != 0, 'Only named default route may be excluded'
        result.append(network)
    assert result, 'Empty host route inventory'
    return result


def assert_disjoint(networks, routes, name, labels):
    target = ipaddress.ip_network(SUBNET)
    assert isinstance(networks, list) and 1 <= len(networks) <= MAX_NETWORKS, 'Invalid complete Docker network inventory'
    ids = []
    for item in networks:
        assert isinstance(item, dict) and ID.fullmatch(item.get('Id', '')), 'Invalid network identity'
        ids.append(item['Id'])
        assert item.get('Name') != name, 'Fresh network name collision'
        observed_labels = item.get('Labels') or {}
        assert isinstance(observed_labels, dict), 'Malformed network labels'
        assert observed_labels.get(LABEL_PREFIX+'nonce') != labels[LABEL_PREFIX+'nonce'], 'Fresh network nonce collision'
        ipam = item.get('IPAM')
        assert isinstance(ipam, dict) and isinstance(ipam.get('Config'), (list, type(None))), 'Malformed network IPAM'
        if not ipam.get('Config'):
            assert (item.get('Name'), item.get('Driver'), item.get('Scope')) in (
                ('host', 'host', 'local'), ('none', 'null', 'local')) and ipam.get('Driver') == 'default', 'Missing subnet inventory for non-builtin network'
        for config in ipam['Config'] or []:
            assert isinstance(config, dict) and isinstance(config.get('Subnet'), str), 'Missing network subnet'
            network = ipaddress.ip_network(config['Subnet'], strict=True)
            assert network.version != 4 or not network.overlaps(target), 'Docker subnet overlap'
    assert len(ids) == len(set(ids)), 'Duplicate network inventory'
    assert all(not route.overlaps(target) for route in routes), 'Host route overlap'


class OwnedNetwork:
    def __init__(self, runtime):
        self.runtime = runtime
        assert runtime.endpoint.startswith('unix:///') and not any(c.isspace() for c in runtime.endpoint), 'Local Unix Docker endpoint required'
        self.endpoint = runtime.endpoint
        self.nonce = uuid.uuid4().hex
        assert NONCE.fullmatch(self.nonce)
        self.name = 'lrv-v3-net-'+self.nonce
        self.labels = {LABEL_PREFIX+'nonce': self.nonce, LABEL_PREFIX+'project': runtime.identity,
                       LABEL_PREFIX+'endpoint-sha256': hashlib.sha256(self.endpoint.encode()).hexdigest()}
        self.network_id = None
        self.create_attempted = False
        self.removed = False
        self.removal_attempted = False
        self.number = 0
        self.record = dict(name=self.name, labels=self.labels, endpoint=self.endpoint, subnet=SUBNET,
                           gateway=GATEWAY, network_id=None, create_attempted=False, removed=False)
        self.save()

    def save(self):
        path = self.runtime.folder/'owned-network.json'
        path.write_text(json.dumps(self.record, indent=2, sort_keys=True)+'\n')
        path.chmod(0o600)

    def run(self, argv):
        """File-backed even after inherited cleanup closes runner.log/workdir."""
        assert self.runtime.endpoint == self.endpoint, 'Docker endpoint changed'
        assert argv[0] in ('docker', '/usr/sbin/netstat'), 'Unexpected network command'
        if argv[0] == 'docker':
            argv = ['docker', '--host', self.endpoint]+argv[1:]
        env = os.environ.copy()
        env.pop('DOCKER_CONTEXT', None)
        env['DOCKER_HOST'] = self.endpoint
        self.number += 1
        stem = 'network-'+f'{self.number:03d}'
        command_path = self.runtime.folder/(stem+'-command.json')
        command_path.write_text(json.dumps(argv)+'\n')
        command_path.chmod(0o600)
        paths = [self.runtime.folder/(stem+suffix) for suffix in ('-stdout.log', '-stderr.log')]
        with paths[0].open('x+') as out, paths[1].open('x+') as err:
            for path in paths: path.chmod(0o600)
            try:
                process = subprocess.run(argv, stdin=subprocess.DEVNULL, stdout=out, stderr=err,
                    text=True, env=env, cwd=self.runtime.folder, timeout=self.runtime.remaining(120))
            except BaseException as exc:
                error_path = self.runtime.folder/(stem+'-exception.json')
                error_path.write_text(json.dumps({'type': type(exc).__name__})+'\n')
                error_path.chmod(0o600)
                raise
            out.seek(0); err.seek(0)
            result = subprocess.CompletedProcess(argv, process.returncode, out.read(), err.read())
        assert result.returncode == 0, 'Owned network command failed; retained '+stem
        return result.stdout

    def inventory(self):
        argv = ['docker', 'network', 'ls', '--no-trunc', '-q']
        before = self.run(argv).splitlines()
        assert 1 <= len(before) <= MAX_NETWORKS and len(before) == len(set(before)) and all(ID.fullmatch(x) for x in before), 'Invalid full network IDs'
        values = one_json(self.run(['docker', 'network', 'inspect']+before))
        assert isinstance(values, list) and {x['Id'] for x in values} == set(before) and len(values) == len(before), 'Incomplete network inspection'
        after = self.run(argv).splitlines()
        assert sorted(before) == sorted(after), 'Network inventory changed during preflight'
        return values

    def inspect(self, require_empty=False):
        assert self.network_id and ID.fullmatch(self.network_id), 'No captured immutable network ID'
        result = one_json(self.run(['docker', 'network', 'inspect', self.network_id]))
        assert isinstance(result, list) and len(result) == 1, 'Exact network inspection required'
        value = result[0]
        assert value.get('Id') == self.network_id and value.get('Name') == self.name, 'Owned network identity changed'
        assert value.get('Labels') == self.labels, 'Owned network labels changed'
        assert value.get('Driver') == 'bridge' and value.get('Scope') == 'local', 'Owned network driver changed'
        assert all(value.get(key) is False for key in ('Internal', 'Attachable', 'Ingress', 'EnableIPv6')), 'Owned network flags changed'
        assert value.get('Options') in ({}, None), 'Owned network options changed'
        ipam = value.get('IPAM', {})
        assert ipam.get('Driver') == 'default' and ipam.get('Options') in ({}, None), 'Owned IPAM driver changed'
        assert ipam.get('Config') == [{'Subnet': SUBNET, 'Gateway': GATEWAY}], 'Owned IPAM changed'
        attached = value.get('Containers')
        assert isinstance(attached, dict) and all(ID.fullmatch(x) for x in attached), 'Malformed network attachments'
        if require_empty: assert not attached, 'Owned network still has attached containers'
        return value

    def prepare(self):
        assert not self.create_attempted and self.network_id is None, 'Network create cannot be retried'
        routes = route_networks(self.run(['/usr/sbin/netstat', '-rn', '-f', 'inet']))
        networks = self.inventory()
        assert_disjoint(networks, routes, self.name, self.labels)
        self.record['preflight'] = {'docker_ids': sorted(x['Id'] for x in networks), 'host_ipv4_routes': [str(x) for x in routes]}
        self.create_attempted = True
        self.record['create_attempted'] = True
        self.save()  # Persist uncertain-create boundary before any mutation.
        argv = ['docker', 'network', 'create', '--driver', 'bridge', '--subnet', SUBNET, '--gateway', GATEWAY]
        for key, value in sorted(self.labels.items()): argv += ['--label', key+'='+value]
        output = self.run(argv+[self.name]).strip()
        assert ID.fullmatch(output), 'Network create returned no exact immutable ID; retain uncertain evidence'
        self.network_id = output
        self.record['network_id'] = output
        self.save()
        self.inspect(require_empty=True)
        self.record['admitted'] = True
        self.save()
        return output

    def before_stop(self):
        if not self.create_attempted: return
        assert self.network_id is not None, 'Uncertain network create; no automatic cleanup or adoption'
        value = self.inspect()
        for identity, endpoint in value['Containers'].items():
            result = one_json(self.run(['docker', 'inspect', identity]))
            assert isinstance(result, list) and len(result) == 1 and result[0].get('Id') == identity, 'Attached immutable container changed'
            container = result[0]
            labels = container.get('Config', {}).get('Labels', {})
            assert labels.get('com.supabase.cli.project') == self.runtime.identity, 'Foreign attached project; no cleanup'
            assert labels.get('com.supabase.cli.workdir') == str(self.runtime.project), 'Foreign attached workdir; no cleanup'
            connected = container.get('NetworkSettings', {}).get('Networks', {}).get(self.name, {})
            assert connected.get('NetworkID') == self.network_id, 'Attached network binding changed'
            assert container.get('Name', '').lstrip('/') == endpoint.get('Name'), 'Attached container name changed'
        self.record['validated_attachment_ids'] = sorted(value['Containers'])
        self.save()

    def remove(self):
        if not self.create_attempted:
            self.record['not_created'] = True
            self.record['removed'] = True
            self.removed = True
            self.save()
            return
        self.inspect(require_empty=True)
        assert not self.removal_attempted, 'Network removal cannot be retried'
        self.removal_attempted = True
        self.record['removal_attempted'] = True
        self.save()
        output = self.run(['docker', 'network', 'rm', self.network_id]).strip()
        assert output == self.network_id, 'Exact network removal receipt required'
        remaining = self.run(['docker', 'network', 'ls', '--no-trunc', '-q']).splitlines()
        assert all(ID.fullmatch(x) for x in remaining) and self.network_id not in remaining, 'Owned network remains'
        # Do not adopt/remove replacements. Full inventory proves exact ID absence;
        # a separately observed name collision after deletion must fail closed.
        names = self.run(['docker', 'network', 'ls', '--format', '{{.Name}}']).splitlines()
        assert self.name not in names, 'Replacement owned network name observed'
        self.removed = True
        self.record['removed'] = True
        self.save()
