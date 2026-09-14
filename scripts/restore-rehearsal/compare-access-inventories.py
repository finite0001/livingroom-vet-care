"""Compare access inventories without printing policy expressions or object data."""
import argparse
import json
import re
from pathlib import Path


FIELDS = {
    'relations': {'name','kind','owner','rls','force_rls','grants'},
    'policies': {'schemaname','tablename','policyname','permissive','roles','cmd','qual','with_check'},
    'default_privileges': {'owner','kind','schema','acl'},
}
IDENTITIES = {
    'relations': ('name',),
    'policies': ('schemaname','tablename','policyname'),
    'default_privileges': ('owner','schema','kind'),
}


def indexed(value):
    if not isinstance(value,dict) or set(value) != {'versions',*FIELDS}:
        raise ValueError('Incomplete access inventory')
    versions=value['versions']
    if not isinstance(versions,list) or not versions or any(not isinstance(v,str) or not re.fullmatch(r'\d{14}',v) for v in versions) or versions != sorted(set(versions)):
        raise ValueError('Invalid migration versions')
    result={}
    for family,fields in FIELDS.items():
        rows=value[family]
        if not isinstance(rows,list) or (family=='relations' and not rows):
            raise ValueError('Missing relation inventory')
        entries={}
        for row in rows:
            if not isinstance(row,dict) or set(row)!=fields:
                raise ValueError('Unexpected inventory fields')
            parts=[row[k] for k in IDENTITIES[family]]
            if any(not isinstance(v,str) or not v for v in parts):
                raise ValueError('Invalid object identity')
            key=json.dumps(parts,separators=(',',':'))
            if key in entries:
                raise ValueError('Duplicate object identity')
            if family=='relations':
                if row['kind'] not in ('r','p','v','m','S') or type(row['rls']) is not bool or type(row['force_rls']) is not bool:
                    raise ValueError('Invalid relation access flags')
                grants=row['grants']
                if not isinstance(grants,dict) or set(grants)!={'anon','authenticated','service_role'}:
                    raise ValueError('Missing role grants')
                privileges={'USAGE','SELECT','UPDATE'} if row['kind']=='S' else {'SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN'}
                if any(not isinstance(g,dict) or set(g)!=privileges or any(type(v) is not bool for v in g.values()) for g in grants.values()):
                    raise ValueError('Invalid effective privileges')
            elif family=='policies':
                if row['schemaname']!='public' or row['permissive'] not in ('PERMISSIVE','RESTRICTIVE') or row['cmd'] not in ('ALL','SELECT','INSERT','UPDATE','DELETE'):
                    raise ValueError('Invalid policy scope')
                if not isinstance(row['roles'],list) or not row['roles'] or any(not isinstance(r,str) or not r for r in row['roles']):
                    raise ValueError('Invalid policy roles')
                if any(row[k] is not None and not isinstance(row[k],str) for k in ('qual','with_check')):
                    raise ValueError('Invalid policy expression')
            else:
                if row['schema'] not in ('*','public') or row['kind'] not in ('r','S','f','T','n','L') or (row['acl'] is not None and not isinstance(row['acl'],list)):
                    raise ValueError('Invalid default privilege scope')
                for acl in row['acl'] or []:
                    if not isinstance(acl,dict) or set(acl)!={'grantee','grantor','privilege','grantable'} or type(acl['grantable']) is not bool or any(not isinstance(acl[k],str) or not acl[k] for k in ('grantee','grantor','privilege')):
                        raise ValueError('Invalid default ACL')
            entries[key]=row
        result[family]=entries
    return result


def compare(expected,observed):
    left,right=indexed(expected),indexed(observed)
    report={'migration_versions_match':expected['versions']==observed['versions']}
    for family in FIELDS:
        a,b=left[family],right[family]
        report[family]={'expected_count':len(a),'observed_count':len(b),
            'missing':sorted(a.keys()-b.keys()),'extra':sorted(b.keys()-a.keys()),
            'changed':{k:sorted(field for field in FIELDS[family] if a[k][field]!=b[k][field]) for k in sorted(a.keys()&b.keys()) if a[k]!=b[k]}}
    report['matches']=report['migration_versions_match'] and all(not report[f]['missing'] and not report[f]['extra'] and not report[f]['changed'] for f in FIELDS)
    return report


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('expected',type=Path);parser.add_argument('observed',type=Path)
    args=parser.parse_args()
    result=compare(json.loads(args.expected.read_text()),json.loads(args.observed.read_text()))
    print(json.dumps(result,indent=2))
    raise SystemExit(0 if result['matches'] else 1)
