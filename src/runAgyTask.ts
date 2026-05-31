import * as fs from 'fs/promises';
import * as path from 'path';
import { spawn } from 'child_process';
import { createWriteStream, existsSync } from 'fs';
import { finished } from 'stream/promises';

import { getDiff, getDiffFiles, getDiffStat } from './git.js';
import { findFilesOutsideRules, findRuleViolations } from './pathRules.js';
import { parseAgyReport } from './report.js';
import { runCommand, tailString } from './shell.js';
import { nowIso, readRunConfig, readRunReport, type RunConfig, type RunReport, updateRunReport, writeRunReport } from './runArtifacts.js';
import { runWithWindowsConPty } from './windowsConPty.js';

interface AgyProcessResult {
  code: number | null;
  timedOut: boolean;
}

async function setRunPhase(runDir: string, phase: string, summary: string, patch: Partial<RunReport> = {}) {
  try {
    await updateRunReport(runDir, {
      status: 'running',
      currentPhase: phase,
      summary,
      ...patch,
      updatedAt: nowIso(),
    });
  } catch {
    // Cleanup may remove the run directory while the background worker is still exiting.
  }
}

async function finalizeRun(runDir: string, patch: Partial<RunReport>) {
  const current = await readRunReport(runDir);
  if (!current) return;

  await writeRunReport(runDir, {
    ...current,
    ...patch,
    backgroundPid: null,
    finishedAt: patch.finishedAt ?? nowIso(),
    updatedAt: patch.updatedAt ?? nowIso(),
  });
}

async function runAgyWorker(config: RunConfig) {
  const agyLogPath = path.join(config.runDir, 'agy.stdout.log');
  const agyErrPath = path.join(config.runDir, 'agy.stderr.log');
  const agyInternalLogPath = path.join(config.runDir, 'agy.internal.log');
  const agyRawOutputPath = path.join(config.runDir, 'agy.pty.log');
  const printTimeout = `${Math.max(1, Math.ceil(config.timeoutMs / 1000))}s`;

  if (process.platform === 'win32') {
    const result = await runWithWindowsConPty(
      config.runDir,
      config.targetCwd,
      'agy',
      [
        '--dangerously-skip-permissions',
        '--log-file',
        agyInternalLogPath,
        '--print-timeout',
        printTimeout,
        '--print',
        config.taskContent,
      ],
      config.timeoutMs,
    );
    await fs.writeFile(agyRawOutputPath, result.rawOutput, 'utf-8');
    await fs.writeFile(agyLogPath, result.output, 'utf-8');
    await fs.writeFile(agyErrPath, result.helperStderr, 'utf-8');
    return { code: result.code, timedOut: result.timedOut };
  }

  return new Promise<AgyProcessResult>((resolve, reject) => {
    let timedOut = false;
    const proc = spawn(
      'agy',
      [
        '--dangerously-skip-permissions',
        '--log-file',
        agyInternalLogPath,
        '--print-timeout',
        printTimeout,
        '--print',
        config.taskContent,
      ],
      {
        cwd: config.targetCwd,
        shell: false,
        windowsHide: true,
      },
    );
    const outStream = createWriteStream(agyLogPath);
    const errStream = createWriteStream(agyErrPath);

    proc.on('error', reject);
    proc.stdout.pipe(outStream);
    proc.stderr.pipe(errStream);

    const timer = setTimeout(() => {
      timedOut = true;
      proc.kill('SIGKILL');
    }, config.timeoutMs);

    proc.on('close', async (code) => {
      clearTimeout(timer);
      await Promise.allSettled([finished(outStream), finished(errStream)]);
      resolve({ code, timedOut });
    });
  });
}

async function readTailIfExists(filePath: string, lines: number) {
  if (!existsSync(filePath)) return '';
  return tailString(await fs.readFile(filePath, 'utf-8'), lines);
}

async function detectAgyFailureReason(config: RunConfig, agyResult: AgyProcessResult, parsedReport: ReturnType<typeof parseAgyReport>) {
  if (parsedReport) return null;

  const stdoutText = existsSync(path.join(config.runDir, 'agy.stdout.log'))
    ? await fs.readFile(path.join(config.runDir, 'agy.stdout.log'), 'utf-8')
    : '';
  const stderrText = existsSync(path.join(config.runDir, 'agy.stderr.log'))
    ? await fs.readFile(path.join(config.runDir, 'agy.stderr.log'), 'utf-8')
    : '';
  const internalLogTail = await readTailIfExists(path.join(config.runDir, 'agy.internal.log'), 40);
  const combined = `${stdoutText}\n${stderrText}\n${internalLogTail}`;

  if (agyResult.timedOut) {
    return `agy timed out after ${config.timeoutMs}ms.`;
  }

  if (/You are not logged into Antigravity/i.test(combined)) {
    return 'agy is not authenticated in this environment.';
  }

  if (/Authentication required\. Please visit the URL to log in:/i.test(combined)) {
    return 'agy requested interactive authentication in the Windows pseudo terminal. Run agy once interactively on this machine and complete login, then retry.';
  }

  if (/neither PlanModel nor RequestedModel specified/i.test(combined)) {
    return 'agy started before its selected model was available. Open agy interactively and confirm a default model is saved.';
  }

  if (agyResult.code === 0 && !stdoutText.trim() && !stderrText.trim()) {
    return 'agy completed without emitting stdout/stderr. This Windows environment is not exposing print-mode output to the delegator.';
  }

  if (agyResult.code !== 0) {
    return `agy exited with code ${agyResult.code}. ${internalLogTail || stderrText || stdoutText}`.trim();
  }

  return 'agy did not emit the expected JSON report.';
}

export async function executeAgyRun(runDir: string) {
  const config = await readRunConfig(runDir);
  if (!config) {
    throw new Error(`Run config not found for ${runDir}`);
  }

  const existing = await readRunReport(runDir);
  if (existing?.status === 'cancelled') {
    return;
  }

  await setRunPhase(runDir, 'checking-agy', 'Checking agy availability.');
  const { exitCode: agyCheck } = await runCommand('agy', ['--version'], config.targetCwd);
  if (agyCheck !== 0) {
    await finalizeRun(runDir, {
      status: 'failed',
      currentPhase: 'failed',
      summary: 'Antigravity CLI (agy) not found in PATH.',
      error: 'Antigravity CLI (agy) not found in PATH. Please install it.',
      agyExitCode: null,
    });
    return;
  }

  try {
    await setRunPhase(runDir, 'running-agy', 'Running agy worker.');
    const agyResult = await runAgyWorker(config);

    await setRunPhase(runDir, 'collecting-changes', 'Inspecting changed files.', {
      agyExitCode: agyResult.code,
    });

    const changedFiles = await getDiffFiles(config.targetCwd);
    const violatedFiles = findRuleViolations(changedFiles, config.forbiddenFiles, true);
    const outsideAllowedFiles = findFilesOutsideRules(changedFiles, config.allowedFiles);

    if (violatedFiles.length > 0 || outsideAllowedFiles.length > 0) {
      await finalizeRun(runDir, {
        status: 'blocked',
        currentPhase: 'blocked',
        error: violatedFiles.length > 0
          ? 'Worker modified forbidden files'
          : 'Worker modified files outside allowed files',
        summary: violatedFiles.length > 0
          ? 'Worker modified forbidden files.'
          : 'Worker modified files outside allowed files.',
        violatedFiles,
        outsideAllowedFiles,
        changedFiles,
        agyExitCode: agyResult.code,
      });
      return;
    }

    await setRunPhase(runDir, 'running-tests', 'Running verification commands.');
    const tests = [];
    let testsFailed = false;
    let testsToRun = [...config.testCommands];

    if (testsToRun.length === 0 && existsSync(path.join(config.targetCwd, 'package.json'))) {
      const pkg = JSON.parse(await fs.readFile(path.join(config.targetCwd, 'package.json'), 'utf-8'));
      if (pkg.scripts?.typecheck) testsToRun.push('npm run typecheck');
      if (pkg.scripts?.test) testsToRun.push('npm test');
    }

    for (const cmd of testsToRun) {
      const parts = cmd.split(' ');
      const { exitCode, stdout, stderr } = await runCommand(parts[0], parts.slice(1), config.targetCwd);
      const tailLines = config.maxTestTailLines ?? (exitCode === 0 ? 0 : 10);
      tests.push({
        command: cmd,
        exitCode,
        stdoutTail: tailLines > 0 ? tailString(stdout, tailLines) : '',
        stderrTail: tailLines > 0 ? tailString(stderr, tailLines) : '',
      });
      if (exitCode !== 0) testsFailed = true;
    }

    await setRunPhase(runDir, 'building-report', 'Collecting diff and worker report.');
    const diffStat = await getDiffStat(config.targetCwd);
    const diffSummary = `Changed files: ${changedFiles.length}\nStat:\n${diffStat}`;
    await fs.writeFile(path.join(config.runDir, 'diff.stat.txt'), diffStat, 'utf-8');
    await fs.writeFile(path.join(config.runDir, 'diff.patch'), await getDiff(config.targetCwd), 'utf-8');

    const agyOutput = await fs.readFile(path.join(config.runDir, 'agy.stdout.log'), 'utf-8');
    const jsonMatch = agyOutput.match(/\`\`\`json\s*(\{[\s\S]*?\})\s*\`\`\`/);
    const parsedReport = jsonMatch ? parseAgyReport(jsonMatch[1]) : null;
    const agyFailureReason = await detectAgyFailureReason(config, agyResult, parsedReport);

    await finalizeRun(runDir, {
      status: testsFailed || agyResult.code !== 0 || !parsedReport ? 'needs_review' : 'success',
      currentPhase: 'completed',
      changedFiles,
      diffStat,
      diffSummary: parsedReport?.implementation_summary || diffSummary,
      summary: parsedReport?.summary || parsedReport?.implementation_summary || agyFailureReason || diffSummary,
      tests,
      riskNotes: parsedReport?.risk_notes || [],
      reviewFocus: parsedReport?.review_focus || [],
      assumptions: parsedReport?.assumptions || [],
      agyExitCode: agyResult.code,
      error: agyFailureReason ?? undefined,
    });
  } catch (error: any) {
    await finalizeRun(runDir, {
      status: 'failed',
      currentPhase: 'failed',
      summary: error?.message || 'Background run failed.',
      error: error?.message || 'Background run failed.',
      agyExitCode: null,
    });
  }
}
