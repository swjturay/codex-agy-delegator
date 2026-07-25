import * as fs from 'fs/promises';
import { existsSync } from 'fs';
import * as path from 'path';

import {
  applyPatch,
  checkPatch,
  getGitRoot,
  hasUncommittedChanges,
} from './git.js';
import {
  nowIso,
  readRunConfig,
  readRunReport,
  updateRunReport,
} from './runArtifacts.js';
import { findExistingRunDir } from './runPaths.js';

export interface ApplyAgentRunArgs {
  repoPath: string;
  runId: string;
  confirm: boolean;
  allowNeedsReview?: boolean;
}

export async function applyAgentRun(args: ApplyAgentRunArgs) {
  if (args.confirm !== true) {
    throw new Error('Applying a delegated patch requires confirm=true');
  }
  const root = await getGitRoot(args.repoPath);
  if (!root) throw new Error('Not a git repository');
  const runDir = findExistingRunDir(root, args.runId);
  const report = await readRunReport(runDir);
  const config = await readRunConfig(runDir);
  if (!report || !config) throw new Error('Run metadata is incomplete');
  if (report.status === 'blocked') {
    throw new Error('Blocked runs cannot be applied');
  }
  if (
    report.status !== 'success'
    && !(args.allowNeedsReview === true && report.status === 'needs_review')
  ) {
    throw new Error(
      'Only successful runs can be applied; needs_review also requires allowNeedsReview=true',
    );
  }
  if (!config.worktreePath) {
    throw new Error('This run already edited the target repository directly');
  }
  if (report.appliedAt) {
    return { status: 'already_applied', runId: args.runId, appliedAt: report.appliedAt };
  }
  if (await hasUncommittedChanges(root)) {
    throw new Error('Target repository must be clean before applying a delegated patch');
  }

  const patchPath = path.join(runDir, 'diff.patch');
  if (!existsSync(patchPath)) throw new Error('Run patch is missing');
  if (!(await fs.readFile(patchPath, 'utf-8')).trim()) {
    const appliedAt = nowIso();
    await updateRunReport(runDir, { appliedAt });
    return {
      status: 'success',
      runId: args.runId,
      appliedAt,
      changedFiles: [],
      noChanges: true,
    };
  }
  await checkPatch(root, patchPath);
  await applyPatch(root, patchPath);
  const appliedAt = nowIso();
  await updateRunReport(runDir, { appliedAt });
  return {
    status: 'success',
    runId: args.runId,
    appliedAt,
    changedFiles: report.changedFiles,
  };
}
