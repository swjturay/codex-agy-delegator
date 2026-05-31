import * as fs from 'fs/promises';
import * as path from 'path';
import { getGitRoot, removeWorktree } from './git.js';
import { existsSync } from 'fs';
import { killProcessTree } from './shell.js';
import { readRunConfig, readRunReport, writeRunReport } from './runArtifacts.js';

export async function cleanupAgyRun(repoPath: string, runId: string, removeWorktreeFlag: boolean = false) {
  const root = await getGitRoot(repoPath);
  if (!root) throw new Error('Not a git repository');

  const runDir = path.join(root, '.codex-agy-runs', runId);
  if (!existsSync(runDir)) throw new Error('Run ID not found');

  const errors: string[] = [];
  const reportData = await readRunReport(runDir);
  const runConfig = await readRunConfig(runDir);
  const backgroundPid = reportData?.backgroundPid ?? null;
  const worktreePath = reportData?.worktreePath ?? runConfig?.worktreePath ?? null;

  if (typeof backgroundPid === 'number' && backgroundPid > 0) {
    try {
      await killProcessTree(backgroundPid);
      if (reportData) {
        await writeRunReport(runDir, {
          ...reportData,
          status: 'cancelled',
          currentPhase: 'cancelled',
          backgroundPid: null,
          finishedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          summary: reportData.summary || 'Run cancelled during cleanup.',
        });
      }
    } catch (e: any) {
      errors.push(`Failed to stop background runner: ${e.message}`);
    }
  }

  if (removeWorktreeFlag && worktreePath && existsSync(worktreePath)) {
    try {
      await removeWorktree(root, worktreePath);
    } catch (e: any) {
      errors.push(`Failed to remove worktree: ${e.message}`);
    }
  }

  try {
    await fs.rm(runDir, { recursive: true, force: true });
  } catch (e: any) {
    errors.push(`Failed to remove run directory: ${e.message}`);
  }

  if (errors.length > 0) {
    return { status: 'partial_success', error: errors.join(' | ') };
  }

  return { status: 'success', message: `Cleanup performed for run ${runId}` };
}
