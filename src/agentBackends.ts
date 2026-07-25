import * as path from 'path';

import { runCommand } from './shell.js';

export type AgentKind = 'agy' | 'codex' | 'claude' | 'custom';
export type AgentPermissionMode = 'read-only' | 'workspace-write' | 'full-access';

export interface AgentBackendConfig {
  agent: AgentKind;
  agentCommand?: string;
  agentArgs?: string[];
  model?: string;
  permissionMode: AgentPermissionMode;
  allowUnsafe: boolean;
  timeoutMs: number;
}

export interface AgentInvocation {
  command: string;
  args: string[];
  stdin: string | null;
}

export interface AgentProbe {
  agent: AgentKind;
  command: string;
  installed: boolean;
  compatible: boolean;
  version: string | null;
  error?: string;
}

const MINIMUM_AGY_VERSION = [1, 1, 1] as const;

function extractVersion(value: string): [number, number, number] | null {
  const match = value.match(/(\d+)\.(\d+)\.(\d+)/u);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function isVersionAtLeast(
  actual: readonly number[],
  minimum: readonly number[],
): boolean {
  for (let index = 0; index < Math.max(actual.length, minimum.length); index += 1) {
    const actualPart = actual[index] ?? 0;
    const minimumPart = minimum[index] ?? 0;
    if (actualPart > minimumPart) return true;
    if (actualPart < minimumPart) return false;
  }
  return true;
}

export function getAgentCommand(config: Pick<AgentBackendConfig, 'agent' | 'agentCommand'>): string {
  if (config.agent === 'custom') {
    const command = config.agentCommand?.trim();
    if (!command || command.includes('\0')) {
      throw new Error('custom agents require a valid agentCommand');
    }
    return command;
  }
  return config.agent;
}

export async function probeAgentBackend(
  config: Pick<AgentBackendConfig, 'agent' | 'agentCommand'>,
  cwd: string,
): Promise<AgentProbe> {
  let command: string;
  try {
    command = getAgentCommand(config);
  } catch (error: any) {
    return {
      agent: config.agent,
      command: config.agentCommand ?? '',
      installed: false,
      compatible: false,
      version: null,
      error: error?.message ?? 'Invalid agent command',
    };
  }

  if (config.agent === 'custom') {
    return {
      agent: config.agent,
      command,
      installed: true,
      compatible: true,
      version: null,
    };
  }

  const result = await runCommand(command, ['--version'], cwd, 15_000);
  const versionText = `${result.stdout}\n${result.stderr}`.trim();
  if (result.exitCode !== 0) {
    return {
      agent: config.agent,
      command,
      installed: false,
      compatible: false,
      version: null,
      error: versionText || `${command} was not found`,
    };
  }

  if (config.agent === 'agy') {
    const parsed = extractVersion(versionText);
    if (!parsed || !isVersionAtLeast(parsed, MINIMUM_AGY_VERSION)) {
      return {
        agent: config.agent,
        command,
        installed: true,
        compatible: false,
        version: versionText,
        error: 'Antigravity CLI 1.1.1 or newer is required. Run `agy update` and retry.',
      };
    }
  }

  return {
    agent: config.agent,
    command,
    installed: true,
    compatible: true,
    version: versionText,
  };
}

function assertSafeConfiguration(config: AgentBackendConfig): void {
  if (config.permissionMode === 'full-access' && !config.allowUnsafe) {
    throw new Error('full-access requires allowUnsafe=true');
  }
  if (config.agent === 'custom' && !config.allowUnsafe) {
    throw new Error('custom agents require allowUnsafe=true because their sandbox cannot be verified');
  }
}

function replacePlaceholders(
  value: string,
  prompt: string,
  cwd: string,
  responsePath: string,
): string {
  return value
    .replaceAll('{{prompt}}', prompt)
    .replaceAll('{{cwd}}', cwd)
    .replaceAll('{{responsePath}}', responsePath);
}

export function buildAgentInvocation(
  config: AgentBackendConfig,
  prompt: string,
  cwd: string,
  responsePath: string,
): AgentInvocation {
  assertSafeConfiguration(config);
  const command = getAgentCommand(config);

  if (config.agent === 'agy') {
    const args: string[] = [];
    if (config.permissionMode === 'full-access') {
      args.push('--dangerously-skip-permissions');
    } else {
      args.push('--sandbox');
      args.push('--mode', config.permissionMode === 'read-only' ? 'plan' : 'accept-edits');
    }
    if (config.model) args.push('--model', config.model);
    args.push('--print-timeout', `${Math.max(1, Math.ceil(config.timeoutMs / 1000))}s`);
    args.push('--print', prompt);
    return { command, args, stdin: null };
  }

  if (config.agent === 'codex') {
    const sandbox = config.permissionMode === 'full-access'
      ? 'danger-full-access'
      : config.permissionMode;
    const args = [
      'exec',
      '--ephemeral',
      '--ignore-user-config',
      '--sandbox',
      sandbox,
      '--cd',
      cwd,
      '--output-last-message',
      responsePath,
    ];
    if (config.model) args.push('--model', config.model);
    args.push('-');
    return { command, args, stdin: prompt };
  }

  if (config.agent === 'claude') {
    const permissionMode = config.permissionMode === 'read-only'
      ? 'plan'
      : config.permissionMode === 'full-access'
        ? 'bypassPermissions'
        : 'acceptEdits';
    const args = [
      '--print',
      '--output-format',
      'json',
      '--permission-mode',
      permissionMode,
    ];
    if (config.model) args.push('--model', config.model);
    return { command, args, stdin: prompt };
  }

  const templateArgs = config.agentArgs ?? [];
  const containsPromptPlaceholder = templateArgs.some((argument) => argument.includes('{{prompt}}'));
  const args = templateArgs.map((argument) => replacePlaceholders(argument, prompt, cwd, responsePath));
  return {
    command,
    args,
    stdin: containsPromptPlaceholder ? null : prompt,
  };
}

export function normalizeAgentOutput(agent: AgentKind, rawOutput: string): string {
  if (agent !== 'claude') return rawOutput;
  try {
    const payload = JSON.parse(rawOutput);
    if (typeof payload?.result === 'string') return payload.result;
    if (payload?.structured_output !== undefined) {
      return JSON.stringify(payload.structured_output);
    }
  } catch {
    // Preserve raw output so failure diagnostics remain available.
  }
  return rawOutput;
}

export async function listAgentBackends(cwd: string): Promise<AgentProbe[]> {
  return Promise.all(
    (['agy', 'codex', 'claude'] as AgentKind[])
      .map((agent) => probeAgentBackend({ agent }, cwd)),
  );
}

export function displayCommand(invocation: AgentInvocation): string {
  const promptRedactedArgs = invocation.args.map((argument) => (
    argument.length > 200 ? '<prompt omitted>' : argument
  ));
  return [path.basename(invocation.command), ...promptRedactedArgs].join(' ');
}
