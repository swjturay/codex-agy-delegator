import * as fs from 'fs/promises';
import * as path from 'path';
import { existsSync } from 'fs';

export type RunStatus = 'queued' | 'running' | 'success' | 'needs_review' | 'blocked' | 'failed' | 'cancelled';

export interface TestResult {
  command: string;
  exitCode: number;
  stdoutTail: string;
  stderrTail: string;
}

export interface RunConfig {
  runId: string;
  root: string;
  runDir: string;
  targetCwd: string;
  branchName: string;
  worktreePath: string | null;
  taskContent: string;
  allowedFiles: string[];
  forbiddenFiles: string[];
  testCommands: string[];
  timeoutMs: number;
  maxTestTailLines?: number;
}

export interface RunReport {
  status: RunStatus;
  runId: string;
  branch: string;
  worktreePath: string | null;
  changedFiles: string[];
  diffStat?: string;
  diffSummary?: string;
  summary: string;
  tests: TestResult[];
  riskNotes: string[];
  reviewFocus: string[];
  assumptions: string[];
  rawReportPath: string;
  agyExitCode: number | null;
  backgroundPid: number | null;
  currentPhase?: string;
  error?: string;
  violatedFiles?: string[];
  outsideAllowedFiles?: string[];
  startedAt: string;
  updatedAt: string;
  finishedAt?: string;
}

export function nowIso() {
  return new Date().toISOString();
}

export function getRunConfigPath(runDir: string) {
  return path.join(runDir, 'run.config.json');
}

export function getRunReportPath(runDir: string) {
  return path.join(runDir, 'report.json');
}

export function createInitialRunReport(config: RunConfig): RunReport {
  const now = nowIso();
  return {
    status: 'queued',
    runId: config.runId,
    branch: config.branchName,
    worktreePath: config.worktreePath,
    changedFiles: [],
    summary: 'Run queued. Poll get_agy_run_report for progress.',
    tests: [],
    riskNotes: [],
    reviewFocus: [],
    assumptions: [],
    rawReportPath: config.runDir,
    agyExitCode: null,
    backgroundPid: null,
    currentPhase: 'queued',
    startedAt: now,
    updatedAt: now,
  };
}

export async function writeRunConfig(runDir: string, config: RunConfig) {
  await fs.writeFile(getRunConfigPath(runDir), JSON.stringify(config, null, 2), 'utf-8');
}

export async function readRunConfig(runDir: string): Promise<RunConfig | null> {
  const configPath = getRunConfigPath(runDir);
  if (!existsSync(configPath)) return null;
  return JSON.parse(await fs.readFile(configPath, 'utf-8'));
}

export async function writeRunReport(runDir: string, report: RunReport) {
  await fs.writeFile(getRunReportPath(runDir), JSON.stringify(report, null, 2), 'utf-8');
}

export async function readRunReport(runDir: string): Promise<RunReport | null> {
  const reportPath = getRunReportPath(runDir);
  if (!existsSync(reportPath)) return null;
  return JSON.parse(await fs.readFile(reportPath, 'utf-8'));
}

export async function updateRunReport(runDir: string, patch: Partial<RunReport>) {
  const current = await readRunReport(runDir);
  if (!current) {
    throw new Error(`Run report not found for ${runDir}`);
  }

  const nextReport: RunReport = {
    ...current,
    ...patch,
    updatedAt: patch.updatedAt ?? nowIso(),
  };

  await writeRunReport(runDir, nextReport);
  return nextReport;
}
