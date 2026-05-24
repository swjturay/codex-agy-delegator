import * as fs from 'fs/promises';
import * as path from 'path';
import { getGitRoot, removeWorktree } from './git.js';
import { existsSync } from 'fs';

export async function cleanupAgyRun(repoPath: string, runId: string, removeWorktreeFlag: boolean = false) {
  const root = await getGitRoot(repoPath);
  if (!root) throw new Error('Not a git repository');

  const runDir = path.join(root, '.codex-agy-runs', runId);
  if (!existsSync(runDir)) throw new Error('Run ID not found');

  const reportPath = path.join(runDir, 'report.json');
  if (removeWorktreeFlag && existsSync(reportPath)) {
    const reportData = JSON.parse(await fs.readFile(reportPath, 'utf-8'));
    if (reportData.worktreePath && existsSync(reportData.worktreePath)) {
      try {
        await removeWorktree(root, reportData.worktreePath);
      } catch (e: any) {
        return { status: 'partial_success', error: `Failed to remove worktree: ${e.message}` };
      }
    }
  }

  // We don't delete the run logs automatically unless requested, maybe just let the user know.
  // The prompt says: "用于清理临时日志或 worktree。不要删除用户代码，必须谨慎。"
  
  if (!removeWorktreeFlag) {
    // maybe clean up big diffs
    const diffPath = path.join(runDir, 'diff.patch');
    if (existsSync(diffPath)) {
      await fs.unlink(diffPath);
    }
  }

  return { status: 'success', message: `Cleanup performed for run ${runId}` };
}
