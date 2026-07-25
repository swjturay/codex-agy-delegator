import * as fs from 'fs/promises';
import { existsSync } from 'fs';
import * as path from 'path';

import { getGitRoot, removeWorktree } from './git.js';
import {
  nowIso,
  readRunConfig,
  readRunReport,
  writeRunReport,
} from './runArtifacts.js';
import {
  findExistingRunDir,
  isManagedWorktreePath,
} from './runPaths.js';
import { killProcessTree } from './shell.js';

async function readRunnerPid(runDir: string): Promise<number | null> {
  const pidPath = path.join(runDir, 'runner.pid');
  if (!existsSync(pidPath)) return null;
  const pid = Number.parseInt((await fs.readFile(pidPath, 'utf-8')).trim(), 10);
  return Number.isInteger(pid) && pid > 0 ? pid : null;
}

export async function cleanupAgentRun(
  repoPath: string,
  runId: string,
  removeWorktreeFlag = false,
) {
  const root = await getGitRoot(repoPath);
  if (!root) throw new Error('Not a git repository');
  const runDir = findExistingRunDir(root, runId);
  const report = await readRunReport(runDir);
  const config = await readRunConfig(runDir);
  const errors: string[] = [];

  const backgroundPid = report?.backgroundPid ?? await readRunnerPid(runDir);
  if (
    backgroundPid
    && (!report || report.status === 'queued' || report.status === 'running')
  ) {
    try {
      await killProcessTree(backgroundPid);
      if (report) {
        const now = nowIso();
        await writeRunReport(runDir, {
          ...report,
          status: 'cancelled',
          currentPhase: 'cancelled',
          backgroundPid: null,
          summary: 'Run cancelled during cleanup.',
          finishedAt: now,
          updatedAt: now,
        });
      }
    } catch (error: any) {
      errors.push(`Failed to stop background runner: ${error?.message ?? error}`);
    }
  }

  const worktreePath = config?.worktreePath ?? report?.worktreePath ?? null;
  if (removeWorktreeFlag && worktreePath) {
    if (!isManagedWorktreePath(root, worktreePath)) {
      errors.push('Refused to remove a worktree outside the managed worktree directory.');
    } else if (existsSync(worktreePath)) {
      try {
        await removeWorktree(root, worktreePath);
      } catch (error: any) {
        errors.push(`Failed to remove worktree: ${error?.message ?? error}`);
      }
    }
  }

  if (errors.length > 0) {
    return {
      status: 'partial_success',
      error: errors.join(' | '),
      runDirRetained: true,
    };
  }

  await fs.rm(runDir, { recursive: true, force: true });
  return {
    status: 'success',
    message: `Cleanup performed for run ${runId}`,
    worktreeRemoved: Boolean(removeWorktreeFlag && worktreePath),
  };
}
