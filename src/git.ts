import { runCommand } from './shell.js';
import * as path from 'path';
import * as fs from 'fs/promises';
import { existsSync } from 'fs';

export async function getGitRoot(cwd: string): Promise<string | null> {
  const { exitCode, stdout } = await runCommand('git', ['rev-parse', '--show-toplevel'], cwd);
  if (exitCode !== 0) return null;
  return stdout.trim();
}

export async function hasUncommittedChanges(cwd: string): Promise<boolean> {
  const { exitCode, stdout } = await runCommand('git', ['status', '--porcelain'], cwd);
  if (exitCode !== 0) throw new Error('git status failed');
  return stdout.trim().length > 0;
}

export async function createWorktree(repoPath: string, branchName: string, worktreePath: string): Promise<void> {
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

export async function getDiffFiles(cwd: string): Promise<string[]> {
  const { exitCode, stdout } = await runCommand('git', ['diff', '--name-only'], cwd);
  if (exitCode !== 0) return [];
  const files = stdout.split('\n').map((s: string) => s.trim()).filter(Boolean);
  
  const { exitCode: exitCodeUntracked, stdout: stdoutUntracked } = await runCommand('git', ['ls-files', '--others', '--exclude-standard'], cwd);
  if (exitCodeUntracked === 0) {
    const untracked = stdoutUntracked.split('\n').map((s: string) => s.trim()).filter(Boolean);
    files.push(...untracked);
  }
  
  return Array.from(new Set(files));
}

async function getUntrackedFiles(cwd: string): Promise<string[]> {
  const { exitCode, stdout } = await runCommand('git', ['ls-files', '--others', '--exclude-standard'], cwd);
  if (exitCode !== 0) return [];
  return stdout.split('\n').map((s: string) => s.trim()).filter(Boolean);
}

export async function getDiffStat(cwd: string): Promise<string> {
  const { exitCode, stdout } = await runCommand('git', ['diff', '--stat'], cwd);
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

export async function getDiff(cwd: string): Promise<string> {
  const { exitCode, stdout } = await runCommand('git', ['diff'], cwd);
  const parts: string[] = [];
  if (exitCode === 0 && stdout.trim()) parts.push(stdout.trim());

  const untracked = await getUntrackedFiles(cwd);
  for (const file of untracked) {
    const fullPath = path.join(cwd, file);
    if (!existsSync(fullPath)) continue;
    const stat = await fs.stat(fullPath);
    if (!stat.isFile()) continue;

    const { stdout: fileDiff } = await runCommand('git', ['diff', '--no-index', '--', '/dev/null', file], cwd);
    if (fileDiff.trim()) {
      parts.push(fileDiff.trim());
    } else {
      parts.push(`diff --git a/${file} b/${file}\nnew file mode 100644`);
    }
  }

  return parts.join('\n\n');
}
