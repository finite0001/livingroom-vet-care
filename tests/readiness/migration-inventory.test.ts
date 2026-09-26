import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compareMigrationInventory } from '../../scripts/migration-inventory.mjs';

test('a migration version collision is reported even when the push plan sees no missing version', () => {
  const result = compareMigrationInventory(
    ['20260916100000_native_return_reconciliation_releases.sql', '20260916100001_conversation_attachment_uploads.sql'],
    [{ version: '20260916100000', name: 'conversation_attachment_uploads' }],
  );
  assert.equal(result.matching_count, 0);
  assert.deepEqual(result.local_only, ['20260916100001']);
  assert.deepEqual(result.name_mismatches, [{
    version: '20260916100000',
    local_name: 'native_return_reconciliation_releases',
    remote_name: 'conversation_attachment_uploads',
  }]);
});

test('remote-only receipts are reported and malformed or duplicate receipts fail closed', () => {
  const result = compareMigrationInventory(
    ['20260916100000_native_return_reconciliation_releases.sql'],
    [{ version: '20260916100000', name: 'native_return_reconciliation_releases' },
      { version: '20260916110000', name: 'unexpected' }],
  );
  assert.equal(result.matching_count, 1);
  assert.deepEqual(result.remote_only_first, ['20260916110000']);
  assert.equal(result.remote_only_count, 1);
  assert.throws(() => compareMigrationInventory(['20260916100000_a.sql', '20260916100000_b.sql'], []), /duplicate/);
  assert.throws(() => compareMigrationInventory([], [{ version: 'bad', name: 'unexpected' }]), /Invalid/);
});
