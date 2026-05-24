import * as fs from 'fs/promises';
import * as path from 'path';
import { getGitRoot } from './git.js';
import { existsSync } from 'fs';

export async function getAgyRunReport(repoPath: string, runId: string) {
  const root = await getGitRoot(repoPath);
  if (!root) throw new Error('Not a git repository');

  const runDir = path.join(root, '.codex-agy-runs', runId);
  if (!existsSync(runDir)) throw new Error('Run ID not found');

  const reportPath = path.join(runDir, 'report.json');
  let reportData = null;
  if (existsSync(reportPath)) {
    reportData = JSON.parse(await fs.readFile(reportPath, 'utf-8'));
  }

  const files = await fs.readdir(runDir);

  return {
    runDir,
    report: reportData,
    logsAvailable: files
  };
}
