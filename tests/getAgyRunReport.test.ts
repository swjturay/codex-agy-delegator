import test from 'node:test';
import assert from 'node:assert';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';

import { getAgyRunReport } from '../src/getAgyRunReport.js';
import { writeRunConfig, type RunConfig } from '../src/runArtifacts.js';

function git(args: string[], cwd: string) {
  return execFileSync('git', args, { cwd, encoding: 'utf-8' });
}

async function createTempRepo() {
  const repoPath = await fs.mkdtemp(path.join(os.tmpdir(), 'agy-report-'));
  git(['init'], repoPath);
  git(['config', 'user.name', 'Codex Test'], repoPath);
  git(['config', 'user.email', 'codex@example.com'], repoPath);
  await fs.writeFile(path.join(repoPath, 'README.md'), 'seed\n', 'utf-8');
  git(['add', 'README.md'], repoPath);
  git(['commit', '-m', 'seed'], repoPath);
  return repoPath;
}

test('getAgyRunReport falls back to run config when the final report is not written yet', async () => {
  const repoPath = await createTempRepo();
  const runId = 'pending-run';
  const runDir = path.join(repoPath, '.codex-agy-runs', runId);
  await fs.mkdir(runDir, { recursive: true });

  const config: RunConfig = {
    schemaVersion: 2,
    runId,
    root: repoPath,
    runDir,
    targetCwd: repoPath,
    baseCommit: git(['rev-parse', 'HEAD'], repoPath).trim(),
    branchName: 'agent/pending-run',
    worktreePath: null,
    taskContent: '# Task\npending',
    allowedFiles: [],
    forbiddenFiles: [],
    testCommands: [],
    timeoutMs: 1000,
    testTimeoutMs: 1000,
    agent: 'agy',
    agentVersion: 'agy 1.1.1',
    permissionMode: 'workspace-write',
    allowUnsafe: false,
  };

  await writeRunConfig(runDir, config);

  const result = await getAgyRunReport(repoPath, runId, { detail: 'compact' });
  const report = result.report as Record<string, unknown>;

  assert.ok(report);
  assert.strictEqual(report.status, 'queued');
  assert.strictEqual(report.currentPhase, 'queued');
  assert.strictEqual(report.summary, 'Run queued. Poll get_agent_run_report for progress.');
});
