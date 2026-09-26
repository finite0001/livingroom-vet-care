const migrationFile = /^(\d{14})_(.+)\.sql$/;
const versionPattern = /^\d{14}$/;

export function compareMigrationInventory(localFiles, remoteRows) {
  const local = new Map();
  const remote = new Map();

  for (const file of localFiles) {
    const match = file.match(migrationFile);
    if (!match || local.has(match[1])) throw new Error('Invalid or duplicate local migration filename.');
    local.set(match[1], match[2]);
  }

  for (const row of remoteRows) {
    if (!versionPattern.test(row?.version) || typeof row?.name !== 'string' || !row.name || remote.has(row.version)) {
      throw new Error('Invalid or duplicate hosted migration receipt.');
    }
    remote.set(row.version, row.name);
  }

  const localOnly = [...local.keys()].filter((version) => !remote.has(version)).sort();
  const remoteOnly = [...remote.keys()].filter((version) => !local.has(version)).sort();
  const nameMismatches = [...local.keys()]
    .filter((version) => remote.has(version) && local.get(version) !== remote.get(version))
    .sort()
    .map((version) => ({ version, local_name: local.get(version), remote_name: remote.get(version) }));

  return {
    matching_count: local.size - localOnly.length - nameMismatches.length,
    remote_only_count: remoteOnly.length,
    local_only_count: localOnly.length,
    name_mismatch_count: nameMismatches.length,
    local_only: localOnly,
    remote_only_first: remoteOnly.slice(0, 10),
    remote_only_last: remoteOnly.slice(-10),
    name_mismatches: nameMismatches,
  };
}
