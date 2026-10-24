"""Finite owned historical-test mutations. Never modify the public source tree."""
from contextlib import contextmanager
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import sys
import uuid

CHUNK = 65536
MAX_MEMBERS = 1024
MAX_TREE_BYTES = 128 * 1024**2
MAX_MEMBER = 64 * 1024**2
MAX_MUTATION_BYTES = 4 * 1024**2
MAX_OPERATIONS = 20


def require(value, message):
    if not value: raise ValueError(message)


def relative(name):
    require(type(name) is str and name and len(name.encode()) <= 4096, 'bounded relative path')
    require(not name.startswith('/') and '\\' not in name and not any(ord(c) < 32 or ord(c) == 127 for c in name), 'literal relative path')
    parts = name.split('/')
    require(len(parts) <= 64 and all(p not in ('', '.', '..') for p in parts), 'literal finite segments')
    return parts


def manifest(value):
    require(type(value) is dict and len(value) <= MAX_MEMBERS, 'finite manifest')
    answer = {}; total = 0
    for name, item in value.items():
        relative(name)
        require(type(item) is dict and set(item) == {'bytes', 'sha256'}, 'exact member metadata')
        require(type(item['bytes']) is int and 0 <= item['bytes'] <= MAX_MEMBER, 'member size')
        require(type(item['sha256']) is str and re.fullmatch('[0-9a-f]{64}', item['sha256']) is not None, 'member digest')
        total += item['bytes']; require(total <= MAX_TREE_BYTES, 'tree byte cap')
        answer[name] = dict(item)
    for name in answer:
        parts = relative(name)
        require(not any('/'.join(parts[:i]) in answer for i in range(1, len(parts))), 'file/directory collision')
    return answer


def identity(s): return (s.st_dev, s.st_ino, s.st_mode)
def leaf_identity(s): return (*identity(s), s.st_nlink, s.st_size)
def stamp(s): return (*leaf_identity(s), s.st_mtime_ns, s.st_ctime_ns)
def digest(raw): return hashlib.sha256(raw).hexdigest()


class Root:
    def __init__(self, path, check):
        self.path = Path(path); self.check = check; self.fds = []; self.edges = []
        require(self.path.is_absolute() and str(self.path) == str(path) and not str(path).startswith('//') and '..' not in self.path.parts, 'physical absolute root')
        try:
            check(); fd = os.open('/', os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW); self.fds.append(fd)
            for part in self.path.parts[1:]:
                check(); owner = fd; fd = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=owner)
                self.fds.append(fd); self.edges.append((owner, part, fd, identity(os.fstat(fd))))
            self.fd = fd; self.id = identity(os.fstat(fd)); self.verify()
        except BaseException:
            self.close(); raise

    def verify(self):
        self.check(); require(identity(os.fstat(self.fd)) == self.id, 'root identity changed')
        for owner, name, fd, wanted in self.edges:
            self.check(); require(identity(os.stat(name, dir_fd=owner, follow_symlinks=False)) == wanted == identity(os.fstat(fd)), 'physical ancestor changed')
        self.check()

    def close(self):
        failures = []
        for fd in reversed(self.fds):
            try: os.close(fd)
            except OSError as error: failures.append(error)
        self.fds = []
        if failures:
            primary = sys.exc_info()[1]
            if primary is not None: primary.add_note('Historical boundary descriptor close failed: ' + type(failures[0]).__name__)
            else: raise failures[0]


@contextmanager
def parent(root, name, known_dirs=None):
    parts = relative(name); fds = []; edges = []; fd = root.fd; prefix = []
    try:
        root.verify()
        for part in parts[:-1]:
            root.check(); owner = fd; fd = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=owner); fds.append(fd)
            prefix.append(part); observed = identity(os.fstat(fd))
            if known_dirs is not None: require(known_dirs.get('/'.join(prefix)) == observed, 'unadmitted descendant directory')
            edges.append((owner, part, fd, observed))
        def verify():
            root.verify()
            for owner, part, child, wanted in edges:
                root.check(); require(identity(os.stat(part, dir_fd=owner, follow_symlinks=False)) == wanted == identity(os.fstat(child)), 'descendant directory changed')
        verify(); yield fd, parts[-1], verify; verify()
    finally:
        for fd in reversed(fds): os.close(fd)


def read(root, name, expected, *, keep=False):
    with parent(root, name) as (owner, leaf, verify):
        root.check(); fd = os.open(leaf, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=owner)
        try:
            before = os.fstat(fd); require(stat.S_ISREG(before.st_mode) and before.st_nlink == 1 and before.st_size == expected['bytes'], 'regular exact-size single-link file required')
            require(not keep or before.st_size <= MAX_MUTATION_BYTES, 'retained mutation byte cap')
            count = 0; h = hashlib.sha256(); chunks = []
            while True:
                root.check(); raw = os.read(fd, min(CHUNK, before.st_size + 1 - count)); root.check()
                if not raw: break
                count += len(raw); require(count <= before.st_size, 'file grew'); h.update(raw)
                if keep: chunks.append(raw)
            require(count == expected['bytes'] and h.hexdigest() == expected['sha256'], 'file digest differs')
            require(stamp(before) == stamp(os.fstat(fd)) == stamp(os.stat(leaf, dir_fd=owner, follow_symlinks=False)), 'file changed while reading')
            verify(); return (b''.join(chunks) if keep else None), leaf_identity(before)
        finally: os.close(fd)


def verify_tree(root, expected):
    files = {}; dirs = {}
    implied = {'/'.join(relative(name)[:i]) for name in expected for i in range(1, len(relative(name)))}
    def visit(fd, prefix):
        root.check()
        with os.scandir(fd) as scan:
            entries = []
            for entry in scan:
                root.check(); entries.append(entry.name)
                require(len(entries) <= len(expected) + len(implied), 'unexpected entry count')
        for name in entries:
            key = prefix + name; s = os.stat(name, dir_fd=fd, follow_symlinks=False); root.check()
            if stat.S_ISDIR(s.st_mode):
                require(key in implied, 'unexpected directory'); child = os.open(name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
                try:
                    require(identity(os.fstat(child)) == identity(s), 'directory changed'); dirs[key] = identity(s); visit(child, key + '/')
                    require(identity(os.stat(name, dir_fd=fd, follow_symlinks=False)) == dirs[key], 'directory link changed')
                finally: os.close(child)
            else:
                require(key in expected, 'unexpected file'); _, files[key] = read(root, key, expected[key])
    root.verify(); visit(root.fd, '')
    require(set(files) == set(expected) and set(dirs) == implied, 'complete tree keys differ'); root.verify()
    return files, dirs


def new_file(root, name, raw, check):
    require(type(raw) is bytes and len(raw) <= MAX_MUTATION_BYTES, 'bounded raw bytes')
    with parent(root, name) as (owner, leaf, verify):
        check(); fd = os.open(leaf, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=owner)
        try:
            original = identity(os.fstat(fd)); offset = 0
            while offset < len(raw):
                check(); part = raw[offset:offset+CHUNK]; n = os.write(fd, part); check()
                require(type(n) is int and 0 < n <= len(part), 'write progress'); offset += n
            check(); os.fsync(fd); check()
            require(identity(os.fstat(fd)) == original == identity(os.stat(leaf, dir_fd=owner, follow_symlinks=False)), 'new file identity changed')
        finally: os.close(fd)
        verify()
    _, verified_identity = read(root, name, {'bytes':len(raw), 'sha256':digest(raw)})
    require(tuple(verified_identity[:3]) == original, 'created file replaced before verification')
    return verified_identity


class Mutation:
    """One successful negative's finite mutations, followed by exact restoration."""
    def __init__(self, tree, evidence_parent, baseline, additions, root_identity, check):
        self.check = check; self.failed = False; self.restored = False; self.records = []; self.created = {}; self.total = 0
        self.tree = self.parent = self.evidence = None
        self.baseline = manifest(baseline); self.additions = manifest(additions)
        require(self.baseline and not set(self.baseline) & set(self.additions), 'disjoint baseline/additions')
        manifest({**self.baseline, **self.additions})
        require(sum(v['bytes'] for v in self.additions.values()) <= MAX_MUTATION_BYTES and len(self.additions) <= MAX_OPERATIONS, 'addition budget')
        try:
            self.tree = Root(tree, check); self.parent = Root(evidence_parent, check)
            require(tuple(root_identity) == self.tree.id[:2], 'owned root identity differs')
            for fd in self.parent.fds:
                check(); require(identity(os.fstat(fd))[:2] != self.tree.id[:2], 'evidence inside source')
            self.original_files, self.original_dirs = verify_tree(self.tree, self.baseline)
            self.parent.verify(); name = 'boundary-evidence-' + uuid.uuid4().hex
            os.mkdir(name, 0o700, dir_fd=self.parent.fd)
            fd = os.open(name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=self.parent.fd)
            try: original = identity(os.fstat(fd))
            finally: os.close(fd)
            self.evidence = Root(self.parent.path / name, check); require(self.evidence.id == original, 'new evidence root changed')
        except BaseException:
            self.failed = True; self.close(); raise

    def _live(self):
        require(not self.failed and not self.restored, 'mutation context unavailable'); self.check(); self.tree.verify(); self.evidence.verify()

    def _absent(self, root, name):
        with parent(root, name) as (owner, leaf, verify):
            try: os.stat(leaf, dir_fd=owner, follow_symlinks=False)
            except FileNotFoundError: pass
            else: raise ValueError('exclusive destination occupied')
            verify()

    def _move(self, source, name, destination, target):
        self.check()
        with parent(source, name) as (a, leaf, av), parent(destination, target) as (b, out, bv):
            self._absent(destination, target); before = identity(os.stat(leaf, dir_fd=a, follow_symlinks=False))
            os.rename(leaf, out, src_dir_fd=a, dst_dir_fd=b)
            require(identity(os.stat(out, dir_fd=b, follow_symlinks=False)) == before, 'renamed identity differs'); av(); bv(); self.check()

    def _link_target(self, record):
        """Bind the retained target to independent baseline bytes and its creation inode."""
        require(record['kind'] == 'symlink', 'declared symlink mutation required')
        target_name = record['original'] + '-link-target'
        require(record['target_name'] == target_name, 'fixed retained target name differs')
        expected = self.baseline[record['name']]
        require(record['target_metadata'] == expected, 'retained target baseline differs')
        _, observed = read(self.evidence, target_name, expected)
        require(list(observed) == record['target_identity'], 'retained target identity differs')
        return {'name':target_name, 'metadata':dict(expected), 'identity':list(observed)}

    def _retained_link(self, record):
        target = self._link_target(record)
        with parent(self.evidence, record['mutant']) as (owner, leaf, verify):
            s = os.stat(leaf, dir_fd=owner, follow_symlinks=False)
            require(stat.S_ISLNK(s.st_mode), 'retained mutant must remain symlink')
            require(list(leaf_identity(s)) == record['after']['identity'], 'retained symlink identity differs')
            require(os.readlink(leaf, dir_fd=owner) == record['after']['target'], 'retained symlink text differs')
            verify()
        return target

    def _state(self, name, record):
        with parent(self.tree, name, {**self.original_dirs, **self.created}) as (owner, leaf, verify):
            try: s = os.stat(leaf, dir_fd=owner, follow_symlinks=False)
            except FileNotFoundError: return {'kind':'absent'}
            if stat.S_ISLNK(s.st_mode):
                retained = self._link_target(record)
                target = os.readlink(leaf, dir_fd=owner)
                require(target == str(self.evidence.path / retained['name']), 'symlink target text differs')
                value = {'kind':'symlink','identity':list(leaf_identity(s)),'target':target,'retained_target':retained}
            else:
                expected = record['after_metadata']; _, ident = read(self.tree, name, expected)
                value = {'kind':'file','identity':list(ident),'metadata':expected}
            verify(); return value

    def _apply(self, kind, name, raw=None):
        try:
            self._live(); require((kind in ('replace','add') and type(raw) is bytes) or (kind in ('remove','symlink') and raw is None), 'formal mutation payload')
            require(len(self.records) < MAX_OPERATIONS and name not in {r['name']for r in self.records}, 'unique finite mutation')
            relative(name); require(name in (self.additions if kind == 'add' else self.baseline), 'undeclared mutation path')
            if raw is not None:
                require(type(raw) is bytes and self.total + len(raw) <= MAX_MUTATION_BYTES, 'mutation byte budget'); self.total += len(raw)
            record = {'name':name,'kind':kind,'original':'original-%02d'%len(self.records),'mutant':'mutant-%02d'%len(self.records),'complete':False}
            self.records.append(record)
            if kind == 'add':
                require({'bytes':len(raw),'sha256':digest(raw)} == self.additions[name], 'addition differs from fixed expectation')
                parts = relative(name)
                for i in range(1,len(parts)):
                    key = '/'.join(parts[:i])
                    if key in self.original_dirs or key in self.created: continue
                    with parent(self.tree,key,{**self.original_dirs,**self.created}) as (fd,leaf,verify):
                        self.check(); os.mkdir(leaf,0o700,dir_fd=fd); s=os.stat(leaf,dir_fd=fd,follow_symlinks=False)
                        require(stat.S_ISDIR(s.st_mode) and stat.S_IMODE(s.st_mode)==0o700,'new directory mode'); self.created[key]=identity(s); verify()
            else:
                before, ident = read(self.tree,name,self.baseline[name],keep=True)
                require(ident == self.original_files[name], 'original identity changed')
                self._move(self.tree,name,self.evidence,record['original'])
                if kind == 'symlink':
                    record['target_name'] = record['original'] + '-link-target'
                    record['target_metadata'] = dict(self.baseline[name])
                    record['target_identity'] = list(new_file(self.evidence,record['target_name'],before,self.check))
                    self._link_target(record)
                    target = str(self.evidence.path/record['target_name'])
                    with parent(self.tree,name,{**self.original_dirs,**self.created})as(fd,leaf,verify):
                        self.check(); os.symlink(target,leaf,dir_fd=fd); verify()
            if kind in ('replace','add'):
                record['after_metadata']={'bytes':len(raw),'sha256':digest(raw)}; new_file(self.tree,name,raw,self.check)
            record['after']=self._state(name,record); self.check(); record['complete']=True
            return record
        except BaseException:
            self.failed=True; raise

    def remove(self,name): return self._apply('remove',name)
    def replace(self,name,raw): return self._apply('replace',name,raw)
    def symlink_same_bytes(self,name): return self._apply('symlink',name)
    def add(self,name,raw): return self._apply('add',name,raw)

    def verify_mutated(self):
        """Prove the complete finite delta before invoking an expected refusal."""
        try:
            self._live(); require(self.records and all(r['complete'] for r in self.records), 'complete mutations required')
            records={r['name']:r for r in self.records}
            wanted=(set(self.baseline)|{r['name'] for r in self.records if r['kind']=='add'})-{r['name'] for r in self.records if r['kind']=='remove'}
            directories={**self.original_dirs,**self.created}; files=set(); seen_dirs=set()
            def visit(fd,prefix):
                self.check()
                with os.scandir(fd) as scan:
                    names=[]
                    for entry in scan:
                        self.check();names.append(entry.name);require(len(names)<=len(wanted)+len(directories),'mutation entry cap')
                for name in names:
                    self.check();key=prefix+name;s=os.stat(name,dir_fd=fd,follow_symlinks=False)
                    if stat.S_ISDIR(s.st_mode):
                        require(directories.get(key)==identity(s),'mutation directory differs');seen_dirs.add(key)
                        child=os.open(name,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW,dir_fd=fd)
                        try:
                            require(identity(os.fstat(child))==identity(s),'mutation directory replaced');visit(child,key+'/')
                        finally:os.close(child)
                    else:
                        require(key in wanted,'unexpected mutation file');files.add(key)
                        if key in records:require(self._state(key,records[key])==records[key]['after'],'mutant state differs')
                        else:
                            _,ident=read(self.tree,key,self.baseline[key]);require(ident==self.original_files[key],'unmodified baseline member changed')
            visit(self.tree.fd,'');require(files==wanted and seen_dirs==set(directories),'mutation complete keysets differ')
            for record in self.records:
                require(self._state(record['name'],record)==record['after'],'mutation record differs')
            self.tree.verify();self.check()
            return {'files':len(files),'directories':len(seen_dirs),'operations':len(self.records),'verified':True}
        except BaseException:
            self.failed=True;raise

    def restore(self):
        try:
            self._live(); require(self.records and all(r['complete']for r in self.records),'complete mutation required')
            # Admit every target before moving any original out of retained evidence.
            for record in self.records:
                if record['kind'] == 'symlink': self._link_target(record)
            for record in reversed(self.records):
                self.check(); name=record['name']; require(self._state(name,record)==record['after'],'mutant changed before restoration')
                if record['after']['kind']!='absent':self._move(self.tree,name,self.evidence,record['mutant'])
                if record['kind']!='add':
                    _,ident=read(self.evidence,record['original'],self.baseline[name]); require(ident==self.original_files[name],'saved original changed')
                    self._move(self.evidence,record['original'],self.tree,name)
            for ordinal,key in enumerate(sorted(self.created,key=lambda v:(v.count('/'),v),reverse=True)):
                self.check()
                with parent(self.tree,key,{**self.original_dirs,**self.created})as(fd,leaf,verify):
                    require(identity(os.stat(leaf,dir_fd=fd,follow_symlinks=False))==self.created[key],'created directory identity changed')
                    child=os.open(leaf,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW,dir_fd=fd)
                    try:
                        with os.scandir(child)as entries:require(next(entries,None)is None,'created directory not empty')
                    finally:os.close(child)
                    verify()
                self._move(self.tree,key,self.evidence,'created-directory-%02d'%ordinal)
            files,dirs=verify_tree(self.tree,self.baseline)
            require(files==self.original_files and dirs==self.original_dirs,'baseline identities differ after restore')
            for record in self.records:
                if record['kind'] == 'symlink': self._retained_link(record)
            self.check()
            receipt={'kind':'historical-boundary-mutation-restored-v1','restored':True,'operations':self.records,'created_directories':{k:list(v)for k,v in self.created.items()},'root_identity':list(self.tree.id[:2])}
            raw=(json.dumps(receipt,sort_keys=True,indent=2)+'\n').encode(); require(len(raw)<=1024**2,'mutation receipt cap')
            new_file(self.evidence,'restoration.json',raw,self.check)
            for record in self.records:
                if record['kind'] == 'symlink': self._retained_link(record)
            self.check(); self.restored=True; return receipt
        except BaseException:
            self.failed=True; raise

    def close(self):
        errors=[]
        for root in (self.evidence,self.parent,self.tree):
            if root is not None:
                try:root.close()
                except OSError as error:errors.append(error)
        if errors:
            primary=sys.exc_info()[1]
            if primary is not None:primary.add_note('Historical boundary final close failed: '+type(errors[0]).__name__)
            else:raise errors[0]
