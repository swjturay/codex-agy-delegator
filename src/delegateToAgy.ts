import * as fs from 'fs/promises';
import * as path from 'path';
import { getGitRoot, hasUncommittedChanges, createWorktree, getDiffFiles, getDiffStat, getDiff } from './git.js';
import { runCommand, tailString } from './shell.js';
import { parseAgyReport } from './report.js';
import { findFilesOutsideRules, findRuleViolations } from './pathRules.js';
import { spawn } from 'child_process';
import { createWriteStream, existsSync } from 'fs';

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
}

interface TestResult {
  command: string;
  exitCode: number;
  stdoutTail: string;
  stderrTail: string;
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
  };

  if (reportData.error) compactReport.error = reportData.error;
  if (reportData.violatedFiles?.length > 0) compactReport.violatedFiles = reportData.violatedFiles;
  if (reportData.outsideAllowedFiles?.length > 0) compactReport.outsideAllowedFiles = reportData.outsideAllowedFiles;

  if (args.includeDiffStat || responseMode === 'standard') {
    compactReport.diffStat = capString(reportData.diffStat ?? '', 4000);
  }

  if (reportData.agyExitCode !== 0) {
    compactReport.agyExitCode = reportData.agyExitCode;
  }

  return compactReport;
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

  // Create task.md
  const taskMdPath = path.join(runDir, 'task.md');
  const taskContent = `# Task
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
  await fs.writeFile(taskMdPath, taskContent, 'utf-8');

  // Check if agy exists in PATH, or try a default global install if agy not found
  const { exitCode: agyCheck } = await runCommand('agy', ['--version'], targetCwd);
  if (agyCheck !== 0) {
    return { status: 'failed', error: 'Antigravity CLI (agy) not found in PATH. Please install it.' };
  }

  if (dryRun) {
    return { status: 'success', note: 'Dry run completed', targetCwd, taskMdPath };
  }

  // Execute agy and persist raw logs for optional follow-up inspection.
  const agyLogPath = path.join(runDir, 'agy.stdout.log');
  const agyErrPath = path.join(runDir, 'agy.stderr.log');
  
  const agyPromise = new Promise<{code: number | null}>((resolve) => {
    const proc = spawn('agy', ['--print', taskContent], { cwd: targetCwd, shell: false });
    const outStream = createWriteStream(agyLogPath);
    const errStream = createWriteStream(agyErrPath);
    
    proc.stdout.pipe(outStream);
    proc.stderr.pipe(errStream);
    
    let timer = setTimeout(() => {
      proc.kill('SIGKILL');
    }, timeoutMs);
    
    proc.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code });
    });
  });

  const agyResult = await agyPromise;
  
  // Verify changed files against allowed and forbidden file rules.
  const changedFiles = await getDiffFiles(targetCwd);
  const violatedFiles = findRuleViolations(changedFiles, forbiddenFiles, true);
  const outsideAllowedFiles = findFilesOutsideRules(changedFiles, allowedFiles);

  if (violatedFiles.length > 0 || outsideAllowedFiles.length > 0) {
    const blockedReport = {
      status: 'blocked',
      runId,
      branch: branchName,
      worktreePath,
      error: violatedFiles.length > 0 ? 'Worker modified forbidden files' : 'Worker modified files outside allowed files',
      violatedFiles,
      outsideAllowedFiles,
      changedFiles,
      rawReportPath: runDir,
    };
    await fs.writeFile(path.join(runDir, 'report.json'), JSON.stringify(blockedReport, null, 2), 'utf-8');
    return formatReport(blockedReport, args);
  }

  // Run tests
  const tests = [];
  let testsFailed = false;
  let testsToRun = [...testCommands];
  if (testsToRun.length === 0) {
    if (existsSync(path.join(targetCwd, 'package.json'))) {
      const pkg = JSON.parse(await fs.readFile(path.join(targetCwd, 'package.json'), 'utf-8'));
      if (pkg.scripts?.typecheck) testsToRun.push('npm run typecheck');
      if (pkg.scripts?.test) testsToRun.push('npm test');
    }
  }

  for (const cmd of testsToRun) {
    const parts = cmd.split(' ');
    const { exitCode, stdout, stderr } = await runCommand(parts[0], parts.slice(1), targetCwd);
    const tailLines = maxTestTailLines ?? (exitCode === 0 ? 0 : 10);
    tests.push({
      command: cmd,
      exitCode,
      stdoutTail: tailLines > 0 ? tailString(stdout, tailLines) : '',
      stderrTail: tailLines > 0 ? tailString(stderr, tailLines) : '',
    });
    if (exitCode !== 0) testsFailed = true;
  }

  const diffStat = await getDiffStat(targetCwd);
  const diffSummary = `Changed files: ${changedFiles.length}\nStat:\n${diffStat}`;
  
  await fs.writeFile(path.join(runDir, 'diff.stat.txt'), diffStat, 'utf-8');
  await fs.writeFile(path.join(runDir, 'diff.patch'), await getDiff(targetCwd), 'utf-8');

  // Attempt to parse agy output for JSON block
  const agyOutput = await fs.readFile(agyLogPath, 'utf-8');
  const jsonMatch = agyOutput.match(/\`\`\`json\s*(\{[\s\S]*?\})\s*\`\`\`/);
  let parsedReport = null;
  if (jsonMatch) {
    parsedReport = parseAgyReport(jsonMatch[1]);
  }

  const reportData = {
    status: testsFailed || agyResult.code !== 0 || !parsedReport ? 'needs_review' : 'success',
    runId,
    branch: branchName,
    worktreePath,
    changedFiles,
    diffStat,
    diffSummary: parsedReport?.implementation_summary || diffSummary,
    summary: parsedReport?.summary || parsedReport?.implementation_summary || diffSummary,
    tests,
    riskNotes: parsedReport?.risk_notes || [],
    reviewFocus: parsedReport?.review_focus || [],
    assumptions: parsedReport?.assumptions || [],
    agyExitCode: agyResult.code,
    rawReportPath: runDir
  };

  await fs.writeFile(path.join(runDir, 'report.json'), JSON.stringify(reportData, null, 2), 'utf-8');

  return formatReport(reportData, args);
}
