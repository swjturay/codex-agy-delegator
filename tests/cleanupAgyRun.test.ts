import test from 'node:test';
import assert from 'node:assert';
import * as fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';

import { cleanupAgyRun } from '../src/cleanupAgyRun.js';

function git(args: string[], cwd: string) {
  execFileSync('git', args, { cwd, stdio: 'pipe' });
}

async function createTempRepo() {
  const repoPath = await fs.mkdtemp(path.join(os.tmpdir(), 'agy-cleanup-'));
  git(['init'], repoPath);
  git(['config', 'user.name', 'Codex Test'], repoPath);
  git(['config', 'user.email', 'codex@example.com'], repoPath);
  await fs.writeFile(path.join(repoPath, 'README.md'), 'seed\n', 'utf-8');
  git(['add', 'README.md'], repoPath);
  git(['commit', '-m', 'seed'], repoPath);
  return repoPath;
}

test('cleanupAgyRun removes the run directory when no worktree cleanup is requested', async () => {
  const repoPath = await createTempRepo();
  const runId = 'run-no-worktree';
  const runDir = path.join(repoPath, '.codex-agy-runs', runId);

  await fs.mkdir(runDir, { recursive: true });
  await fs.writeFile(path.join(runDir, 'report.json'), JSON.stringify({ runId, status: 'running' }), 'utf-8');
  await fs.writeFile(path.join(runDir, 'diff.patch'), 'patch', 'utf-8');

  const result = await cleanupAgyRun(repoPath, runId, false);

  assert.strictEqual(result.status, 'success');
  assert.strictEqual(existsSync(runDir), false);
});

test('cleanupAgyRun removes both the worktree and run directory when requested', async () => {
  const repoPath = await createTempRepo();
  const worktreeRoot = path.join(path.dirname(repoPath), 'worktrees');
  const worktreePath = path.join(worktreeRoot, 'run-with-worktree');
  const runId = 'run-with-worktree';
  const runDir = path.join(repoPath, '.codex-agy-runs', runId);

  await fs.mkdir(worktreeRoot, { recursive: true });
  git(['worktree', 'add', '-b', 'agent/run-with-worktree', worktreePath], repoPath);

  await fs.mkdir(runDir, { recursive: true });
  await fs.writeFile(
    path.join(runDir, 'report.json'),
    JSON.stringify({ runId, status: 'running', worktreePath }),
    'utf-8',
  );

  const result = await cleanupAgyRun(repoPath, runId, true);

  assert.strictEqual(result.status, 'success');
  assert.strictEqual(existsSync(worktreePath), false);
  assert.strictEqual(existsSync(runDir), false);
});
