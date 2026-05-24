import { runCommand } from './shell.js';
import * as path from 'path';

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

export async function getDiffStat(cwd: string): Promise<string> {
  const { exitCode, stdout } = await runCommand('git', ['diff', '--stat'], cwd);
  if (exitCode !== 0) return '';
  return stdout.trim();
}

export async function getDiff(cwd: string): Promise<string> {
  const { exitCode, stdout } = await runCommand('git', ['diff'], cwd);
  if (exitCode !== 0) return '';
  return stdout.trim();
}
