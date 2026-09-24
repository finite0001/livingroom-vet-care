#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { mkdirSync } from 'node:fs';

const files = {
  practice: 'src/config/practice.ts',
  publicSite: 'src/config/public-site.ts',
  contact: 'src/pages/Contact.tsx',
  robots: 'public/robots.txt',
  sitemap: 'public/sitemap.xml',
  privacy: 'src/pages/Privacy.tsx',
  terms: 'src/pages/Terms.tsx',
};

function read(path) {
  return readFileSync(path, 'utf8');
}

function hasNullSetting(source, setting) {
  return new RegExp(`\\b${setting}:\\s*null\\b`).test(source);
}

function extractPublicRoutePaths(source) {
  return [...source.matchAll(/path:\s*"([^"]+)"/g)].map((match) => match[1]);
}

function extractSitemapPaths(source) {
  return [...source.matchAll(/<loc>https:\/\/thelivingroom\.vet([^<]*)<\/loc>/g)].map((match) => match[1]);
}

function addFinding(findings, severity, area, message, evidence) {
  findings.push({ severity, area, message, evidence });
}

const practice = read(files.practice);
const publicSite = read(files.publicSite);
const contact = read(files.contact);
const robots = read(files.robots);
const sitemap = read(files.sitemap);
const privacy = read(files.privacy);
const terms = read(files.terms);

const findings = [];

for (const setting of ['phone', 'email', 'emergencyPhone', 'hours']) {
  if (hasNullSetting(practice, setting)) {
    addFinding(
      findings,
      'blocker',
      'owner-content',
      `Practice ${setting} is not configured for public launch.`,
      `${files.practice}: ${setting}: null`,
    );
  }
}

if (!/domain:\s*"thelivingroom\.vet"/.test(practice)) {
  addFinding(
    findings,
    'blocker',
    'seo-domain',
    'Practice domain is not set to the public launch domain.',
    files.practice,
  );
}

if (!/not a confirmed appointment/i.test(contact) || !/avoid including medical records or sensitive payment information/i.test(contact)) {
  addFinding(
    findings,
    'blocker',
    'contact-form',
    'Contact form must clearly state that submission is not an appointment and should not include sensitive records/payment information.',
    files.contact,
  );
}

if (!/not emergency monitored/i.test(contact) && !/not monitored for emergencies/i.test(contact)) {
  addFinding(
    findings,
    'blocker',
    'contact-form',
    'Contact page must clearly explain that the form is not monitored for emergencies.',
    files.contact,
  );
}

if (!/Disallow:\s*\/hub\b/.test(robots)) {
  addFinding(findings, 'blocker', 'seo-robots', 'robots.txt must disallow Hub routes.', files.robots);
}

if (!/Sitemap:\s*https:\/\/thelivingroom\.vet\/sitemap\.xml/.test(robots)) {
  addFinding(findings, 'blocker', 'seo-robots', 'robots.txt must point to the public launch sitemap.', files.robots);
}

const routePaths = extractPublicRoutePaths(publicSite);
const sitemapPaths = extractSitemapPaths(sitemap);
const missingFromSitemap = routePaths.filter((path) => !sitemapPaths.includes(path));
const extraSitemapPaths = sitemapPaths.filter((path) => !routePaths.includes(path));

if (missingFromSitemap.length > 0) {
  addFinding(
    findings,
    'blocker',
    'seo-sitemap',
    'Some public route metadata paths are missing from sitemap.xml.',
    missingFromSitemap,
  );
}

if (extraSitemapPaths.length > 0) {
  addFinding(
    findings,
    'warning',
    'seo-sitemap',
    'sitemap.xml contains paths not found in public route metadata.',
    extraSitemapPaths,
  );
}

for (const [label, source, path] of [
  ['privacy policy', privacy, files.privacy],
  ['terms', terms, files.terms],
]) {
  if (!/owner|legal|review|approved/i.test(source)) {
    addFinding(
      findings,
      'warning',
      'legal-review',
      `${label} page should retain an owner/legal review marker until formally approved.`,
      path,
    );
  }
}

const riskyClaimPatterns = [
  { pattern: /\bsame-day\b/i, label: 'same-day availability' },
  { pattern: /\bin-house labs?\b/i, label: 'in-house lab capability' },
  { pattern: /\bwithin minutes\b/i, label: 'minutes-level turnaround' },
  { pattern: /\b\d+%\b/i, label: 'numeric outcome/statistical claim' },
];

const publicCopyFiles = [
  'src/pages/Services.tsx',
  'src/pages/Experience.tsx',
  'src/pages/About.tsx',
  'src/pages/services/Diagnostics.tsx',
  'src/pages/services/IllnessCare.tsx',
  'src/components/sections/experience/WhyItMatters.tsx',
  'src/components/sections/experience/VirtualTour.tsx',
];

for (const { pattern, label } of riskyClaimPatterns) {
  for (const path of publicCopyFiles) {
    const source = read(path);

    if (pattern.test(source)) {
      addFinding(
        findings,
        'warning',
        'content-claims',
        `Public content contains a claim that needs owner/veterinarian approval before launch: ${label}.`,
        path,
      );
    }
  }
}

const blockers = findings.filter((finding) => finding.severity === 'blocker');
const warnings = findings.filter((finding) => finding.severity === 'warning');

const report = {
  generatedAt: new Date().toISOString(),
  status: blockers.length === 0 ? 'ready-for-owner-review' : 'not-launch-ready',
  summary: {
    blockers: blockers.length,
    warnings: warnings.length,
    publicRoutes: routePaths.length,
    sitemapRoutes: sitemapPaths.length,
  },
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
  console.log(`Wrote public site readiness report to ${resolvedPath}`);
} else {
  process.stdout.write(json);
}

if (process.argv.includes('--fail-on-blockers') && blockers.length > 0) {
  process.exit(1);
}
