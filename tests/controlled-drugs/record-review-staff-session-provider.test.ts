import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { runStaffSessionProviderControls } from './record-review-staff-session-provider-controls.mjs';

test('real AuthProvider preserves review session boundaries across seven async cases', async () => {
  await runStaffSessionProviderControls(fileURLToPath(new URL('../../', import.meta.url)));
});
