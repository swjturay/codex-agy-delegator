import * as fs from 'fs/promises';
import { existsSync } from 'fs';
import * as path from 'path';

import { getGitRoot } from './git.js';
import {
  createInitialRunReport,
  readRunConfig,
  readRunReport,
  type RunReport,
} from './runArtifacts.js';
import { findExistingRunDir } from './runPaths.js';

export type ReportDetail = 'compact' | 'full' | 'logs' | 'diffStat' | 'patch';

export interface GetAgentRunReportArgs {
  detail?: ReportDetail;
  maxBytes?: number;
}

function capString(value: string, maxBytes: number): string {
  const buffer = Buffer.from(value, 'utf-8');
  if (buffer.byteLength <= maxBytes) return value;
  return `${buffer.subarray(0, maxBytes).toString('utf-8')}\n... truncated to ${maxBytes} bytes ...`;
}

function compactReport(report: RunReport | null) {
  if (!report) return null;
  const failedTests = report.tests.filter(
    (test) => test.exitCode !== 0 || test.timedOut,
  );
  return {
    status: report.status,
    runId: report.runId,
    agent: report.agent,
    agentVersion: report.agentVersion,
    branch: report.branch,
    worktreePath: report.worktreePath,
    changed: {
      count: report.changedFiles.length,
      files: report.changedFiles.slice(0, 30),
      omitted: Math.max(0, report.changedFiles.length - 30),
    },
    tests: {
      passed: failedTests.length === 0,
      commands: report.tests.map((test) => ({
        command: test.command,
        exitCode: test.exitCode,
        timedOut: test.timedOut,
      })),
      failed: failedTests,
    },
    summary: report.summary,
    riskNotes: report.riskNotes,
    reviewFocus: report.reviewFocus,
    assumptions: report.assumptions,
    rawReportPath: report.rawReportPath,
    currentPhase: report.currentPhase,
    error: report.error,
    violatedFiles: report.violatedFiles,
    outsideAllowedFiles: report.outsideAllowedFiles,
    startedAt: report.startedAt,
    updatedAt: report.updatedAt,
    finishedAt: report.finishedAt,
    appliedAt: report.appliedAt,
  };
}

async function readIfExists(filePath: string, maxBytes: number) {
  if (!existsSync(filePath)) return null;
  return capString(await fs.readFile(filePath, 'utf-8'), maxBytes);
}

export async function getAgentRunReport(
  repoPath: string,
  runId: string,
  options: GetAgentRunReportArgs = {},
) {
  const root = await getGitRoot(repoPath);
  if (!root) throw new Error('Not a git repository');
  const runDir = findExistingRunDir(root, runId);
  const detail = options.detail ?? 'compact';
  if (!['compact', 'full', 'logs', 'diffStat', 'patch'].includes(detail)) {
    throw new Error(`Unsupported report detail: ${detail}`);
  }
  const maxBytes = options.maxBytes ?? 20_000;
  if (!Number.isInteger(maxBytes) || maxBytes < 1 || maxBytes > 5_000_000) {
    throw new Error('maxBytes must be an integer between 1 and 5000000');
  }

  let report = await readRunReport(runDir);
  if (!report) {
    const config = await readRunConfig(runDir);
    if (config) report = createInitialRunReport(config);
  }
  const files = await fs.readdir(runDir);

  if (detail === 'logs') {
    return {
      runDir,
      stdout: await readIfExists(path.join(runDir, 'agent.stdout.log'), maxBytes)
        ?? await readIfExists(path.join(runDir, 'agy.stdout.log'), maxBytes),
      stderr: await readIfExists(path.join(runDir, 'agent.stderr.log'), maxBytes)
        ?? await readIfExists(path.join(runDir, 'agy.stderr.log'), maxBytes),
      response: await readIfExists(path.join(runDir, 'agent.response.txt'), maxBytes),
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
    report: detail === 'full' ? report : compactReport(report),
    logsAvailable: files,
  };
}
