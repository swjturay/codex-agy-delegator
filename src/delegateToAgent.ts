import { randomBytes } from 'crypto';
import { spawn } from 'child_process';
import * as fs from 'fs/promises';
import { closeSync, existsSync, openSync } from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

import {
  buildAgentInvocation,
  displayCommand,
  probeAgentBackend,
  type AgentKind,
  type AgentPermissionMode,
} from './agentBackends.js';
import {
  createWorktree,
  ensureLocalGitExcludes,
  getGitRoot,
  getHeadCommit,
  hasUncommittedChanges,
  removeWorktree,
} from './git.js';
import {
  createInitialRunReport,
  nowIso,
  readRunReport,
  type RunConfig,
  type RunReport,
  type TestResult,
  writeRunConfig,
  writeRunReport,
} from './runArtifacts.js';
import {
  getRunsRoot,
  resolveNewRunDir,
  resolveNewWorktreePath,
} from './runPaths.js';
import { executeAgentRun } from './runAgentTask.js';
import { killProcessTree, tailString } from './shell.js';

export type ResponseMode = 'compact' | 'standard' | 'full';

export interface DelegateAgentArgs {
  repoPath: string;
  task: string;
  agent?: AgentKind;
  agentCommand?: string;
  agentArgs?: string[];
  model?: string;
  permissionMode?: AgentPermissionMode;
  allowUnsafe?: boolean;
  allowedFiles?: string[];
  forbiddenFiles?: string[];
  testCommands?: string[];
  timeoutMs?: number;
  testTimeoutMs?: number;
  useWorktree?: boolean;
  branchPrefix?: string;
  dryRun?: boolean;
  responseMode?: ResponseMode;
  maxFiles?: number;
  maxTestTailLines?: number;
  includeDiffStat?: boolean;
  waitForCompletion?: boolean;
}

function capString(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, maxChars)}\n... (${value.length - maxChars} chars omitted) ...`;
}

function compactTests(tests: TestResult[], includeFailureTails: boolean) {
  const failed = tests.filter((test) => test.exitCode !== 0 || test.timedOut);
  return {
    passed: failed.length === 0,
    commands: tests.map((test) => ({
      command: test.command,
      exitCode: test.exitCode,
      timedOut: test.timedOut,
    })),
    failed: failed.map((test) => ({
      command: test.command,
      exitCode: test.exitCode,
      timedOut: test.timedOut,
      ...(includeFailureTails
        ? { stdoutTail: test.stdoutTail, stderrTail: test.stderrTail }
        : {}),
    })),
  };
}

export function formatRunReport(
  report: RunReport,
  args: Pick<
    DelegateAgentArgs,
    'responseMode' | 'maxFiles' | 'includeDiffStat'
  >,
) {
  const responseMode = args.responseMode ?? 'compact';
  if (responseMode === 'full') return report;

  const maxFiles = args.maxFiles ?? 30;
  const compact: Record<string, unknown> = {
    status: report.status,
    runId: report.runId,
    agent: report.agent,
    agentVersion: report.agentVersion,
    branch: report.branch,
    worktreePath: report.worktreePath,
    changed: {
      count: report.changedFiles.length,
      files: report.changedFiles.slice(0, maxFiles),
      omitted: Math.max(0, report.changedFiles.length - maxFiles),
    },
    tests: compactTests(report.tests, responseMode !== 'compact'),
    summary: report.summary,
    riskNotes: report.riskNotes,
    reviewFocus: report.reviewFocus,
    assumptions: report.assumptions,
    rawReportPath: report.rawReportPath,
    currentPhase: report.currentPhase,
    startedAt: report.startedAt,
    updatedAt: report.updatedAt,
    finishedAt: report.finishedAt,
    appliedAt: report.appliedAt,
  };

  if (report.error) compact.error = report.error;
  if (report.violatedFiles?.length) compact.violatedFiles = report.violatedFiles;
  if (report.outsideAllowedFiles?.length) {
    compact.outsideAllowedFiles = report.outsideAllowedFiles;
  }
  if (report.exitCode !== null && report.exitCode !== 0) {
    compact.exitCode = report.exitCode;
  }
  if (args.includeDiffStat || responseMode === 'standard') {
    compact.diffStat = capString(report.diffStat ?? '', 4_000);
  }
  return compact;
}

function buildTaskContent(
  agent: AgentKind,
  task: string,
  allowedFiles: string[],
  forbiddenFiles: string[],
): string {
  return `# Task
${task}

# File constraints
${allowedFiles.length > 0
    ? `Allowed files:\n${allowedFiles.map((file) => `- ${file}`).join('\n')}`
    : 'Allowed files: any repository file not forbidden below.'}
${forbiddenFiles.length > 0
    ? `Forbidden files:\n${forbiddenFiles.map((file) => `- ${file}`).join('\n')}`
    : 'Forbidden files: none explicitly listed.'}

# Worker instructions
You are the ${agent} coding worker. Make minimal, precise changes and obey every file constraint.
Do not commit, push, or modify files outside this repository.
End the final response with exactly one fenced JSON block using this shape:
\`\`\`json
{"summary":"","risk_notes":[],"review_focus":[],"assumptions":[]}
\`\`\`
`;
}

function requireIntegerInRange(
  name: string,
  value: number,
  minimum: number,
  maximum: number,
): number {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`);
  }
  return value;
}

function validateStringArray(name: string, value: string[]): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || !item.trim())) {
    throw new Error(`${name} must contain only non-empty strings`);
  }
  return value.map((item) => item.trim());
}

function createRunId(agent: AgentKind): string {
  const timestamp = new Date().toISOString().replace(/\D/gu, '').slice(0, 14);
  return `${timestamp}-${agent}-${randomBytes(4).toString('hex')}`;
}

function resolveBackgroundEntryScript(): string {
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.join(moduleDir, 'index.js'),
    path.join(moduleDir, 'index.ts'),
    path.join(process.cwd(), 'dist', 'index.js'),
  ];
  const entry = candidates.find((candidate) => existsSync(candidate));
  if (!entry) {
    throw new Error('Cannot determine the MCP entry script for background execution.');
  }
  return entry;
}

async function spawnBackgroundRunner(runDir: string): Promise<number> {
  const entryScript = resolveBackgroundEntryScript();
  const childExecArgv = entryScript.endsWith('.ts') ? process.execArgv : [];
  const stdoutFd = openSync(path.join(runDir, 'runner.stdout.log'), 'a', 0o600);
  const stderrFd = openSync(path.join(runDir, 'runner.stderr.log'), 'a', 0o600);
  let child;
  try {
    child = spawn(
      process.execPath,
      [...childExecArgv, entryScript, '--run-agent-task', runDir],
      {
        cwd: path.dirname(entryScript),
        detached: true,
        stdio: ['ignore', stdoutFd, stderrFd],
        env: process.env,
        windowsHide: true,
      },
    );
  } finally {
    closeSync(stdoutFd);
    closeSync(stderrFd);
  }

  child.unref();
  child.once('error', () => {
    // waitForRunnerStart reports startup failures through the persisted report.
  });
  if (!child.pid) throw new Error('Failed to start the background runner.');
  return child.pid;
}

async function waitForRunnerStart(
  runDir: string,
  spawnedPid: number,
): Promise<RunReport> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const report = await readRunReport(runDir);
    if (report && report.status !== 'queued') return report;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const report = await readRunReport(runDir);
  if (!report) throw new Error('Run report disappeared after background launch.');
  let processIsRunning = true;
  try {
    process.kill(spawnedPid, 0);
  } catch {
    processIsRunning = false;
  }
  if (!processIsRunning) {
    const stderrPath = path.join(runDir, 'runner.stderr.log');
    const stderr = existsSync(stderrPath)
      ? tailString(await fs.readFile(stderrPath, 'utf-8'), 20)
      : '';
    const now = nowIso();
    const failedReport: RunReport = {
      ...report,
      status: 'failed',
      backgroundPid: null,
      currentPhase: 'failed',
      summary: 'Background runner exited before starting the agent.',
      error: stderr || 'Background runner exited before starting the agent.',
      finishedAt: now,
      updatedAt: now,
    };
    await writeRunReport(runDir, failedReport);
    return failedReport;
  }
  return {
    ...report,
    status: 'running',
    backgroundPid: spawnedPid,
    currentPhase: 'starting',
    summary: 'Background runner launched. Poll get_agent_run_report for progress.',
  };
}

export async function delegateToAgent(args: DelegateAgentArgs): Promise<any> {
  const task = args.task?.trim();
  if (!task) throw new Error('task is required');

  const agent = args.agent ?? 'agy';
  if (!['agy', 'codex', 'claude', 'custom'].includes(agent)) {
    throw new Error(`Unsupported agent: ${agent}`);
  }
  const permissionMode = args.permissionMode ?? 'workspace-write';
  if (!['read-only', 'workspace-write', 'full-access'].includes(permissionMode)) {
    throw new Error(`Unsupported permissionMode: ${permissionMode}`);
  }

  const timeoutMs = requireIntegerInRange(
    'timeoutMs',
    args.timeoutMs ?? 900_000,
    1_000,
    86_400_000,
  );
  const testTimeoutMs = requireIntegerInRange(
    'testTimeoutMs',
    args.testTimeoutMs ?? 300_000,
    1_000,
    86_400_000,
  );
  const allowedFiles = validateStringArray('allowedFiles', args.allowedFiles ?? []);
  const forbiddenFiles = validateStringArray('forbiddenFiles', args.forbiddenFiles ?? []);
  const testCommands = validateStringArray('testCommands', args.testCommands ?? []);
  const agentArgs = validateStringArray('agentArgs', args.agentArgs ?? []);
  const useWorktree = args.useWorktree ?? true;
  const allowUnsafe = args.allowUnsafe ?? false;
  if (
    args.responseMode !== undefined
    && !['compact', 'standard', 'full'].includes(args.responseMode)
  ) {
    throw new Error(`Unsupported responseMode: ${args.responseMode}`);
  }
  if (args.maxFiles !== undefined) {
    requireIntegerInRange('maxFiles', args.maxFiles, 1, 10_000);
  }
  if (args.maxTestTailLines !== undefined) {
    requireIntegerInRange(
      'maxTestTailLines',
      args.maxTestTailLines,
      0,
      10_000,
    );
  }

  const root = await getGitRoot(args.repoPath);
  if (!root) throw new Error('Not a git repository or invalid path');
  const baseCommit = await getHeadCommit(root);
  if (!useWorktree && await hasUncommittedChanges(root)) {
    return {
      status: 'blocked',
      error: 'Repository has uncommitted changes and useWorktree=false.',
    };
  }

  const taskContent = buildTaskContent(agent, task, allowedFiles, forbiddenFiles);
  const backendConfig = {
    agent,
    agentCommand: args.agentCommand,
    agentArgs,
    model: args.model,
    permissionMode,
    allowUnsafe,
    timeoutMs,
  };
  const validationInvocation = buildAgentInvocation(
    backendConfig,
    taskContent,
    root,
    path.join(root, '.agent-response.txt'),
  );
  const probe = await probeAgentBackend(backendConfig, root);
  if (!probe.installed || !probe.compatible) {
    return {
      status: 'failed',
      agent,
      error: probe.error ?? `${probe.command} is unavailable`,
      probe,
    };
  }

  if (args.dryRun) {
    return {
      status: 'success',
      dryRun: true,
      agent,
      agentVersion: probe.version,
      targetCwd: root,
      command: displayCommand(validationInvocation),
      createsArtifacts: false,
    };
  }

  const runId = createRunId(agent);
  const runDir = resolveNewRunDir(root, runId);
  const branchPrefix = (args.branchPrefix ?? `agent/${agent}-task`).trim();
  const branchName = `${branchPrefix}-${runId}`;
  const worktreePath = useWorktree ? resolveNewWorktreePath(root, runId) : null;
  let targetCwd = root;
  let backgroundPid: number | null = null;

  await ensureLocalGitExcludes(root);
  await fs.mkdir(getRunsRoot(root), { recursive: true, mode: 0o700 });
  await fs.mkdir(runDir, { mode: 0o700 });

  try {
    if (worktreePath) {
      await fs.mkdir(path.dirname(worktreePath), { recursive: true });
      await createWorktree(root, branchName, worktreePath);
      targetCwd = worktreePath;
    }

    const config: RunConfig = {
      schemaVersion: 2,
      runId,
      root,
      runDir,
      targetCwd,
      baseCommit,
      branchName,
      worktreePath,
      taskContent,
      allowedFiles,
      forbiddenFiles,
      testCommands,
      timeoutMs,
      testTimeoutMs,
      maxTestTailLines: args.maxTestTailLines,
      agent,
      agentCommand: args.agentCommand,
      agentArgs,
      agentVersion: probe.version,
      model: args.model,
      permissionMode,
      allowUnsafe,
    };

    await fs.writeFile(path.join(runDir, 'task.md'), taskContent, {
      encoding: 'utf-8',
      mode: 0o600,
    });
    await writeRunConfig(runDir, config);
    await writeRunReport(runDir, createInitialRunReport(config));

    if (args.waitForCompletion) {
      await executeAgentRun(runDir);
      const report = await readRunReport(runDir);
      if (!report) throw new Error('Run report was not written.');
      return formatRunReport(report, args);
    }

    backgroundPid = await spawnBackgroundRunner(runDir);
    const report = await waitForRunnerStart(runDir, backgroundPid);
    return formatRunReport(report, args);
  } catch (error) {
    if (backgroundPid) {
      try {
        await killProcessTree(backgroundPid);
      } catch {
        // Continue with managed filesystem cleanup.
      }
    }
    let cleanupFailed = false;
    if (worktreePath && existsSync(worktreePath)) {
      try {
        await removeWorktree(root, worktreePath);
      } catch {
        cleanupFailed = true;
      }
    }
    if (!cleanupFailed) {
      await fs.rm(runDir, { recursive: true, force: true });
    }
    throw error;
  }
}
