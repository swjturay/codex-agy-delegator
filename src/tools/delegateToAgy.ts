import * as fs from 'fs/promises';
import * as path from 'path';
import { getGitRoot, hasUncommittedChanges, createWorktree, getDiffFiles, getDiffStat, getDiff } from './git.js';
import { runCommand, tailString } from './shell.js';
import { parseAgyReport } from './report.js';
import { spawn } from 'child_process';
import { existsSync } from 'fs';

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
You are an agy worker. You MUST output a JSON block at the very end of your final response containing your report, enclosed in \`\`\`json.
Your JSON must follow the AgyWorkerReport format. Do not violate forbidden files.
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

  // Execute agy (we simulate this via spawn since it's a CLI that takes instructions)
  // Since we can't reliably inject directly into stdin for interactive CLI, we will run `agy --task-file` or similar.
  // Assuming `agy --instruction "$(cat task.md)"` or just `agy "instruction"`
  // For safety we pass it as a single argument.
  
  const agyArgs = ['--instruction', taskContent]; // Depending on actual Antigravity CLI args. If it doesn't support --instruction, we might just pass it as positional. Let's use generic positional or a safe invocation.
  // If agy just takes prompt as positional arguments:
  
  const agyLogPath = path.join(runDir, 'agy.stdout.log');
  const agyErrPath = path.join(runDir, 'agy.stderr.log');
  
  const agyPromise = new Promise<{code: number | null}>((resolve) => {
    const proc = spawn('agy', ['--print', taskContent], { cwd: targetCwd, shell: false });
    const outStream = require('fs').createWriteStream(agyLogPath);
    const errStream = require('fs').createWriteStream(agyErrPath);
    
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
  
  // Verify changed files against forbidden files
  const changedFiles = await getDiffFiles(targetCwd);
  let blockedByForbidden = false;
  const violatedFiles: string[] = [];
  
  for (const f of changedFiles) {
    for (const forbidden of forbiddenFiles) {
      if (f.includes(forbidden)) { // simple matching for now
        blockedByForbidden = true;
        violatedFiles.push(f);
      }
    }
  }

  if (blockedByForbidden) {
    return {
      status: 'blocked',
      error: 'Worker modified forbidden files',
      violatedFiles,
      changedFiles,
    };
  }

  // Run tests
  const tests = [];
  let testsFailed = false;
  let testsToRun = testCommands;
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
    tests.push({
      command: cmd,
      exitCode,
      stdoutTail: tailString(stdout, 20),
      stderrTail: tailString(stderr, 20),
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
    status: testsFailed ? 'needs_review' : 'success',
    branch: branchName,
    worktreePath,
    changedFiles,
    diffStat,
    diffSummary: parsedReport?.implementation_summary || diffSummary,
    tests,
    riskNotes: parsedReport?.risk_notes || [],
    reviewFocus: parsedReport?.review_focus || [],
    rawReportPath: runDir
  };

  await fs.writeFile(path.join(runDir, 'report.json'), JSON.stringify(reportData, null, 2), 'utf-8');

  return reportData;
}
