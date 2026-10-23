"""Run the actual JS containment assertions without Docker or a database."""
import copy
import json
from pathlib import Path
import re
import subprocess
import unittest


FIXTURE=Path(__file__).with_name('fixture.mjs')
# Reviewed canonical sources: B1 (20260922120000), payload purge
# (20260930130000), reconciliation (20261014154223), invoices (20261015235157).
JOBS=['cleanup-abandoned-attachment','dispatch-outbox','process-inbound',
      'process-stripe-events','purge-expired-email-payloads','queue-invoice-reminders',
      'queue-reminders','reconcile-operational-tasks','scheduler-reconcile']
MIGRATIONS=Path(__file__).resolve().parents[2]/'supabase/migrations'
SOURCES=(
    '20260922120000_b1_scheduler.sql',
    '20260930130000_scheduler_timeout_and_payload_purge.sql',
    '20261014154223_operational_task_reconciliation.sql',
    '20261015235157_unpaid_invoice_reminders.sql')


class SchedulerContainmentTests(unittest.TestCase):
    def test_fixed_expectations_match_four_canonical_migration_definitions(self):
        sources={name:(MIGRATIONS/name).read_text()for name in SOURCES}
        scheduled=[job for source in sources.values()
            for job in re.findall(r"cron\.schedule\('([^']+)'\s*,",source)]
        self.assertEqual(sorted(scheduled),JOBS)
        self.assertEqual(len(scheduled),len(set(scheduled)))
        # Require the exact assignment and following disable of the SAME job_id,
        # not merely an unrelated active=false statement elsewhere in the file.
        for filename,job in (
            (SOURCES[2],'reconcile-operational-tasks'),
            (SOURCES[3],'queue-invoice-reminders')):
            binding=(r"job_id\s*:=\s*cron\.schedule\('"+re.escape(job)+
                r"',[^\n]+\);\s*perform cron\.alter_job\(job_id,\s*active\s*:=\s*false\);")
            self.assertEqual(len(re.findall(binding,sources[filename])),1)
        self.assertEqual(sum(source.count('cron.alter_job(')for source in sources.values()),2)

    def fixture(self):
        return dict(pg_cron_installed=True,pg_net_installed=True,
            launch_active_jobs='off',vault_scheduler_secret_count=0,
            inactive_job_flags={'queue-invoice-reminders':False,'reconcile-operational-tasks':False},
            cron_jobs=list(JOBS),unexpected_cron_jobs=[])

    def execute(self,value):
        source=FIXTURE.read_text()
        start='  const expectedSchedulerJobs = ['
        end='  const schedulerDispatchProbe = JSON.parse('
        self.assertEqual(source.count(start),1);self.assertEqual(source.count(end),1)
        block=source[source.index(start):source.index(end)]
        # Only the observation callback is stubbed. The real finite expectation,
        # query assembly and every assertion run directly from fixture.mjs.
        script="const assert = require('node:assert/strict');\n"
        script+="const observation = "+json.dumps(value)+";\n"
        script+=r"""let calls=0;
const sql=(query)=>{
  calls++;
  assert.match(query,/current_setting\('cron.launch_active_jobs'\)/);
  assert.match(query,/jsonb_object_agg\(jobname,active\)/);
  assert.match(query,/where jobname in \('queue-invoice-reminders','reconcile-operational-tasks'\)/);
  assert.match(query,/where jobname not in \(select name from expected\)/);
  assert.match(query,/vault.decrypted_secrets/);
  return JSON.stringify(observation);
};
"""
        script+=block+'\nassert.equal(calls,1);\n'
        return subprocess.run(['node','--input-type=commonjs','-'],input=script,text=True,capture_output=True,timeout=10)

    def test_nine_canonical_jobs_with_containment_pass(self):
        result=self.execute(self.fixture())
        self.assertEqual(result.returncode,0,result.stderr)

    def test_missing_unexpected_and_duplicate_jobs_refuse(self):
        changes=(lambda v:v['cron_jobs'].pop(),
            lambda v:v['unexpected_cron_jobs'].append('unreviewed-job'),
            lambda v:v['cron_jobs'].append('dispatch-outbox'))
        for change in changes:
            value=self.fixture();change(value)
            with self.subTest(value=value):self.assertNotEqual(self.execute(value).returncode,0)

    def test_either_default_off_job_enabled_or_missing_refuses(self):
        for name in ('queue-invoice-reminders','reconcile-operational-tasks'):
            for mutation in ('enabled','missing','non_boolean'):
                value=self.fixture()
                if mutation=='missing':value['inactive_job_flags'].pop(name)
                else:value['inactive_job_flags'][name]=True if mutation=='enabled' else 0
                with self.subTest(name=name,mutation=mutation):
                    self.assertNotEqual(self.execute(value).returncode,0)

    def test_scheduler_enabled_or_vault_credentials_refuse(self):
        for change in (lambda v:v.update(launch_active_jobs='on'),
            lambda v:v.update(vault_scheduler_secret_count=1),
            lambda v:v.update(pg_cron_installed=False),lambda v:v.update(pg_net_installed=False)):
            value=copy.deepcopy(self.fixture());change(value)
            with self.subTest(value=value):self.assertNotEqual(self.execute(value).returncode,0)


if __name__=='__main__':unittest.main()
