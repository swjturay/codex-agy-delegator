import * as fs from 'fs/promises';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { getGitRoot, hasUncommittedChanges, createWorktree, removeWorktree } from './git.js';
import { runCommand } from './shell.js';
import { executeAgyRun } from './runAgyTask.js';
import { createInitialRunReport, nowIso, readRunReport, type RunConfig, type RunReport, type TestResult, updateRunReport, writeRunConfig, writeRunReport } from './runArtifacts.js';
import { spawn } from 'child_process';
import { existsSync, openSync } from 'fs';

export type ResponseMode = 'compact' | 'standard' | 'full';

export interface DelegateArgs {
  repoPath: string;
  task: string;
  allowedFiles?: string[];
  forbiddenFiles?: string[];
  testCommands?: string[];
  timeoutMs?: number;
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

function compactChangedFiles(files: string[], maxFiles: number) {
  return {
    count: files.length,
    files: files.slice(0, maxFiles),
    omitted: Math.max(0, files.length - maxFiles),
  };
}

function compactTests(tests: TestResult[], includeFailureTails: boolean) {
  const failed = tests.filter((test) => test.exitCode !== 0);
  return {
    passed: failed.length === 0,
    commands: tests.map((test) => ({ command: test.command, exitCode: test.exitCode })),
    failed: failed.map((test) => ({
      command: test.command,
      exitCode: test.exitCode,
      ...(includeFailureTails ? { stdoutTail: test.stdoutTail, stderrTail: test.stderrTail } : {}),
    })),
  };
}

function formatReport(reportData: any, args: DelegateArgs) {
  const responseMode = args.responseMode ?? 'compact';
  if (responseMode === 'full') return reportData;

  const maxFiles = args.maxFiles ?? 30;
  const compactReport: any = {
    status: reportData.status,
    runId: reportData.runId,
    branch: reportData.branch,
    worktreePath: reportData.worktreePath,
    changed: compactChangedFiles(reportData.changedFiles ?? [], maxFiles),
    tests: compactTests(reportData.tests ?? [], responseMode !== 'compact'),
    summary: reportData.summary ?? reportData.error ?? '',
    riskNotes: reportData.riskNotes ?? [],
    reviewFocus: reportData.reviewFocus ?? [],
    assumptions: reportData.assumptions ?? [],
    rawReportPath: reportData.rawReportPath,
    currentPhase: reportData.currentPhase,
    startedAt: reportData.startedAt,
    updatedAt: reportData.updatedAt,
    finishedAt: reportData.finishedAt,
  };

  if (reportData.error) compactReport.error = reportData.error;
  if (reportData.violatedFiles?.length > 0) compactReport.violatedFiles = reportData.violatedFiles;
  if (reportData.outsideAllowedFiles?.length > 0) compactReport.outsideAllowedFiles = reportData.outsideAllowedFiles;

  if (args.includeDiffStat || responseMode === 'standard') {
    compactReport.diffStat = capString(reportData.diffStat ?? '', 4000);
  }

  if (typeof reportData.agyExitCode === 'number' && reportData.agyExitCode !== 0) {
    compactReport.agyExitCode = reportData.agyExitCode;
  }

  return compactReport;
}

function buildTaskContent(task: string, allowedFiles: string[], forbiddenFiles: string[]) {
  return `# Task
${task}

# Constraints
${allowedFiles.length > 0 ? `Allowed Files:\n${allowedFiles.map(f => `- ${f}`).join('\n')}\n` : ''}
${forbiddenFiles.length > 0 ? `Forbidden Files:\n${forbiddenFiles.map(f => `- ${f}`).join('\n')}\n` : ''}

# Worker Instructions
You are an agy worker. Do minimal precise edits and obey the file constraints.
End your final response with only this JSON block:
\`\`\`json
{"summary":"","risk_notes":[],"review_focus":[],"assumptions":[]}
\`\`\`
`;
}

function resolveBackgroundEntryScript() {
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    process.argv[1],
    path.join(process.cwd(), 'dist', 'index.js'),
    path.join(moduleDir, 'index.js'),
  ].filter((value): value is string => Boolean(value) && value !== '-');

  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

function spawnBackgroundRunner(runDir: string, cwd: string) {
  const entryScript = resolveBackgroundEntryScript();
  if (!entryScript) {
    throw new Error('Cannot determine the MCP entry script for background execution.');
  }

  const runnerStdoutPath = path.join(runDir, 'runner.stdout.log');
  const runnerStderrPath = path.join(runDir, 'runner.stderr.log');
  const childExecArgv = entryScript.endsWith('.js') ? [] : process.execArgv;

  const child = spawn(
    process.execPath,
    [...childExecArgv, entryScript, '--run-agy-task', runDir],
    {
      cwd,
      detached: true,
      stdio: ['ignore', openSync(runnerStdoutPath, 'a'), openSync(runnerStderrPath, 'a')],
      env: process.env,
      windowsHide: true,
    },
  );

  child.unref();
  if (!child.pid) {
    throw new Error('Failed to start the background runner.');
  }

  return child.pid;
}

export async function delegateToAgy(args: DelegateArgs) {
  const {
    repoPath,
    task,
    allowedFiles = [],
    forbiddenFiles = [],
    testCommands = [],
    timeoutMs = 900000,
    useWorktree = true,
    branchPrefix = 'agent/agy-task',
    dryRun = false,
    maxTestTailLines,
    waitForCompletion = false,
  } = args;

  // Validate repo
  const root = await getGitRoot(repoPath);
  if (!root) {
    return { status: 'failed', error: 'Not a git repository or invalid path' };
  }

  const runId = Date.now().toString() + '-' + Math.random().toString(36).substring(2, 8);
  const repoName = path.basename(root);
  const runDir = path.join(root, '.codex-agy-runs', runId);
  await fs.mkdir(runDir, { recursive: true });

  let targetCwd = root;
  const branchName = `${branchPrefix}-${runId}`;
  let worktreePath: string | null = null;

  if (useWorktree) {
    worktreePath = path.resolve(root, '..', `${repoName}-agy-worktrees`, runId);
    try {
      await createWorktree(root, branchName, worktreePath);
      targetCwd = worktreePath;
    } catch (e: any) {
      return { status: 'failed', error: `Failed to create worktree: ${e.message}` };
    }
  } else {
    const uncommitted = await hasUncommittedChanges(root);
    if (uncommitted) {
      return { status: 'blocked', error: 'Repository has uncommitted changes and useWorktree is false. Cannot proceed.' };
    }
  }

  const taskContent = buildTaskContent(task, allowedFiles, forbiddenFiles);
  const taskMdPath = path.join(runDir, 'task.md');
  await fs.writeFile(taskMdPath, taskContent, 'utf-8');

  // Check if agy exists in PATH, or try a default global install if agy not found
  const { exitCode: agyCheck } = await runCommand('agy', ['--version'], targetCwd);
  if (agyCheck !== 0) {
    return { status: 'failed', error: 'Antigravity CLI (agy) not found in PATH. Please install it.' };
  }

  if (dryRun) {
    return { status: 'success', note: 'Dry run completed', targetCwd, taskMdPath };
  }

  const runConfig: RunConfig = {
    runId,
    root,
    runDir,
    targetCwd,
    branchName,
    worktreePath,
    taskContent,
    allowedFiles,
    forbiddenFiles,
    testCommands,
    timeoutMs,
    maxTestTailLines,
  };

  await writeRunConfig(runDir, runConfig);
  await writeRunReport(runDir, createInitialRunReport(runConfig));

  if (waitForCompletion) {
    await updateRunReport(runDir, {
      status: 'running',
      currentPhase: 'starting',
      summary: 'Starting inline agy run.',
      updatedAt: nowIso(),
    });
    await executeAgyRun(runDir);
    const finalReport = await readRunReport(runDir);
    return formatReport(finalReport ?? {
      status: 'failed',
      runId,
      branch: branchName,
      worktreePath,
      changedFiles: [],
      summary: 'Run report was not written.',
      tests: [],
      riskNotes: [],
      reviewFocus: [],
      assumptions: [],
      rawReportPath: runDir,
      agyExitCode: null,
      backgroundPid: null,
      currentPhase: 'failed',
      startedAt: nowIso(),
      updatedAt: nowIso(),
      finishedAt: nowIso(),
    }, args);
  }

  try {
    const backgroundPid = spawnBackgroundRunner(runDir, root);
    const startedReport: Partial<RunReport> = {
      status: 'running',
      backgroundPid,
      currentPhase: 'queued',
      summary: 'Run started in the background. Poll get_agy_run_report for progress.',
      updatedAt: nowIso(),
    };
    const reportData = await updateRunReport(runDir, startedReport);
    return formatReport(reportData, args);
  } catch (error: any) {
    if (worktreePath) {
      try {
        await removeWorktree(root, worktreePath);
      } catch {
        // Keep the original launch error as the primary failure.
      }
    }
    return { status: 'failed', error: error?.message || 'Failed to start the background runner.' };
  }
}
