import * as fs from 'fs/promises';
import * as path from 'path';
import { getGitRoot } from './git.js';
import { existsSync } from 'fs';
import { createInitialRunReport, readRunConfig, type RunReport } from './runArtifacts.js';

export type ReportDetail = 'compact' | 'full' | 'logs' | 'diffStat' | 'patch';

export interface GetAgyRunReportArgs {
  detail?: ReportDetail;
  maxBytes?: number;
}

function capString(value: string, maxBytes: number): string {
  if (Buffer.byteLength(value, 'utf-8') <= maxBytes) return value;
  return `${value.slice(0, maxBytes)}\n... truncated to ${maxBytes} bytes ...`;
}

function compactReport(reportData: RunReport | null) {
  if (!reportData) return null;
  const compact: any = {
    status: reportData.status,
    runId: reportData.runId,
    branch: reportData.branch,
    worktreePath: reportData.worktreePath,
    changed: {
      count: reportData.changedFiles?.length ?? 0,
      files: (reportData.changedFiles ?? []).slice(0, 30),
      omitted: Math.max(0, (reportData.changedFiles?.length ?? 0) - 30),
    },
    tests: {
      passed: (reportData.tests ?? []).every((test: any) => test.exitCode === 0),
      commands: (reportData.tests ?? []).map((test: any) => ({ command: test.command, exitCode: test.exitCode })),
      failed: (reportData.tests ?? [])
        .filter((test: any) => test.exitCode !== 0)
        .map((test: any) => ({ command: test.command, exitCode: test.exitCode, stdoutTail: test.stdoutTail, stderrTail: test.stderrTail })),
    },
    summary: reportData.summary ?? reportData.diffSummary,
    riskNotes: reportData.riskNotes ?? [],
    reviewFocus: reportData.reviewFocus ?? [],
    assumptions: reportData.assumptions ?? [],
    rawReportPath: reportData.rawReportPath,
    currentPhase: reportData.currentPhase,
    startedAt: reportData.startedAt,
    updatedAt: reportData.updatedAt,
    finishedAt: reportData.finishedAt,
  };

  if (reportData.error) compact.error = reportData.error;
  if ((reportData.violatedFiles?.length ?? 0) > 0) compact.violatedFiles = reportData.violatedFiles;
  if ((reportData.outsideAllowedFiles?.length ?? 0) > 0) compact.outsideAllowedFiles = reportData.outsideAllowedFiles;

  return compact;
}

async function readIfExists(filePath: string, maxBytes: number) {
  if (!existsSync(filePath)) return null;
  const content = await fs.readFile(filePath, 'utf-8');
  return capString(content, maxBytes);
}

export async function getAgyRunReport(repoPath: string, runId: string, options: GetAgyRunReportArgs = {}) {
  const root = await getGitRoot(repoPath);
  if (!root) throw new Error('Not a git repository');

  const runDir = path.join(root, '.codex-agy-runs', runId);
  if (!existsSync(runDir)) throw new Error('Run ID not found');

  const reportPath = path.join(runDir, 'report.json');
  let reportData: RunReport | null = null;
  if (existsSync(reportPath)) {
    reportData = JSON.parse(await fs.readFile(reportPath, 'utf-8'));
  } else {
    const config = await readRunConfig(runDir);
    if (config) {
      reportData = createInitialRunReport(config);
    }
  }

  const files = await fs.readdir(runDir);
  const detail = options.detail ?? 'compact';
  const maxBytes = options.maxBytes ?? 20000;

  if (detail === 'logs') {
    return {
      runDir,
      stdout: await readIfExists(path.join(runDir, 'agy.stdout.log'), maxBytes),
      stderr: await readIfExists(path.join(runDir, 'agy.stderr.log'), maxBytes),
      internalLog: await readIfExists(path.join(runDir, 'agy.internal.log'), maxBytes),
      runnerStdout: await readIfExists(path.join(runDir, 'runner.stdout.log'), maxBytes),
      runnerStderr: await readIfExists(path.join(runDir, 'runner.stderr.log'), maxBytes),
      logsAvailable: files,
    };
  }

  if (detail === 'diffStat') {
    return {
      runDir,
      diffStat: await readIfExists(path.join(runDir, 'diff.stat.txt'), maxBytes),
      logsAvailable: files,
    };
  }

  if (detail === 'patch') {
    return {
      runDir,
      patch: await readIfExists(path.join(runDir, 'diff.patch'), maxBytes),
      logsAvailable: files,
    };
  }

  return {
    runDir,
    report: detail === 'full' ? reportData : compactReport(reportData),
    logsAvailable: files
  };
}
