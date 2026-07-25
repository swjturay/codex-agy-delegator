import { runCommand } from './shell.js';
import * as path from 'path';
import * as fs from 'fs/promises';
import { existsSync } from 'fs';

export async function getGitRoot(cwd: string): Promise<string | null> {
  const { exitCode, stdout } = await runCommand('git', ['rev-parse', '--show-toplevel'], cwd);
  if (exitCode !== 0) return null;
  return stdout.trim();
}

export async function getHeadCommit(cwd: string): Promise<string> {
  const result = await runCommand('git', ['rev-parse', 'HEAD'], cwd);
  if (result.exitCode !== 0 || !result.stdout.trim()) {
    throw new Error('Failed to resolve the repository HEAD commit');
  }
  return result.stdout.trim();
}

export async function hasUncommittedChanges(cwd: string): Promise<boolean> {
  const { exitCode, stdout } = await runCommand('git', ['status', '--porcelain'], cwd);
  if (exitCode !== 0) throw new Error('git status failed');
  return stdout.trim().length > 0;
}

export async function ensureLocalGitExcludes(repoPath: string): Promise<void> {
  const result = await runCommand(
    'git',
    ['rev-parse', '--path-format=absolute', '--git-path', 'info/exclude'],
    repoPath,
  );
  if (result.exitCode !== 0 || !result.stdout.trim()) {
    throw new Error('Failed to locate the repository-local git exclude file');
  }
  const excludePath = result.stdout.trim();
  let contents = '';
  if (existsSync(excludePath)) contents = await fs.readFile(excludePath, 'utf-8');
  const required = ['.codex-agent-runs/', '.codex-agy-runs/'];
  const existing = new Set(
    contents.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean),
  );
  const missing = required.filter((line) => !existing.has(line));
  if (missing.length === 0) return;
  const separator = contents.length === 0 || contents.endsWith('\n') ? '' : '\n';
  await fs.mkdir(path.dirname(excludePath), { recursive: true });
  await fs.appendFile(
    excludePath,
    `${separator}${missing.join('\n')}\n`,
    'utf-8',
  );
}

export async function createWorktree(repoPath: string, branchName: string, worktreePath: string): Promise<void> {
  const check = await runCommand('git', ['check-ref-format', '--branch', branchName], repoPath);
  if (check.exitCode !== 0) {
    throw new Error(`Invalid branch name: ${branchName}`);
  }
  const { exitCode, stderr } = await runCommand('git', ['worktree', 'add', '-b', branchName, worktreePath], repoPath);
  if (exitCode !== 0) {
    throw new Error(`Failed to create worktree: ${stderr}`);
  }
}

export async function removeWorktree(repoPath: string, worktreePath: string): Promise<void> {
  const { exitCode, stderr } = await runCommand('git', ['worktree', 'remove', '-f', worktreePath], repoPath);
  if (exitCode !== 0) {
    throw new Error(`Failed to remove worktree: ${stderr}`);
  }
}

function parseNullSeparatedPaths(value: string): string[] {
  return value.split('\0').filter((entry) => entry.length > 0);
}

export async function getDiffFiles(cwd: string, base = 'HEAD'): Promise<string[]> {
  const { exitCode, stdout } = await runCommand(
    'git',
    ['diff', '--name-only', '-z', base],
    cwd,
  );
  if (exitCode !== 0) return [];
  const files = parseNullSeparatedPaths(stdout);
  
  const { exitCode: exitCodeUntracked, stdout: stdoutUntracked } = await runCommand(
    'git',
    ['ls-files', '--others', '--exclude-standard', '-z'],
    cwd,
  );
  if (exitCodeUntracked === 0) {
    const untracked = parseNullSeparatedPaths(stdoutUntracked);
    files.push(...untracked);
  }
  
  return Array.from(new Set(files));
}

async function getUntrackedFiles(cwd: string): Promise<string[]> {
  const { exitCode, stdout } = await runCommand(
    'git',
    ['ls-files', '--others', '--exclude-standard', '-z'],
    cwd,
  );
  if (exitCode !== 0) return [];
  return parseNullSeparatedPaths(stdout);
}

export async function getDiffStat(cwd: string, base = 'HEAD'): Promise<string> {
  const { exitCode, stdout } = await runCommand('git', ['diff', '--stat', base], cwd);
  const parts: string[] = [];
  if (exitCode === 0 && stdout.trim()) parts.push(stdout.trim());

  const untracked = await getUntrackedFiles(cwd);
  if (untracked.length > 0) {
    parts.push([
      'Untracked files:',
      ...untracked.map((file) => ` ${file} | new file`),
    ].join('\n'));
  }

  return parts.join('\n\n');
}

export async function getDiff(cwd: string, base = 'HEAD'): Promise<string> {
  const { exitCode, stdout } = await runCommand('git', ['diff', '--binary', base], cwd);
  const parts: string[] = [];
  if (exitCode === 0 && stdout.trim()) parts.push(stdout);

  const untracked = await getUntrackedFiles(cwd);
  for (const file of untracked) {
    const fullPath = path.join(cwd, file);
    if (!existsSync(fullPath)) continue;
    const stat = await fs.lstat(fullPath);
    if (!stat.isFile() && !stat.isSymbolicLink()) continue;

    const { stdout: fileDiff } = await runCommand(
      'git',
      ['diff', '--binary', '--no-index', '--', '/dev/null', file],
      cwd,
    );
    if (fileDiff.trim()) {
      parts.push(fileDiff);
    } else {
      parts.push(`diff --git a/${file} b/${file}\nnew file mode 100644`);
    }
  }

  return parts.join('\n');
}

export async function checkPatch(cwd: string, patchPath: string): Promise<void> {
  const result = await runCommand('git', ['apply', '--check', '--binary', patchPath], cwd);
  if (result.exitCode !== 0) {
    throw new Error(`Patch cannot be applied cleanly: ${result.stderr || result.stdout}`.trim());
  }
}

export async function applyPatch(cwd: string, patchPath: string): Promise<void> {
  const result = await runCommand('git', ['apply', '--binary', patchPath], cwd);
  if (result.exitCode !== 0) {
    throw new Error(`Failed to apply patch: ${result.stderr || result.stdout}`.trim());
  }
}
