import assert from 'node:assert';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import test from 'node:test';

import { applyAgentRun } from '../src/applyAgentRun.js';
import { cleanupAgentRun } from '../src/cleanupAgentRun.js';
import { delegateToAgent } from '../src/delegateToAgent.js';
import { getAgentRunReport } from '../src/getAgentRunReport.js';

function git(args: string[], cwd: string): string {
  return execFileSync('git', args, { cwd, encoding: 'utf-8' });
}

async function createTempRepo() {
  const repoPath = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-delegate-'));
  git(['init'], repoPath);
  git(['config', 'user.name', 'Codex Test'], repoPath);
  git(['config', 'user.email', 'codex@example.com'], repoPath);
  await fs.writeFile(path.join(repoPath, 'README.md'), 'seed\n', 'utf-8');
  git(['add', 'README.md'], repoPath);
  git(['commit', '-m', 'seed'], repoPath);
  return repoPath;
}

async function createFakeAgent(commitChanges = false) {
  const scriptPath = path.join(
    await fs.mkdtemp(path.join(os.tmpdir(), 'fake-agent-')),
    'agent.mjs',
  );
  await fs.writeFile(
    scriptPath,
    `import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
const cwd = process.argv[2];
await fs.writeFile(path.join(cwd, 'result.txt'), 'delegated\\n', 'utf-8');
if (${commitChanges}) {
  execFileSync('git', ['add', 'result.txt'], { cwd });
  execFileSync('git', ['commit', '-m', 'agent commit'], { cwd });
}
process.stdout.write('done\\n\\n\\\`\\\`\\\`json\\n{"summary":"created result","risk_notes":[],"review_focus":["result.txt"],"assumptions":[]}\\n\\\`\\\`\\\`\\n');
`,
    'utf-8',
  );
  return scriptPath;
}

test('custom backend completes, applies, and cleans up an isolated run', async () => {
  const repoPath = await createTempRepo();
  const fakeAgent = await createFakeAgent();
  const result = await delegateToAgent({
    repoPath,
    task: 'Create result.txt',
    agent: 'custom',
    agentCommand: process.execPath,
    agentArgs: [fakeAgent, '{{cwd}}'],
    allowUnsafe: true,
    allowedFiles: ['result.txt'],
    testCommands: ['git diff --check'],
    waitForCompletion: true,
    responseMode: 'full',
  });

  assert.strictEqual(result.status, 'success');
  assert.deepStrictEqual(result.changedFiles, ['result.txt']);
  assert.strictEqual(existsSync(path.join(repoPath, 'result.txt')), false);

  const applyResult = await applyAgentRun({
    repoPath,
    runId: result.runId,
    confirm: true,
  });
  assert.strictEqual(applyResult.status, 'success');
  assert.strictEqual(
    await fs.readFile(path.join(repoPath, 'result.txt'), 'utf-8'),
    'delegated\n',
  );

  git(['add', 'result.txt'], repoPath);
  git(['commit', '-m', 'apply delegated result'], repoPath);
  const cleanup = await cleanupAgentRun(repoPath, result.runId, true);
  assert.strictEqual(cleanup.status, 'success');
  assert.strictEqual(existsSync(result.worktreePath as string), false);
});

test('dry runs create no managed run directory', async () => {
  const repoPath = await createTempRepo();
  const fakeAgent = await createFakeAgent();
  const result = await delegateToAgent({
    repoPath,
    task: 'Inspect only',
    agent: 'custom',
    agentCommand: process.execPath,
    agentArgs: [fakeAgent, '{{cwd}}'],
    allowUnsafe: true,
    dryRun: true,
  });

  assert.strictEqual(result.status, 'success');
  assert.strictEqual(result.dryRun, true);
  assert.strictEqual(
    existsSync(path.join(repoPath, '.codex-agent-runs')),
    false,
  );
});

test('background runs persist progress and complete independently', async () => {
  const repoPath = await createTempRepo();
  const fakeAgent = await createFakeAgent();
  const started = await delegateToAgent({
    repoPath,
    task: 'Create result.txt in the background',
    agent: 'custom',
    agentCommand: process.execPath,
    agentArgs: [fakeAgent, '{{cwd}}'],
    allowUnsafe: true,
    allowedFiles: ['result.txt'],
    testCommands: ['git diff --check'],
  });

  assert.ok(['running', 'success'].includes(started.status));
  let report: any = null;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const response = await getAgentRunReport(repoPath, started.runId, {
      detail: 'full',
    });
    report = response.report;
    if (['success', 'needs_review', 'blocked', 'failed'].includes(report?.status)) {
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  assert.strictEqual(report?.status, 'success');
  assert.strictEqual(report?.backgroundPid, null);
  const cleanup = await cleanupAgentRun(repoPath, started.runId, true);
  assert.strictEqual(cleanup.status, 'success');
});

test('changes committed by a worker are still captured in the patch', async () => {
  const repoPath = await createTempRepo();
  const fakeAgent = await createFakeAgent(true);
  const result = await delegateToAgent({
    repoPath,
    task: 'Create result.txt even if the worker commits',
    agent: 'custom',
    agentCommand: process.execPath,
    agentArgs: [fakeAgent, '{{cwd}}'],
    allowUnsafe: true,
    allowedFiles: ['result.txt'],
    testCommands: ['git diff --check'],
    waitForCompletion: true,
    responseMode: 'full',
  });

  assert.strictEqual(result.status, 'success');
  assert.deepStrictEqual(result.changedFiles, ['result.txt']);
  const applied = await applyAgentRun({
    repoPath,
    runId: result.runId,
    confirm: true,
  });
  assert.strictEqual(applied.status, 'success');
  assert.strictEqual(
    await fs.readFile(path.join(repoPath, 'result.txt'), 'utf-8'),
    'delegated\n',
  );

  git(['add', 'result.txt'], repoPath);
  git(['commit', '-m', 'apply committed worker result'], repoPath);
  await cleanupAgentRun(repoPath, result.runId, true);
});

test('unsafe permission modes are rejected before artifacts are created', async () => {
  const repoPath = await createTempRepo();

  await assert.rejects(
    delegateToAgent({
      repoPath,
      task: 'Unsafe edit',
      agent: 'codex',
      permissionMode: 'full-access',
    }),
    /allowUnsafe=true/u,
  );
  assert.strictEqual(
    existsSync(path.join(repoPath, '.codex-agent-runs')),
    false,
  );
});
