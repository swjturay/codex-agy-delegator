import * as fs from 'fs/promises';
import { createWriteStream, existsSync } from 'fs';
import * as path from 'path';
import { finished } from 'stream/promises';

import {
  buildAgentInvocation,
  normalizeAgentOutput,
} from './agentBackends.js';
import { parseCommandLine } from './commandLine.js';
import { getDiff, getDiffFiles, getDiffStat } from './git.js';
import { findFilesOutsideRules, findRuleViolations } from './pathRules.js';
import { parseAgentReport } from './report.js';
import {
  nowIso,
  readRunConfig,
  readRunReport,
  type RunReport,
  updateRunReport,
  writeRunReport,
} from './runArtifacts.js';
import { runCommand, tailString, waitForProcess } from './shell.js';

async function setRunPhase(
  runDir: string,
  phase: string,
  summary: string,
  patch: Partial<RunReport> = {},
) {
  const current = await readRunReport(runDir);
  if (!current || current.status === 'cancelled') return false;
  await updateRunReport(runDir, {
    status: 'running',
    currentPhase: phase,
    summary,
    ...patch,
  });
  return true;
}

async function finalizeRun(runDir: string, patch: Partial<RunReport>) {
  const current = await readRunReport(runDir);
  if (!current || current.status === 'cancelled') return;
  await writeRunReport(runDir, {
    ...current,
    ...patch,
    backgroundPid: null,
    finishedAt: patch.finishedAt ?? nowIso(),
    updatedAt: patch.updatedAt ?? nowIso(),
  });
  await fs.rm(path.join(runDir, 'runner.pid'), { force: true });
}

async function readText(filePath: string): Promise<string> {
  if (!existsSync(filePath)) return '';
  return fs.readFile(filePath, 'utf-8');
}

function extractReport(output: string) {
  const matches = [...output.matchAll(/```json\s*(\{[\s\S]*?\})\s*```/giu)];
  const lastMatch = matches.at(-1);
  return lastMatch ? parseAgentReport(lastMatch[1]) : null;
}

async function collectDiffArtifacts(
  runDir: string,
  targetCwd: string,
  baseCommit: string,
) {
  const changedFiles = await getDiffFiles(targetCwd, baseCommit);
  const diffStat = await getDiffStat(targetCwd, baseCommit);
  const patch = await getDiff(targetCwd, baseCommit);
  await Promise.all([
    fs.writeFile(path.join(runDir, 'diff.stat.txt'), diffStat, {
      encoding: 'utf-8',
      mode: 0o600,
    }),
    fs.writeFile(path.join(runDir, 'diff.patch'), patch, {
      encoding: 'utf-8',
      mode: 0o600,
    }),
  ]);
  return { changedFiles, diffStat };
}

export async function executeAgentRun(
  runDir: string,
  runnerPid: number | null = null,
) {
  const storedConfig = await readRunConfig(runDir);
  if (!storedConfig) throw new Error(`Run config not found for ${runDir}`);
  const config = {
    ...storedConfig,
    schemaVersion: 2 as const,
    baseCommit: storedConfig.baseCommit ?? 'HEAD',
    testTimeoutMs: storedConfig.testTimeoutMs ?? 300_000,
    agent: storedConfig.agent ?? 'agy',
    agentVersion: storedConfig.agentVersion ?? null,
    permissionMode: storedConfig.permissionMode ?? 'workspace-write',
    allowUnsafe: storedConfig.allowUnsafe ?? false,
  };

  const existing = await readRunReport(runDir);
  if (!existing || existing.status === 'cancelled') return;
  const backgroundPid = runnerPid
    ?? (process.argv.includes('--run-agent-task') ? process.pid : null);
  if (backgroundPid) {
    await fs.writeFile(path.join(runDir, 'runner.pid'), `${backgroundPid}\n`, {
      encoding: 'utf-8',
      mode: 0o600,
    });
  }
  await updateRunReport(runDir, {
    status: 'running',
    backgroundPid,
    currentPhase: 'starting',
    summary: `Starting ${config.agent} worker.`,
  });

  const stdoutPath = path.join(runDir, 'agent.stdout.log');
  const stderrPath = path.join(runDir, 'agent.stderr.log');
  const responsePath = path.join(runDir, 'agent.response.txt');

  try {
    if (!await setRunPhase(runDir, 'running-agent', `Running ${config.agent} worker.`)) {
      return;
    }
    const invocation = buildAgentInvocation(config, config.taskContent, config.targetCwd, responsePath);
    const stdoutStream = createWriteStream(stdoutPath, { flags: 'w', mode: 0o600 });
    const stderrStream = createWriteStream(stderrPath, { flags: 'w', mode: 0o600 });
    const agentResult = await waitForProcess(
      invocation.command,
      invocation.args,
      config.targetCwd,
      invocation.stdin,
      stdoutStream,
      stderrStream,
      config.timeoutMs,
    );
    await Promise.allSettled([finished(stdoutStream), finished(stderrStream)]);

    const rawStdout = await readText(stdoutPath);
    const rawStderr = await readText(stderrPath);
    const outputSource = config.agent === 'codex' && existsSync(responsePath)
      ? await readText(responsePath)
      : rawStdout;
    const response = normalizeAgentOutput(config.agent, outputSource);
    await fs.writeFile(responsePath, response, { encoding: 'utf-8', mode: 0o600 });

    if (!await setRunPhase(runDir, 'collecting-changes', 'Inspecting changed files.', {
      exitCode: agentResult.exitCode,
    })) {
      return;
    }
    const { changedFiles, diffStat } = await collectDiffArtifacts(
      runDir,
      config.targetCwd,
      config.baseCommit,
    );
    const violatedFiles = findRuleViolations(changedFiles, config.forbiddenFiles);
    const outsideAllowedFiles = findFilesOutsideRules(changedFiles, config.allowedFiles);
    if (violatedFiles.length > 0 || outsideAllowedFiles.length > 0) {
      await finalizeRun(runDir, {
        status: 'blocked',
        currentPhase: 'blocked',
        summary: violatedFiles.length
          ? 'Agent modified forbidden files.'
          : 'Agent modified files outside the allowed scope.',
        error: violatedFiles.length
          ? 'Agent modified forbidden files'
          : 'Agent modified files outside allowed files',
        changedFiles,
        diffStat,
        violatedFiles,
        outsideAllowedFiles,
        exitCode: agentResult.exitCode,
      });
      return;
    }

    if (!await setRunPhase(runDir, 'running-tests', 'Running verification commands.')) {
      return;
    }
    const testCommands = [...config.testCommands];
    if (testCommands.length === 0 && existsSync(path.join(config.targetCwd, 'package.json'))) {
      const packageJson = JSON.parse(
        await fs.readFile(path.join(config.targetCwd, 'package.json'), 'utf-8'),
      );
      if (packageJson.scripts?.typecheck) testCommands.push('npm run typecheck');
      if (packageJson.scripts?.test) testCommands.push('npm test');
    }

    const tests = [];
    for (const commandLine of testCommands) {
      const [command, ...commandArgs] = parseCommandLine(commandLine);
      const result = await runCommand(
        command,
        commandArgs,
        config.targetCwd,
        config.testTimeoutMs,
      );
      const tailLines = config.maxTestTailLines ?? (result.exitCode === 0 ? 0 : 20);
      tests.push({
        command: commandLine,
        exitCode: result.exitCode,
        timedOut: result.timedOut,
        stdoutTail: tailLines > 0 ? tailString(result.stdout, tailLines) : '',
        stderrTail: tailLines > 0 ? tailString(result.stderr, tailLines) : '',
      });
    }

    if (!await setRunPhase(runDir, 'building-report', 'Building the final run report.')) {
      return;
    }
    const parsedReport = extractReport(response);
    const failedTests = tests.some((test) => test.exitCode !== 0 || test.timedOut);
    const agentFailed = agentResult.exitCode !== 0 || agentResult.timedOut;
    let error: string | undefined;
    if (agentResult.timedOut) {
      error = `${config.agent} timed out after ${config.timeoutMs}ms.`;
    } else if (agentResult.exitCode !== 0) {
      error = `${config.agent} exited with code ${agentResult.exitCode}. ${tailString(rawStderr || rawStdout, 20)}`.trim();
    } else if (!parsedReport) {
      error = `${config.agent} did not emit the expected JSON report.`;
    }

    const fallbackSummary = `Changed ${changedFiles.length} file(s).`;
    await finalizeRun(runDir, {
      status: agentFailed || failedTests || !parsedReport ? 'needs_review' : 'success',
      currentPhase: 'completed',
      changedFiles,
      diffStat,
      diffSummary: parsedReport?.implementation_summary || fallbackSummary,
      summary: parsedReport?.summary
        || parsedReport?.implementation_summary
        || error
        || fallbackSummary,
      tests,
      riskNotes: parsedReport?.risk_notes ?? [],
      reviewFocus: parsedReport?.review_focus ?? [],
      assumptions: parsedReport?.assumptions ?? [],
      exitCode: agentResult.exitCode,
      error,
    });
  } catch (error: any) {
    await finalizeRun(runDir, {
      status: 'failed',
      currentPhase: 'failed',
      summary: error?.message ?? 'Agent run failed.',
      error: error?.message ?? 'Agent run failed.',
      exitCode: null,
    });
  }
}
