import assert from 'node:assert';
import test from 'node:test';

import {
  isManagedWorktreePath,
  resolveNewRunDir,
  validateRunId,
} from '../src/runPaths.js';

test('run IDs reject path traversal and separators', () => {
  for (const value of ['..', '.', '../repo', 'nested/run', 'nested\\run', '/tmp/run']) {
    assert.throws(() => validateRunId(value), /Invalid run ID/u);
  }
});

test('run directories stay under the managed root', () => {
  const runDir = resolveNewRunDir('/tmp/example', 'safe-run_1.2');
  assert.strictEqual(runDir, '/tmp/example/.codex-agent-runs/safe-run_1.2');
});

test('only generated sibling worktrees are managed', () => {
  assert.strictEqual(
    isManagedWorktreePath(
      '/tmp/example',
      '/tmp/example-agent-worktrees/run-1',
    ),
    true,
  );
  assert.strictEqual(
    isManagedWorktreePath('/tmp/example', '/tmp/other-repository'),
    false,
  );
});
