const requiredJobs = ['frontend', 'edge', 'database'];
export const requiredEdgeSlugs = ['enqueue-message', 'public-contact', 'dispatch-outbox', 'process-inbound', 'queue-reminders', 'cloudtalk-webhook', 'cloudtalk-call-media'];
const optionalEdgeSlugs = new Set(['send-provider-email', 'suggest-replies']);

export function requiredEdgeSourceReview(downloadOk, entrypointMatches, contents) {
  const disabledPlaceholder = /serveDisabledLegacyFunction/.test(contents);
  return {
    classification: 'required-existing-route',
    disabledPlaceholder,
    launchBlocker: !downloadOk || entrypointMatches !== true || disabledPlaceholder,
    reason: !downloadOk
      ? 'Required deployed function could not be downloaded for review.'
      : disabledPlaceholder
        ? 'Deployed entrypoint calls the disabled legacy placeholder.'
        : entrypointMatches !== true
          ? 'Deployed entrypoint differs from the reviewed repository entrypoint.'
          : 'Entrypoint bytes match; shared dependencies and functional behavior still require release proof.',
  };
}

export function edgeFunctionBlockers(functions, review) {
  const blockers = [];
  for (const item of functions?.readinessPresence ?? []) {
    if (!item.remotePresent) blockers.push(`Hosted Edge Function missing ${item.slug}.`);
  }
  for (const slug of functions?.localOnly ?? []) {
    if (!optionalEdgeSlugs.has(slug)) blockers.push(`Enabled workflow Edge Function missing ${slug}.`);
  }
  for (const slug of requiredEdgeSlugs) {
    if (!review?.reviews?.some((item) => item.slug === slug && item.sourceMatchesReviewedRelease === true && item.behaviorVerified === true)) {
      blockers.push(`Deployed ${slug} has no matching source and behavior proof.`);
    }
  }
  return blockers;
}

export function ciBlockers(ci, reviewedSha) {
  if (!ci) return ['GitHub CI evidence for the reviewed commit is missing.'];
  const blockers = [];
  if (ci.headSha !== reviewedSha) blockers.push('GitHub CI evidence does not match the reviewed commit.');
  if (ci.status !== 'completed' || ci.conclusion !== 'success') {
    blockers.push('GitHub CI did not complete successfully.');
  }
  for (const name of requiredJobs) {
    if (!ci.jobs?.some((job) => job.name === name && job.status === 'completed' && job.conclusion === 'success')) {
      blockers.push(`GitHub CI ${name} job did not complete successfully.`);
    }
  }
  return blockers;
}

export function freshnessBlocker(evidence, label, now = Date.now(), maxAgeMs = 24 * 60 * 60 * 1000) {
  const timestamp = Date.parse(evidence?.generatedAt ?? evidence?.updatedAt ?? '');
  if (!Number.isFinite(timestamp) || timestamp > now || now - timestamp > maxAgeMs) {
    return `${label} evidence is missing, future-dated, or older than 24 hours.`;
  }
  return null;
}
