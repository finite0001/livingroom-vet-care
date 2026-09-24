#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { mkdirSync } from 'node:fs';

const evidenceDirectory = 'docs/launch-evidence';
const remoteSchemaInventoryPath =
  getFlagValue('--schema-inventory') ?? latestEvidenceFile(/^\d{4}-\d{2}-\d{2}-remote-public-schema-inventory\.json$/);
const edgeFunctionInventoryPath =
  getFlagValue('--functions-inventory') ?? latestEvidenceFile(/^\d{4}-\d{2}-\d{2}-edge-functions-inventory\.json$/);

const files = {
  app: 'src/App.tsx',
  desktopSidebar: 'src/hub/components/layout/DesktopSidebar.tsx',
  bottomTabBar: 'src/hub/components/layout/BottomTabBar.tsx',
  hubHome: 'src/hub/pages/HubHomePage.tsx',
  remoteSchemaInventory: remoteSchemaInventoryPath,
  edgeFunctionInventory: edgeFunctionInventoryPath,
};

const workflows = [
  {
    id: 'contact-submissions',
    label: 'Contact submission triage',
    route: '/hub/contact-submissions',
    page: 'src/hub/pages/ContactSubmissionsPage.tsx',
    hook: 'src/hub/hooks/use-contact-submissions.ts',
    pageSymbol: 'ContactSubmissionsPage',
    hookSymbols: ['useContactSubmissions', 'useContactSubmissionCount'],
    requiredHookPatterns: [
      /contact_submissions/g,
      /triage_status/g,
      /reviewed_by/g,
      /contacted_at/g,
      /closed_at/g,
    ],
    hostedObjects: {
      functions: ['public.guard_contact_submission'],
    },
  },
  {
    id: 'appointments',
    label: 'Appointment create/edit/cancel workflow',
    route: '/hub/appointments',
    page: 'src/hub/pages/AppointmentsPage.tsx',
    hook: 'src/hub/hooks/use-appointments.ts',
    pageSymbol: 'AppointmentsPage',
    hookSymbols: ['useAppointmentsForDay', 'useCreateAppointment', 'useUpdateAppointment', 'useCancelAppointment'],
    requiredHookPatterns: [
      /save_appointment/g,
      /cancel_appointment/g,
      /version/g,
    ],
    hostedObjects: {
      functions: ['public.save_appointment', 'public.cancel_appointment'],
    },
  },
  {
    id: 'outbound-deliveries',
    label: 'Outbound delivery operations',
    route: '/hub/deliveries',
    page: 'src/hub/pages/DeliveriesPage.tsx',
    hook: 'src/hub/hooks/use-outbound-deliveries.ts',
    pageSymbol: 'DeliveriesPage',
    hookSymbols: ['useOutboundDeliveries', 'useRetryOutboundDelivery', 'useCancelOutboundDelivery'],
    requiredHookPatterns: [
      /outbound_deliveries/g,
      /retry_outbound_delivery/g,
      /cancel_outbound_delivery/g,
      /updated_at/g,
    ],
    hostedObjects: {
      tables: ['public.outbound_deliveries'],
      functions: ['public.retry_outbound_delivery', 'public.cancel_outbound_delivery'],
    },
    hostedFunctions: [
      'dispatch-outbound-deliveries',
      'resend-delivery-webhook',
      'twilio-message-status-callback',
      'twilio-inbound-sms',
    ],
  },
];

function read(path) {
  return readFileSync(path, 'utf8');
}

function addFinding(findings, severity, workflow, area, message, evidence) {
  findings.push({ severity, workflow, area, message, evidence });
}

function hasRoute(appSource, route, pageSymbol) {
  return appSource.includes(`path="${route}"`) && appSource.includes(`<${pageSymbol} />`);
}

function hasNav(navSource, route) {
  return navSource.includes(`path: "${route}"`);
}

function loadJson(path) {
  if (!path) {
    return null;
  }

  if (!existsSync(path)) {
    return null;
  }

  return JSON.parse(read(path));
}

function getFlagValue(flag) {
  const flagIndex = process.argv.indexOf(flag);
  return flagIndex >= 0 ? process.argv[flagIndex + 1] : null;
}

function latestEvidenceFile(pattern) {
  const matches = readdirSync(evidenceDirectory)
    .filter((name) => pattern.test(name))
    .sort((left, right) => left.localeCompare(right));

  if (matches.length === 0) {
    return null;
  }

  return `${evidenceDirectory}/${matches.at(-1)}`;
}

function hostedPresence(schemaInventory, functionInventory, workflow) {
  const result = [];

  for (const table of workflow.hostedObjects?.tables ?? []) {
    const item = schemaInventory?.readinessPresence?.tables?.find((candidate) => candidate.name === table);
    result.push({ kind: 'table', name: table, present: Boolean(item?.present) });
  }

  for (const fn of workflow.hostedObjects?.functions ?? []) {
    const item = schemaInventory?.readinessPresence?.functions?.find((candidate) => candidate.name === fn);
    result.push({ kind: 'database-function', name: fn, present: Boolean(item?.present) });
  }

  for (const slug of workflow.hostedFunctions ?? []) {
    const item = functionInventory?.readinessPresence?.find((candidate) => candidate.slug === slug);
    result.push({
      kind: 'edge-function',
      name: slug,
      present: Boolean(item?.remotePresent),
      verifyJwtMatches: Boolean(item?.verifyJwtMatches),
    });
  }

  return result;
}

const appSource = read(files.app);
const desktopNavSource = read(files.desktopSidebar);
const mobileNavSource = read(files.bottomTabBar);
const hubHomeSource = read(files.hubHome);
const schemaInventory = loadJson(files.remoteSchemaInventory);
const functionInventory = loadJson(files.edgeFunctionInventory);
const findings = [];

const workflowReports = workflows.map((workflow) => {
  const pageExists = existsSync(workflow.page);
  const hookExists = existsSync(workflow.hook);
  const pageSource = pageExists ? read(workflow.page) : '';
  const hookSource = hookExists ? read(workflow.hook) : '';

  if (!pageExists) {
    addFinding(findings, 'blocker', workflow.id, 'local-page', 'Workflow page file is missing.', workflow.page);
  }

  if (!hookExists) {
    addFinding(findings, 'blocker', workflow.id, 'local-hook', 'Workflow hook file is missing.', workflow.hook);
  }

  if (!hasRoute(appSource, workflow.route, workflow.pageSymbol)) {
    addFinding(findings, 'blocker', workflow.id, 'routing', 'Workflow route is not wired to the expected page.', `${files.app}: ${workflow.route}`);
  }

  if (!hasNav(desktopNavSource, workflow.route)) {
    addFinding(findings, 'blocker', workflow.id, 'desktop-nav', 'Workflow route is missing from desktop Hub navigation.', files.desktopSidebar);
  }

  if (!hasNav(mobileNavSource, workflow.route)) {
    addFinding(findings, 'blocker', workflow.id, 'mobile-nav', 'Workflow route is missing from mobile Hub navigation.', files.bottomTabBar);
  }

  for (const symbol of workflow.hookSymbols) {
    if (!hookSource.includes(symbol)) {
      addFinding(findings, 'blocker', workflow.id, 'hook-api', `Expected hook export or symbol is missing: ${symbol}.`, workflow.hook);
    }
  }

  for (const pattern of workflow.requiredHookPatterns) {
    if (!pattern.test(hookSource)) {
      addFinding(findings, 'blocker', workflow.id, 'hook-contract', `Expected hook contract pattern is missing: ${pattern.source}.`, workflow.hook);
    }
  }

  if (!pageSource.includes(workflow.hook.replace('src/hub/hooks/', '@/hub/hooks/').replace('.ts', ''))) {
    addFinding(findings, 'warning', workflow.id, 'page-hook', 'Workflow page does not appear to import its expected hook module.', workflow.page);
  }

  const hosted = hostedPresence(schemaInventory, functionInventory, workflow);
  for (const item of hosted) {
    if (!item.present) {
      addFinding(
        findings,
        'hosted-blocker',
        workflow.id,
        'hosted-dependency',
        `Hosted dependency is missing: ${item.kind} ${item.name}.`,
        item,
      );
    }
  }

  return {
    id: workflow.id,
    label: workflow.label,
    route: workflow.route,
    page: workflow.page,
    hook: workflow.hook,
    local: {
      pageExists,
      hookExists,
      routeWired: hasRoute(appSource, workflow.route, workflow.pageSymbol),
      desktopNav: hasNav(desktopNavSource, workflow.route),
      mobileNav: hasNav(mobileNavSource, workflow.route),
      hubHomeMentionsRoute: hubHomeSource.includes(workflow.route),
    },
    hosted,
  };
});

const blockers = findings.filter((finding) => finding.severity === 'blocker');
const hostedBlockers = findings.filter((finding) => finding.severity === 'hosted-blocker');
const warnings = findings.filter((finding) => finding.severity === 'warning');

const report = {
  generatedAt: new Date().toISOString(),
  status: blockers.length === 0 ? 'local-hub-ready' : 'local-hub-not-ready',
  hostedStatus: hostedBlockers.length === 0 ? 'hosted-dependencies-ready' : 'hosted-dependencies-blocked',
  summary: {
    workflows: workflows.length,
    blockers: blockers.length,
    hostedBlockers: hostedBlockers.length,
    warnings: warnings.length,
  },
  evidence: {
    remoteSchemaInventory: files.remoteSchemaInventory,
    edgeFunctionInventory: files.edgeFunctionInventory,
  },
  workflowReports,
  findings,
};

const json = `${JSON.stringify(report, null, 2)}\n`;
const outputFlagIndex = process.argv.indexOf('--output');

if (outputFlagIndex >= 0) {
  const outputPath = process.argv[outputFlagIndex + 1];

  if (!outputPath) {
    console.error('Missing path after --output.');
    process.exit(1);
  }

  const resolvedPath = resolve(outputPath);
  mkdirSync(dirname(resolvedPath), { recursive: true });
  writeFileSync(resolvedPath, json);
  console.log(`Wrote Hub workflow readiness report to ${resolvedPath}`);
} else {
  process.stdout.write(json);
}

if (process.argv.includes('--fail-on-blockers') && (blockers.length > 0 || hostedBlockers.length > 0)) {
  process.exit(1);
}
