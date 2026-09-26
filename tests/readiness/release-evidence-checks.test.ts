import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ciBlockers, edgeFunctionBlockers, freshnessBlocker, requiredEdgeSourceReview } from '../../scripts/release-evidence-checks.mjs';

const sha = 'a'.repeat(40);
const successfulCi = {
  headSha: sha,
  status: 'completed',
  conclusion: 'success',
  jobs: ['frontend', 'edge', 'database'].map((name) => ({ name, status: 'completed', conclusion: 'success' })),
};

test('release CI proof requires the exact SHA and every required job', () => {
  assert.deepEqual(ciBlockers(successfulCi, sha), []);
  assert.match(ciBlockers(null, sha)[0], /missing/);
  assert.match(ciBlockers({ ...successfulCi, headSha: 'b'.repeat(40) }, sha)[0], /does not match/);
  assert.ok(ciBlockers({ ...successfulCi, jobs: successfulCi.jobs.slice(0, 2) }, sha).some((blocker) => blocker.includes('database')));
  assert.ok(ciBlockers({ ...successfulCi, conclusion: 'failure' }, sha).some((blocker) => blocker.includes('did not complete successfully')));
});

test('release evidence rejects missing, stale, and future timestamps', () => {
  const now = Date.parse('2026-09-25T12:00:00Z');
  assert.equal(freshnessBlocker({ generatedAt: '2026-09-25T11:00:00Z' }, 'hosted', now), null);
  for (const evidence of [null, {}, { generatedAt: '2026-09-23T12:00:00Z' }, { generatedAt: '2026-09-26T12:00:00Z' }]) {
    assert.match(freshnessBlocker(evidence, 'hosted', now) ?? '', /missing, future-dated, or older/);
  }
});

test('enabled Edge routes need matching implementation and behavior proof', () => {
  const functions = { readinessPresence: [], localOnly: ['capture-conversation-email', 'suggest-replies'] };
  const slugs = ['enqueue-message', 'public-contact', 'dispatch-outbox', 'process-inbound', 'queue-reminders'];
  const reviews = slugs.map((slug) => ({ slug, sourceMatchesReviewedRelease: true, behaviorVerified: true }));
  assert.deepEqual(edgeFunctionBlockers({ ...functions, localOnly: ['suggest-replies'] }, { reviews }), []);
  assert.ok(edgeFunctionBlockers(functions, { reviews }).some((blocker) => blocker.includes('capture-conversation-email')));
  assert.ok(edgeFunctionBlockers({ ...functions, localOnly: [] }, { reviews: [{ ...reviews[0], behaviorVerified: false }, ...reviews.slice(1)] }).some((blocker) => blocker.includes('enqueue-message')));
  assert.ok(edgeFunctionBlockers({ ...functions, localOnly: [] }, { reviews: [{ ...reviews[0], sourceMatchesReviewedRelease: false }, ...reviews.slice(1)] }).some((blocker) => blocker.includes('enqueue-message')));
});

test('source review flags disabled and mismatched deployed entrypoints', () => {
  assert.equal(requiredEdgeSourceReview(true, false, 'serveDisabledLegacyFunction(request)').launchBlocker, true);
  assert.equal(requiredEdgeSourceReview(true, false, 'serve(request)').launchBlocker, true);
  assert.equal(requiredEdgeSourceReview(false, null, '').launchBlocker, true);
  assert.equal(requiredEdgeSourceReview(true, true, 'serve(request)').launchBlocker, false);
});
