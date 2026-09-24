#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const defaultRegisterPath = 'docs/clinical-staff-acceptance-register.json';
const registerPath = getFlagValue('--register') ?? defaultRegisterPath;
const targetProjectRef = 'mgadheotkdnrsatfivjy';
const acceptableTerminalDecisions = new Set(['Accept', 'Not in pilot scope']);
const allowedDecisions = new Set(['Pending', 'Accept', 'Accept after correction', 'Reject', 'Not in pilot scope']);

function getFlagValue(flag) {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : null;
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function check(id, label, status, blockers = [], warnings = [], evidence = {}) {
  return { id, label, status, blockers, warnings, evidence };
}

function statusFrom(blockers, warnings = []) {
  if (blockers.length > 0) {
    return 'blocked';
  }

  return warnings.length > 0 ? 'warning' : 'pass';
}

function decisionBuckets(items) {
  const buckets = {
    pending: [],
    accepted: [],
    acceptedAfterCorrection: [],
    rejected: [],
    notInPilotScope: [],
    invalid: [],
  };

  for (const item of items) {
    if (!allowedDecisions.has(item.decision)) {
      buckets.invalid.push(item);
    } else if (item.decision === 'Pending') {
      buckets.pending.push(item);
    } else if (item.decision === 'Accept') {
      buckets.accepted.push(item);
    } else if (item.decision === 'Accept after correction') {
      buckets.acceptedAfterCorrection.push(item);
    } else if (item.decision === 'Reject') {
      buckets.rejected.push(item);
    } else if (item.decision === 'Not in pilot scope') {
      buckets.notInPilotScope.push(item);
    }
  }

  return buckets;
}

function itemRefs(items) {
  return items.map((item) => item.id).sort((left, right) => left.localeCompare(right));
}

function hasEvidence(item) {
  return Array.isArray(item.evidence) && item.evidence.length > 0;
}

const register = readJson(registerPath);
const clinical = Array.isArray(register.clinicalDecisions) ? register.clinicalDecisions : [];
const staffRun = register.staffAcceptanceRun ?? {};
const staffSteps = Array.isArray(staffRun.steps) ? staffRun.steps : [];

const registerBlockers = [];
const registerWarnings = [];

if (register.targetProjectRef !== targetProjectRef) {
  registerBlockers.push(`Acceptance register target project is ${register.targetProjectRef ?? 'missing'}, expected ${targetProjectRef}.`);
}

if (clinical.length === 0) {
  registerBlockers.push('Acceptance register has no clinical decision rows.');
}

if (staffSteps.length === 0) {
  registerBlockers.push('Acceptance register has no staff workflow rows.');
}

const clinicalBuckets = decisionBuckets(clinical);
const clinicalBlockers = [];
const clinicalWarnings = [];

if (clinicalBuckets.invalid.length > 0) {
  clinicalBlockers.push(`Clinical rows have invalid decisions: ${itemRefs(clinicalBuckets.invalid).join(', ')}.`);
}

if (clinicalBuckets.pending.length > 0) {
  clinicalBlockers.push(`${clinicalBuckets.pending.length} clinical review decisions are pending: ${itemRefs(clinicalBuckets.pending).join(', ')}.`);
}

if (clinicalBuckets.acceptedAfterCorrection.length > 0) {
  clinicalBlockers.push(
    `${clinicalBuckets.acceptedAfterCorrection.length} clinical decisions require corrected evidence/rerun: ${itemRefs(clinicalBuckets.acceptedAfterCorrection).join(', ')}.`,
  );
}

if (clinicalBuckets.rejected.length > 0) {
  clinicalBlockers.push(`${clinicalBuckets.rejected.length} clinical decisions are rejected: ${itemRefs(clinicalBuckets.rejected).join(', ')}.`);
}

const acceptedClinicalWithoutEvidence = clinicalBuckets.accepted.filter((item) => !hasEvidence(item));
if (acceptedClinicalWithoutEvidence.length > 0) {
  clinicalWarnings.push(`Accepted clinical decisions without linked evidence: ${itemRefs(acceptedClinicalWithoutEvidence).join(', ')}.`);
}

if (clinicalBuckets.notInPilotScope.length > 0) {
  clinicalWarnings.push(`Clinical rows marked out of pilot scope: ${itemRefs(clinicalBuckets.notInPilotScope).join(', ')}.`);
}

const staffMetadataBlockers = [];
const staffMetadataWarnings = [];

for (const [field, label] of [
  ['operator', 'operator'],
  ['dateTime', 'date/time'],
  ['frontendUrl', 'frontend URL'],
  ['commitOrDeployment', 'commit/deployment'],
]) {
  if (!staffRun[field]) {
    staffMetadataBlockers.push(`Staff acceptance ${label} is not recorded.`);
  }
}

if (staffRun.supabaseProject !== targetProjectRef) {
  staffMetadataBlockers.push(`Staff acceptance Supabase project is ${staffRun.supabaseProject ?? 'missing'}, expected ${targetProjectRef}.`);
}

if (!/^disabled\/test-only$/i.test(staffRun.outboundMode ?? '')) {
  staffMetadataBlockers.push('Staff acceptance outbound mode must remain Disabled/test-only before provider commissioning.');
}

const knownExceptions = Array.isArray(staffRun.knownExceptions) ? staffRun.knownExceptions.join(' ') : '';
if (!/phone/i.test(knownExceptions) || !/cloudtalk/i.test(knownExceptions)) {
  staffMetadataWarnings.push('Known exceptions should explicitly preserve deferred phone and CloudTalk gates.');
}

const staffBuckets = decisionBuckets(staffSteps);
const staffWorkflowBlockers = [];
const staffWorkflowWarnings = [];

if (staffBuckets.invalid.length > 0) {
  staffWorkflowBlockers.push(`Staff workflow rows have invalid decisions: ${itemRefs(staffBuckets.invalid).join(', ')}.`);
}

if (staffBuckets.pending.length > 0) {
  staffWorkflowBlockers.push(`${staffBuckets.pending.length} staff workflow steps are pending: ${itemRefs(staffBuckets.pending).join(', ')}.`);
}

if (staffBuckets.acceptedAfterCorrection.length > 0) {
  staffWorkflowBlockers.push(
    `${staffBuckets.acceptedAfterCorrection.length} staff workflow steps require corrected evidence/rerun: ${itemRefs(staffBuckets.acceptedAfterCorrection).join(', ')}.`,
  );
}

if (staffBuckets.rejected.length > 0) {
  staffWorkflowBlockers.push(`${staffBuckets.rejected.length} staff workflow steps are rejected: ${itemRefs(staffBuckets.rejected).join(', ')}.`);
}

const acceptedStaffWithoutEvidence = staffBuckets.accepted.filter((item) => !hasEvidence(item));
if (acceptedStaffWithoutEvidence.length > 0) {
  staffWorkflowWarnings.push(`Accepted staff workflow steps without linked evidence: ${itemRefs(acceptedStaffWithoutEvidence).join(', ')}.`);
}

if (staffBuckets.notInPilotScope.length > 0) {
  staffWorkflowWarnings.push(`Staff workflow rows marked out of pilot scope: ${itemRefs(staffBuckets.notInPilotScope).join(', ')}.`);
}

const deferredFinalGates = Array.isArray(register.deferredFinalGates) ? register.deferredFinalGates : [];
const deferredWarnings = [];

if (!deferredFinalGates.some((gate) => /phone/i.test(gate)) || !deferredFinalGates.some((gate) => /cloudtalk/i.test(gate))) {
  deferredWarnings.push('Deferred final gates should explicitly include phone and CloudTalk.');
}

const checks = [
  check('register-shape', 'Acceptance register shape and target', statusFrom(registerBlockers, registerWarnings), registerBlockers, registerWarnings, {
    registerPath,
    targetProjectRef,
    clinicalRows: clinical.length,
    staffWorkflowRows: staffSteps.length,
  }),
  check('clinical-decisions', 'Clinical reviewer decisions', statusFrom(clinicalBlockers, clinicalWarnings), clinicalBlockers, clinicalWarnings, {
    counts: {
      pending: clinicalBuckets.pending.length,
      accepted: clinicalBuckets.accepted.length,
      acceptedAfterCorrection: clinicalBuckets.acceptedAfterCorrection.length,
      rejected: clinicalBuckets.rejected.length,
      notInPilotScope: clinicalBuckets.notInPilotScope.length,
      invalid: clinicalBuckets.invalid.length,
    },
  }),
  check(
    'staff-run-metadata',
    'Staff acceptance run metadata',
    statusFrom(staffMetadataBlockers, staffMetadataWarnings),
    staffMetadataBlockers,
    staffMetadataWarnings,
    {
      operator: staffRun.operator ?? null,
      dateTime: staffRun.dateTime ?? null,
      frontendUrl: staffRun.frontendUrl ?? null,
      supabaseProject: staffRun.supabaseProject ?? null,
      commitOrDeployment: staffRun.commitOrDeployment ?? null,
      outboundMode: staffRun.outboundMode ?? null,
      knownExceptions: staffRun.knownExceptions ?? [],
    },
  ),
  check('staff-workflow-decisions', 'Staff workflow acceptance decisions', statusFrom(staffWorkflowBlockers, staffWorkflowWarnings), staffWorkflowBlockers, staffWorkflowWarnings, {
    counts: {
      pending: staffBuckets.pending.length,
      accepted: staffBuckets.accepted.length,
      acceptedAfterCorrection: staffBuckets.acceptedAfterCorrection.length,
      rejected: staffBuckets.rejected.length,
      notInPilotScope: staffBuckets.notInPilotScope.length,
      invalid: staffBuckets.invalid.length,
    },
  }),
  check('deferred-final-gates', 'Deferred final phone and CloudTalk gates', statusFrom([], deferredWarnings), [], deferredWarnings, {
    deferredFinalGates,
  }),
];

const blockers = checks.flatMap((item) => item.blockers.map((message) => ({ check: item.id, message })));
const warnings = checks.flatMap((item) => item.warnings.map((message) => ({ check: item.id, message })));
const status = blockers.length > 0 ? 'blocked' : warnings.length > 0 ? 'warning' : 'accepted';

const report = {
  generatedAt: new Date().toISOString(),
  status,
  scope: 'Clinical and staff acceptance readiness before phone number and CloudTalk commissioning.',
  registerPath,
  targetProjectRef,
  checks,
  blockers,
  warnings,
};

const outputFlagIndex = process.argv.indexOf('--output');
const outputPath = outputFlagIndex >= 0 ? process.argv[outputFlagIndex + 1] : null;
const json = `${JSON.stringify(report, null, 2)}\n`;

if (outputPath) {
  const resolvedPath = resolve(outputPath);
  mkdirSync(dirname(resolvedPath), { recursive: true });
  writeFileSync(resolvedPath, json);
  console.log(`Wrote clinical/staff acceptance readiness to ${resolvedPath}`);
} else {
  process.stdout.write(json);
}

if (status === 'blocked') {
  process.exit(1);
}
