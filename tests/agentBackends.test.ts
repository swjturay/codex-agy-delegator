import assert from 'node:assert';
import test from 'node:test';

import {
  buildAgentInvocation,
  normalizeAgentOutput,
  type AgentBackendConfig,
} from '../src/agentBackends.js';

function config(
  overrides: Partial<AgentBackendConfig> = {},
): AgentBackendConfig {
  return {
    agent: 'codex',
    permissionMode: 'workspace-write',
    allowUnsafe: false,
    timeoutMs: 60_000,
    ...overrides,
  };
}

test('Codex invocation uses an ephemeral workspace-write sandbox and stdin', () => {
  const invocation = buildAgentInvocation(
    config(),
    'do the task',
    '/tmp/repo',
    '/tmp/response.txt',
  );

  assert.strictEqual(invocation.command, 'codex');
  assert.deepStrictEqual(invocation.args, [
    'exec',
    '--ephemeral',
    '--ignore-user-config',
    '--sandbox',
    'workspace-write',
    '--cd',
    '/tmp/repo',
    '--output-last-message',
    '/tmp/response.txt',
    '-',
  ]);
  assert.strictEqual(invocation.stdin, 'do the task');
});

test('Claude invocation maps safe permission modes and normalizes JSON output', () => {
  const invocation = buildAgentInvocation(
    config({ agent: 'claude', permissionMode: 'read-only' }),
    'inspect',
    '/tmp/repo',
    '/tmp/response.txt',
  );

  assert.ok(invocation.args.includes('plan'));
  assert.strictEqual(
    normalizeAgentOutput('claude', JSON.stringify({ result: 'finished' })),
    'finished',
  );
});

test('agy uses its sandbox instead of skipping permissions', () => {
  const invocation = buildAgentInvocation(
    config({ agent: 'agy' }),
    'edit',
    '/tmp/repo',
    '/tmp/response.txt',
  );

  assert.ok(invocation.args.includes('--sandbox'));
  assert.ok(!invocation.args.includes('--dangerously-skip-permissions'));
});

test('full access and custom commands require an explicit unsafe opt-in', () => {
  assert.throws(
    () => buildAgentInvocation(
      config({ permissionMode: 'full-access' }),
      'edit',
      '/tmp/repo',
      '/tmp/response.txt',
    ),
    /allowUnsafe=true/u,
  );
  assert.throws(
    () => buildAgentInvocation(
      config({ agent: 'custom', agentCommand: 'worker' }),
      'edit',
      '/tmp/repo',
      '/tmp/response.txt',
    ),
    /custom agents require allowUnsafe=true/u,
  );
});

test('custom command placeholders are expanded without a shell', () => {
  const invocation = buildAgentInvocation(
    config({
      agent: 'custom',
      agentCommand: '/usr/bin/worker',
      agentArgs: ['--cwd', '{{cwd}}', '--prompt={{prompt}}'],
      allowUnsafe: true,
    }),
    'safe prompt',
    '/tmp/repo with space',
    '/tmp/response.txt',
  );

  assert.deepStrictEqual(invocation.args, [
    '--cwd',
    '/tmp/repo with space',
    '--prompt=safe prompt',
  ]);
  assert.strictEqual(invocation.stdin, null);
});
