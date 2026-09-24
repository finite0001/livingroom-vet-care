#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

echo "Checking tracked Vercel build contract..."
node --input-type=module <<'NODE'
import fs from 'node:fs';

const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const vercelJson = JSON.parse(fs.readFileSync('vercel.json', 'utf8'));

if (packageJson.scripts?.['build:deployment'] !== 'node scripts/build-deployment.mjs') {
  throw new Error('package.json must define scripts.build:deployment as "node scripts/build-deployment.mjs".');
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
VERCEL_ENV="${VERCEL_ENV:-production}" \
VITE_SUPABASE_PROJECT_ID="${VITE_SUPABASE_PROJECT_ID:-mgadheotkdnrsatfivjy}" \
VITE_SUPABASE_URL="${VITE_SUPABASE_URL:-https://mgadheotkdnrsatfivjy.supabase.co}" \
VITE_SUPABASE_PUBLISHABLE_KEY="${VITE_SUPABASE_PUBLISHABLE_KEY:-sb_publishable_synthetic_preflight_only}" \
  npm run build:deployment
npm run test:e2e
git diff --check
