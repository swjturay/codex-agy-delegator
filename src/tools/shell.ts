import { execFile, spawn } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

export async function runCommand(command: string, args: string[], cwd: string, timeoutMs?: number) {
  try {
    const { stdout, stderr } = await execFileAsync(command, args, { cwd, timeout: timeoutMs });
    return { exitCode: 0, stdout, stderr };
  } catch (error: any) {
    return {
      exitCode: error.code ?? 1,
      stdout: error.stdout ?? '',
      stderr: error.stderr ?? error.message ?? '',
    };
  }
}

export function tailString(str: string, maxLines: number = 50): string {
  const lines = str.split('\n');
  if (lines.length <= maxLines) return str;
  return `... (${lines.length - maxLines} lines omitted) ...\n` + lines.slice(-maxLines).join('\n');
}
