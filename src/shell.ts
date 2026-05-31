import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

export async function runCommand(command: string, args: string[], cwd: string, timeoutMs?: number) {
  try {
    const { stdout, stderr } = await execFileAsync(command, args, {
      cwd,
      timeout: timeoutMs,
      windowsHide: true,
    });
    return { exitCode: 0, stdout, stderr };
  } catch (error: any) {
    return {
      exitCode: error.code ?? 1,
      stdout: error.stdout ?? '',
      stderr: error.stderr ?? error.message ?? '',
    };
  }
}

export async function killProcessTree(pid: number) {
  if (!Number.isInteger(pid) || pid <= 0) return;

  if (process.platform === 'win32') {
    const { exitCode, stdout, stderr } = await runCommand('taskkill', ['/PID', String(pid), '/T', '/F'], process.cwd());
    const details = `${stdout}\n${stderr}`.toLowerCase();
    if (exitCode !== 0 && !details.includes('not found') && !details.includes('no running instance')) {
      throw new Error(`Failed to kill process tree ${pid}: ${stderr || stdout}`.trim());
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
      if (innerError?.code !== 'ESRCH') {
        throw innerError;
      }
    }
  }
}

export function tailString(str: string, maxLines: number = 50): string {
  const lines = str.split('\n');
  if (lines.length <= maxLines) return str;
  return `... (${lines.length - maxLines} lines omitted) ...\n` + lines.slice(-maxLines).join('\n');
}
