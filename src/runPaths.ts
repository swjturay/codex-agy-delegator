import * as path from 'path';
import { existsSync, realpathSync } from 'fs';

export const RUNS_DIR_NAME = '.codex-agent-runs';
export const LEGACY_RUNS_DIR_NAME = '.codex-agy-runs';

const RUN_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export function validateRunId(runId: string): string {
  if (!RUN_ID_PATTERN.test(runId) || runId === '.' || runId === '..') {
    throw new Error('Invalid run ID');
  }
  return runId;
}

export function isPathInside(parentPath: string, candidatePath: string): boolean {
  const parent = path.resolve(parentPath);
  const candidate = path.resolve(candidatePath);
  const relative = path.relative(parent, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function resolveContainedChild(parentPath: string, childName: string): string {
  const child = path.resolve(parentPath, childName);
  if (!isPathInside(parentPath, child) || child === path.resolve(parentPath)) {
    throw new Error('Resolved path escapes its managed directory');
  }
  return child;
}

export function getRunsRoot(repoRoot: string, legacy = false): string {
  return path.resolve(repoRoot, legacy ? LEGACY_RUNS_DIR_NAME : RUNS_DIR_NAME);
}

export function resolveNewRunDir(repoRoot: string, runId: string): string {
  return resolveContainedChild(getRunsRoot(repoRoot), validateRunId(runId));
}

export function findExistingRunDir(repoRoot: string, runId: string): string {
  validateRunId(runId);
  const current = resolveContainedChild(getRunsRoot(repoRoot), runId);
  if (existsSync(current)) return current;

  const legacy = resolveContainedChild(getRunsRoot(repoRoot, true), runId);
  if (existsSync(legacy)) return legacy;
  throw new Error('Run ID not found');
}

export function getWorktreeRoot(repoRoot: string, legacy = false): string {
  const repoName = path.basename(repoRoot);
  const suffix = legacy ? 'agy-worktrees' : 'agent-worktrees';
  return path.resolve(repoRoot, '..', `${repoName}-${suffix}`);
}

export function resolveNewWorktreePath(repoRoot: string, runId: string): string {
  return resolveContainedChild(getWorktreeRoot(repoRoot), validateRunId(runId));
}

export function isManagedWorktreePath(repoRoot: string, worktreePath: string): boolean {
  const canonicalize = (value: string) => {
    const resolved = path.resolve(value);
    try {
      return realpathSync.native(resolved);
    } catch {
      const suffix: string[] = [];
      let cursor = resolved;
      while (path.dirname(cursor) !== cursor) {
        suffix.unshift(path.basename(cursor));
        cursor = path.dirname(cursor);
        try {
          return path.join(realpathSync.native(cursor), ...suffix);
        } catch {
          // Continue toward the filesystem root.
        }
      }
      return resolved;
    }
  };
  const candidate = canonicalize(worktreePath);
  return [getWorktreeRoot(repoRoot), getWorktreeRoot(repoRoot, true)]
    .map(canonicalize)
    .some((managedRoot) => isPathInside(managedRoot, candidate) && candidate !== managedRoot);
}
