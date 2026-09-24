#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

echo "Checking tracked Vercel build contract..."
node --input-type=module <<'NODE'
import fs from 'node:fs';

const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const vercelJson = JSON.parse(fs.readFileSync('vercel.json', 'utf8'));

if (packageJson.scripts?.['build:deployment'] !== 'npm run build') {
  throw new Error('package.json must define scripts.build:deployment as "npm run build".');
}

if (vercelJson.buildCommand !== 'npm run build:deployment') {
  throw new Error('vercel.json buildCommand must be "npm run build:deployment".');
}

if (vercelJson.outputDirectory !== 'dist') {
  throw new Error('vercel.json outputDirectory must be "dist".');
}
NODE

if command -v xmllint >/dev/null 2>&1; then
  echo "Checking sitemap XML..."
  xmllint --noout public/sitemap.xml
else
  echo "Skipping sitemap XML validation because xmllint is not installed."
fi

npm run lint
npm run typecheck
npm test
npm run build:deployment
npm run test:e2e
git diff --check
