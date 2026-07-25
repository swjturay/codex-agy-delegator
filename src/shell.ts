import { execFile, spawn } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

export interface CommandResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

export async function runCommand(
  command: string,
  args: string[],
  cwd: string,
  timeoutMs?: number,
): Promise<CommandResult> {
  try {
    const { stdout, stderr } = await execFileAsync(command, args, {
      cwd,
      timeout: timeoutMs,
      windowsHide: true,
      maxBuffer: 20 * 1024 * 1024,
    });
    return {
      exitCode: 0,
      stdout,
      stderr,
      timedOut: false,
    };
  } catch (error: any) {
    const timedOut = Boolean(error?.killed)
      || error?.code === 'ETIMEDOUT'
      || error?.signal === 'SIGTERM';
    const numericCode = typeof error?.code === 'number' ? error.code : null;
    return {
      exitCode: timedOut ? 124 : numericCode ?? 1,
      stdout: error?.stdout?.toString?.() ?? '',
      stderr: error?.stderr?.toString?.() ?? error?.message ?? '',
      timedOut,
    };
  }
}

export async function killProcessTree(pid: number): Promise<void> {
  if (!Number.isInteger(pid) || pid <= 0) return;

  if (process.platform === 'win32') {
    const result = await runCommand(
      'taskkill',
      ['/PID', String(pid), '/T', '/F'],
      process.cwd(),
      15_000,
    );
    const details = `${result.stdout}\n${result.stderr}`.toLowerCase();
    if (
      result.exitCode !== 0
      && !details.includes('not found')
      && !details.includes('no running instance')
    ) {
      throw new Error(`Failed to kill process tree ${pid}: ${result.stderr || result.stdout}`.trim());
    }
    return;
  }

  try {
    process.kill(-pid, 'SIGKILL');
  } catch (error: any) {
    if (error?.code === 'ESRCH') return;
    try {
      process.kill(pid, 'SIGKILL');
    } catch (innerError: any) {
      if (innerError?.code !== 'ESRCH') throw innerError;
    }
  }
}

export function tailString(value: string, maxLines = 50): string {
  const lines = value.split('\n');
  if (lines.length <= maxLines) return value;
  return `... (${lines.length - maxLines} lines omitted) ...\n${lines.slice(-maxLines).join('\n')}`;
}

export function waitForProcess(
  command: string,
  args: string[],
  cwd: string,
  stdin: string | null,
  stdoutStream: NodeJS.WritableStream,
  stderrStream: NodeJS.WritableStream,
  timeoutMs: number,
): Promise<{ exitCode: number | null; timedOut: boolean }> {
  return new Promise((resolve, reject) => {
    let timedOut = false;
    const child = spawn(command, args, {
      cwd,
      detached: true,
      shell: false,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: process.env,
    });

    child.once('error', reject);
    child.stdout.pipe(stdoutStream);
    child.stderr.pipe(stderrStream);

    if (stdin !== null) child.stdin.end(stdin);
    else child.stdin.end();

    const timer = setTimeout(() => {
      timedOut = true;
      if (child.pid) void killProcessTree(child.pid);
    }, timeoutMs);

    child.once('close', (exitCode) => {
      clearTimeout(timer);
      resolve({ exitCode, timedOut });
    });
  });
}
