import * as fs from 'fs/promises';
import * as path from 'path';
import { existsSync } from 'fs';
import { randomBytes } from 'crypto';

import type { AgentKind, AgentPermissionMode } from './agentBackends.js';

export type RunStatus =
  | 'queued'
  | 'running'
  | 'success'
  | 'needs_review'
  | 'blocked'
  | 'failed'
  | 'cancelled';

export interface TestResult {
  command: string;
  exitCode: number | null;
  timedOut: boolean;
  stdoutTail: string;
  stderrTail: string;
}

export interface RunConfig {
  schemaVersion: 2;
  runId: string;
  root: string;
  runDir: string;
  targetCwd: string;
  baseCommit: string;
  branchName: string;
  worktreePath: string | null;
  taskContent: string;
  allowedFiles: string[];
  forbiddenFiles: string[];
  testCommands: string[];
  timeoutMs: number;
  testTimeoutMs: number;
  maxTestTailLines?: number;
  agent: AgentKind;
  agentCommand?: string;
  agentArgs?: string[];
  agentVersion: string | null;
  model?: string;
  permissionMode: AgentPermissionMode;
  allowUnsafe: boolean;
}

export interface RunReport {
  schemaVersion: 2;
  status: RunStatus;
  runId: string;
  agent: AgentKind;
  agentVersion: string | null;
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
  exitCode: number | null;
  backgroundPid: number | null;
  currentPhase?: string;
  error?: string;
  violatedFiles?: string[];
  outsideAllowedFiles?: string[];
  startedAt: string;
  updatedAt: string;
  finishedAt?: string;
  appliedAt?: string;
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function getRunConfigPath(runDir: string): string {
  return path.join(runDir, 'run.config.json');
}

export function getRunReportPath(runDir: string): string {
  return path.join(runDir, 'report.json');
}

export function createInitialRunReport(config: RunConfig): RunReport {
  const now = nowIso();
  return {
    schemaVersion: 2,
    status: 'queued',
    runId: config.runId,
    agent: config.agent ?? 'agy',
    agentVersion: config.agentVersion ?? null,
    branch: config.branchName,
    worktreePath: config.worktreePath,
    changedFiles: [],
    summary: 'Run queued. Poll get_agent_run_report for progress.',
    tests: [],
    riskNotes: [],
    reviewFocus: [],
    assumptions: [],
    rawReportPath: config.runDir,
    exitCode: null,
    backgroundPid: null,
    currentPhase: 'queued',
    startedAt: now,
    updatedAt: now,
  };
}

async function writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
  const suffix = `${process.pid}-${randomBytes(6).toString('hex')}`;
  const temporaryPath = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${suffix}.tmp`,
  );
  await fs.writeFile(temporaryPath, JSON.stringify(value, null, 2), {
    encoding: 'utf-8',
    mode: 0o600,
  });
  try {
    await fs.rename(temporaryPath, filePath);
  } catch (error: any) {
    if (process.platform === 'win32' && ['EEXIST', 'EPERM'].includes(error?.code)) {
      await fs.rm(filePath, { force: true });
      await fs.rename(temporaryPath, filePath);
      return;
    }
    await fs.rm(temporaryPath, { force: true });
    throw error;
  }
}

async function readJson<T>(filePath: string): Promise<T | null> {
  if (!existsSync(filePath)) return null;
  return JSON.parse(await fs.readFile(filePath, 'utf-8')) as T;
}

export async function writeRunConfig(runDir: string, config: RunConfig): Promise<void> {
  await writeJsonAtomic(getRunConfigPath(runDir), config);
}

export async function readRunConfig(runDir: string): Promise<RunConfig | null> {
  return readJson<RunConfig>(getRunConfigPath(runDir));
}

export async function writeRunReport(runDir: string, report: RunReport): Promise<void> {
  await writeJsonAtomic(getRunReportPath(runDir), report);
}

export async function readRunReport(runDir: string): Promise<RunReport | null> {
  return readJson<RunReport>(getRunReportPath(runDir));
}

export async function updateRunReport(
  runDir: string,
  patch: Partial<RunReport>,
): Promise<RunReport> {
  const current = await readRunReport(runDir);
  if (!current) throw new Error(`Run report not found for ${runDir}`);
  const nextReport: RunReport = {
    ...current,
    ...patch,
    updatedAt: patch.updatedAt ?? nowIso(),
  };
  await writeRunReport(runDir, nextReport);
  return nextReport;
}
