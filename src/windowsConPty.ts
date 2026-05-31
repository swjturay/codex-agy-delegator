import * as fs from 'fs/promises';
import * as path from 'path';

import { runCommand } from './shell.js';

export interface WindowsConPtyRunResult {
  code: number | null;
  timedOut: boolean;
  rawOutput: string;
  output: string;
  helperStderr: string;
}

interface WindowsConPtyPayload {
  exitCode: number;
  timedOut: boolean;
  outputBase64: string;
}

const POWERSHELL_HELPER = String.raw`param(
  [Parameter(Mandatory = $true)][string]$Executable,
  [Parameter(Mandatory = $true)][string]$Arguments,
  [Parameter(Mandatory = $true)][string]$WorkingDirectory,
  [Parameter(Mandatory = $true)][int]$TimeoutMs
)

$ErrorActionPreference = 'Stop'

try {
  $resolvedExecutable = (Get-Command $Executable -CommandType Application -ErrorAction Stop).Source
} catch {
  $resolvedExecutable = $Executable
}

$code = @'
using System;
using System.IO;
using System.Text;
using System.Threading.Tasks;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;

public sealed class ConPtyResult
{
    public int ExitCode;
    public bool TimedOut;
    public string Output = string.Empty;
}

public static class ConPtyRunner
{
    const int PROC_THREAD_ATTRIBUTE_PSEUDOCONSOLE = 0x00020016;
    const uint EXTENDED_STARTUPINFO_PRESENT = 0x00080000;
    const uint CREATE_UNICODE_ENVIRONMENT = 0x00000400;
    const uint WAIT_TIMEOUT = 0x00000102;

    [StructLayout(LayoutKind.Sequential)]
    struct COORD
    {
        public short X;
        public short Y;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct SECURITY_ATTRIBUTES
    {
        public int nLength;
        public IntPtr lpSecurityDescriptor;
        [MarshalAs(UnmanagedType.Bool)]
        public bool bInheritHandle;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    struct STARTUPINFOEX
    {
        public STARTUPINFO StartupInfo;
        public IntPtr lpAttributeList;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    struct STARTUPINFO
    {
        public int cb;
        public string lpReserved;
        public string lpDesktop;
        public string lpTitle;
        public int dwX;
        public int dwY;
        public int dwXSize;
        public int dwYSize;
        public int dwXCountChars;
        public int dwYCountChars;
        public int dwFillAttribute;
        public int dwFlags;
        public short wShowWindow;
        public short cbReserved2;
        public IntPtr lpReserved2;
        public IntPtr hStdInput;
        public IntPtr hStdOutput;
        public IntPtr hStdError;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct PROCESS_INFORMATION
    {
        public IntPtr hProcess;
        public IntPtr hThread;
        public int dwProcessId;
        public int dwThreadId;
    }

    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool CreatePipe(out IntPtr hReadPipe, out IntPtr hWritePipe, ref SECURITY_ATTRIBUTES lpPipeAttributes, int nSize);

    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool CloseHandle(IntPtr hObject);

    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    static extern bool CreateProcessW(
        string lpApplicationName,
        StringBuilder lpCommandLine,
        IntPtr lpProcessAttributes,
        IntPtr lpThreadAttributes,
        bool bInheritHandles,
        uint dwCreationFlags,
        IntPtr lpEnvironment,
        string lpCurrentDirectory,
        ref STARTUPINFOEX lpStartupInfo,
        out PROCESS_INFORMATION lpProcessInformation);

    [DllImport("kernel32.dll", SetLastError = true)]
    static extern IntPtr InitializeProcThreadAttributeList(IntPtr lpAttributeList, int dwAttributeCount, int dwFlags, ref IntPtr lpSize);

    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool UpdateProcThreadAttribute(
        IntPtr lpAttributeList,
        uint dwFlags,
        IntPtr attribute,
        IntPtr lpValue,
        IntPtr cbSize,
        IntPtr lpPreviousValue,
        IntPtr lpReturnSize);

    [DllImport("kernel32.dll", SetLastError = true)]
    static extern void DeleteProcThreadAttributeList(IntPtr lpAttributeList);

    [DllImport("kernel32.dll", SetLastError = true)]
    static extern int CreatePseudoConsole(COORD size, IntPtr hInput, IntPtr hOutput, uint dwFlags, out IntPtr phPC);

    [DllImport("kernel32.dll", SetLastError = false)]
    static extern void ClosePseudoConsole(IntPtr hPC);

    [DllImport("kernel32.dll", SetLastError = true)]
    static extern uint WaitForSingleObject(IntPtr hHandle, uint dwMilliseconds);

    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool TerminateProcess(IntPtr hProcess, uint uExitCode);

    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool GetExitCodeProcess(IntPtr hProcess, out uint lpExitCode);

    static void ThrowLast(string message)
    {
        int last = Marshal.GetLastWin32Error();
        throw new System.ComponentModel.Win32Exception(last, message + " last=" + last);
    }

    public static ConPtyResult Run(string app, string args, string cwd, int timeoutMs)
    {
        SECURITY_ATTRIBUTES sa = new SECURITY_ATTRIBUTES();
        sa.nLength = Marshal.SizeOf(typeof(SECURITY_ATTRIBUTES));
        sa.bInheritHandle = true;

        IntPtr inputRead = IntPtr.Zero;
        IntPtr inputWrite = IntPtr.Zero;
        IntPtr outputRead = IntPtr.Zero;
        IntPtr outputWrite = IntPtr.Zero;
        IntPtr hPC = IntPtr.Zero;
        IntPtr attrList = IntPtr.Zero;
        PROCESS_INFORMATION pi = new PROCESS_INFORMATION();

        try
        {
            if (!CreatePipe(out inputRead, out inputWrite, ref sa, 0)) ThrowLast("CreatePipe input failed");
            if (!CreatePipe(out outputRead, out outputWrite, ref sa, 0)) ThrowLast("CreatePipe output failed");

            int hr = CreatePseudoConsole(new COORD { X = 120, Y = 40 }, inputRead, outputWrite, 0, out hPC);
            if (hr != 0) Marshal.ThrowExceptionForHR(hr);

            CloseHandle(inputRead);
            inputRead = IntPtr.Zero;
            CloseHandle(outputWrite);
            outputWrite = IntPtr.Zero;

            IntPtr attrSize = IntPtr.Zero;
            InitializeProcThreadAttributeList(IntPtr.Zero, 1, 0, ref attrSize);
            attrList = Marshal.AllocHGlobal(attrSize);
            if (InitializeProcThreadAttributeList(attrList, 1, 0, ref attrSize) == IntPtr.Zero)
            {
                ThrowLast("InitializeProcThreadAttributeList failed");
            }

            if (!UpdateProcThreadAttribute(attrList, 0, (IntPtr)PROC_THREAD_ATTRIBUTE_PSEUDOCONSOLE, hPC, (IntPtr)IntPtr.Size, IntPtr.Zero, IntPtr.Zero))
            {
                ThrowLast("UpdateProcThreadAttribute failed");
            }

            STARTUPINFOEX siEx = new STARTUPINFOEX();
            siEx.StartupInfo.cb = Marshal.SizeOf(typeof(STARTUPINFOEX));
            siEx.lpAttributeList = attrList;

            StringBuilder commandLine = new StringBuilder("\"" + app + "\" " + args);
            if (!CreateProcessW(app, commandLine, IntPtr.Zero, IntPtr.Zero, true, EXTENDED_STARTUPINFO_PRESENT | CREATE_UNICODE_ENVIRONMENT, IntPtr.Zero, cwd, ref siEx, out pi))
            {
                ThrowLast("CreateProcessW failed");
            }

            if (pi.hThread != IntPtr.Zero)
            {
                CloseHandle(pi.hThread);
                pi.hThread = IntPtr.Zero;
            }

            if (inputWrite != IntPtr.Zero)
            {
                CloseHandle(inputWrite);
                inputWrite = IntPtr.Zero;
            }

            SafeFileHandle safeOutput = new SafeFileHandle(outputRead, false);
            FileStream stream = new FileStream(safeOutput, FileAccess.Read, 4096, false);
            StreamReader reader = new StreamReader(stream, Encoding.UTF8);
            Task<string> readTask = reader.ReadToEndAsync();

            bool timedOut = WaitForSingleObject(pi.hProcess, (uint)timeoutMs) == WAIT_TIMEOUT;
            if (timedOut)
            {
                TerminateProcess(pi.hProcess, 124);
            }

            if (hPC != IntPtr.Zero)
            {
                ClosePseudoConsole(hPC);
                hPC = IntPtr.Zero;
            }

            try
            {
                readTask.Wait(Math.Min(timeoutMs, 5000));
            }
            catch
            {
            }

            uint exitCode = 0;
            GetExitCodeProcess(pi.hProcess, out exitCode);
            string output = readTask.IsCompleted ? readTask.Result : string.Empty;

            reader.Dispose();
            stream.Dispose();

            return new ConPtyResult
            {
                ExitCode = (int)exitCode,
                TimedOut = timedOut,
                Output = output
            };
        }
        finally
        {
            if (pi.hProcess != IntPtr.Zero) CloseHandle(pi.hProcess);
            if (pi.hThread != IntPtr.Zero) CloseHandle(pi.hThread);
            if (inputRead != IntPtr.Zero) CloseHandle(inputRead);
            if (inputWrite != IntPtr.Zero) CloseHandle(inputWrite);
            if (outputRead != IntPtr.Zero) CloseHandle(outputRead);
            if (outputWrite != IntPtr.Zero) CloseHandle(outputWrite);
            if (attrList != IntPtr.Zero)
            {
                DeleteProcThreadAttributeList(attrList);
                Marshal.FreeHGlobal(attrList);
            }
            if (hPC != IntPtr.Zero) ClosePseudoConsole(hPC);
        }
    }
}
'@

Add-Type -TypeDefinition $code -Language CSharp

$result = [ConPtyRunner]::Run($resolvedExecutable, $Arguments, $WorkingDirectory, $TimeoutMs)
[pscustomobject]@{
  exitCode = $result.ExitCode
  timedOut = $result.TimedOut
  outputBase64 = [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($result.Output))
} | ConvertTo-Json -Compress
`;

export function stripTerminalControlSequences(text: string): string {
  return text
    .replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, '')
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/\x1b[@-Z\\-_]/g, '')
    .replace(/\r/g, '');
}

export function quoteWindowsCommandArg(arg: string): string {
  if (arg.length === 0) return '""';
  if (!/[ \t"]/u.test(arg)) return arg;

  let quoted = '"';
  let backslashes = 0;

  for (const ch of arg) {
    if (ch === '\\') {
      backslashes += 1;
      continue;
    }

    if (ch === '"') {
      quoted += '\\'.repeat(backslashes * 2 + 1);
      quoted += '"';
      backslashes = 0;
      continue;
    }

    if (backslashes > 0) {
      quoted += '\\'.repeat(backslashes);
      backslashes = 0;
    }

    quoted += ch;
  }

  if (backslashes > 0) {
    quoted += '\\'.repeat(backslashes * 2);
  }

  quoted += '"';
  return quoted;
}

function buildWindowsArgumentString(args: string[]) {
  return args.map(quoteWindowsCommandArg).join(' ');
}

async function writeHelperScript(runDir: string) {
  const scriptPath = path.join(runDir, 'run-conpty-helper.ps1');
  await fs.writeFile(scriptPath, POWERSHELL_HELPER, 'utf-8');
  return scriptPath;
}

export async function runWithWindowsConPty(
  runDir: string,
  cwd: string,
  executable: string,
  args: string[],
  timeoutMs: number,
): Promise<WindowsConPtyRunResult> {
  const scriptPath = await writeHelperScript(runDir);
  const helperArgs = [
    '-NoLogo',
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    scriptPath,
    '-Executable',
    executable,
    '-Arguments',
    buildWindowsArgumentString(args),
    '-WorkingDirectory',
    cwd,
    '-TimeoutMs',
    String(timeoutMs),
  ];
  const helperResult = await runCommand('powershell', helperArgs, cwd, timeoutMs + 30_000);

  if (helperResult.exitCode !== 0) {
    throw new Error((helperResult.stderr || helperResult.stdout || 'Windows ConPTY helper failed.').trim());
  }

  let payload: WindowsConPtyPayload;
  try {
    payload = JSON.parse(helperResult.stdout.trim()) as WindowsConPtyPayload;
  } catch (error: any) {
    throw new Error(`Windows ConPTY helper returned invalid JSON: ${error?.message || 'unknown parse error'}`);
  }

  const rawOutput = Buffer.from(payload.outputBase64 || '', 'base64').toString('utf-8');
  return {
    code: payload.exitCode,
    timedOut: payload.timedOut,
    rawOutput,
    output: stripTerminalControlSequences(rawOutput),
    helperStderr: helperResult.stderr,
  };
}
