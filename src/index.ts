import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';

import { listAgentBackends } from './agentBackends.js';
import { applyAgentRun, type ApplyAgentRunArgs } from './applyAgentRun.js';
import { cleanupAgentRun } from './cleanupAgentRun.js';
import { cleanupAgyRun } from './cleanupAgyRun.js';
import {
  delegateToAgent,
  type DelegateAgentArgs,
} from './delegateToAgent.js';
import { delegateToAgy, type DelegateArgs } from './delegateToAgy.js';
import { getAgentRunReport } from './getAgentRunReport.js';
import { getAgyRunReport } from './getAgyRunReport.js';
import { executeAgentRun } from './runAgentTask.js';

const server = new Server(
  {
    name: 'codex-agent-delegator',
    version: '0.2.0',
  },
  { capabilities: { tools: {} } },
);

const commonDelegateProperties = {
  repoPath: { type: 'string', description: 'Absolute path to the target git repository.' },
  task: { type: 'string', description: 'Task instruction for the delegated agent.' },
  allowedFiles: {
    type: 'array',
    items: { type: 'string' },
    description: 'Optional allowed file paths or globs.',
  },
  forbiddenFiles: {
    type: 'array',
    items: { type: 'string' },
    description: 'Optional forbidden file paths or globs.',
  },
  testCommands: {
    type: 'array',
    items: { type: 'string' },
    description: 'Verification commands executed without a shell.',
  },
  timeoutMs: { type: 'number', description: 'Agent timeout in milliseconds.' },
  testTimeoutMs: { type: 'number', description: 'Timeout per test command in milliseconds.' },
  useWorktree: {
    type: 'boolean',
    description: 'Use an isolated git worktree. Defaults to true.',
  },
  branchPrefix: { type: 'string', description: 'Prefix for the temporary branch.' },
  dryRun: {
    type: 'boolean',
    description: 'Validate and show the invocation without creating artifacts.',
  },
  responseMode: {
    type: 'string',
    enum: ['compact', 'standard', 'full'],
    description: 'Response detail. Defaults to compact.',
  },
  maxFiles: { type: 'number', description: 'Maximum files in compact responses.' },
  maxTestTailLines: {
    type: 'number',
    description: 'Maximum test output tail lines retained.',
  },
  includeDiffStat: {
    type: 'boolean',
    description: 'Include a capped diff stat in compact responses.',
  },
  waitForCompletion: {
    type: 'boolean',
    description: 'Wait for completion instead of returning a background run ID.',
  },
} as const;

const reportProperties = {
  repoPath: { type: 'string', description: 'Absolute path to the repository.' },
  runId: { type: 'string', description: 'Delegated run ID.' },
  detail: {
    type: 'string',
    enum: ['compact', 'full', 'logs', 'diffStat', 'patch'],
    description: 'Report detail. Defaults to compact.',
  },
  maxBytes: {
    type: 'number',
    description: 'Maximum bytes for logs, diff stat, or patch.',
  },
} as const;

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'delegate_to_agent',
      description: 'Delegate a coding task to agy, Codex, Claude, or an explicit custom executable.',
      inputSchema: {
        type: 'object',
        properties: {
          ...commonDelegateProperties,
          agent: {
            type: 'string',
            enum: ['agy', 'codex', 'claude', 'custom'],
            description: 'Agent backend.',
          },
          agentCommand: {
            type: 'string',
            description: 'Executable for a custom agent.',
          },
          agentArgs: {
            type: 'array',
            items: { type: 'string' },
            description: 'Custom executable args; supports {{prompt}}, {{cwd}}, and {{responsePath}}.',
          },
          model: { type: 'string', description: 'Optional backend model override.' },
          permissionMode: {
            type: 'string',
            enum: ['read-only', 'workspace-write', 'full-access'],
            description: 'Backend permission mode. Defaults to workspace-write.',
          },
          allowUnsafe: {
            type: 'boolean',
            description: 'Required for full-access and custom backends.',
          },
        },
        required: ['repoPath', 'task', 'agent'],
      },
      annotations: {
        title: 'Delegate to coding agent',
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    {
      name: 'get_agent_run_report',
      description: 'Read progress, logs, diff summary, or patch for a delegated run.',
      inputSchema: {
        type: 'object',
        properties: reportProperties,
        required: ['repoPath', 'runId'],
      },
      annotations: {
        title: 'Get agent run report',
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    {
      name: 'apply_agent_run',
      description: 'Apply a reviewed delegated patch to a clean target repository.',
      inputSchema: {
        type: 'object',
        properties: {
          repoPath: { type: 'string', description: 'Absolute path to the repository.' },
          runId: { type: 'string', description: 'Delegated run ID.' },
          confirm: {
            type: 'boolean',
            description: 'Must be true to apply the patch.',
          },
          allowNeedsReview: {
            type: 'boolean',
            description: 'Explicitly allow applying a needs_review run. Blocked runs are never allowed.',
          },
        },
        required: ['repoPath', 'runId', 'confirm'],
      },
      annotations: {
        title: 'Apply agent run',
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    {
      name: 'cleanup_agent_run',
      description: 'Cancel a delegated run and safely remove its managed artifacts.',
      inputSchema: {
        type: 'object',
        properties: {
          repoPath: { type: 'string', description: 'Absolute path to the repository.' },
          runId: { type: 'string', description: 'Delegated run ID.' },
          removeWorktree: {
            type: 'boolean',
            description: 'Also remove the managed git worktree.',
          },
        },
        required: ['repoPath', 'runId'],
      },
      annotations: {
        title: 'Clean up agent run',
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    {
      name: 'list_agent_backends',
      description: 'Check which built-in agent CLIs are installed and compatible.',
      inputSchema: {
        type: 'object',
        properties: {
          repoPath: {
            type: 'string',
            description: 'Directory used while probing. Defaults to the server working directory.',
          },
        },
      },
      annotations: {
        title: 'List agent backends',
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    {
      name: 'delegate_to_agy',
      description: 'Legacy v0.1 alias for delegate_to_agent with agent="agy".',
      inputSchema: {
        type: 'object',
        properties: commonDelegateProperties,
        required: ['repoPath', 'task'],
      },
      annotations: {
        title: 'Delegate to agy (legacy)',
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    {
      name: 'get_agy_run_report',
      description: 'Legacy v0.1 alias for get_agent_run_report.',
      inputSchema: {
        type: 'object',
        properties: reportProperties,
        required: ['repoPath', 'runId'],
      },
      annotations: {
        title: 'Get agy run report (legacy)',
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    {
      name: 'cleanup_agy_run',
      description: 'Legacy v0.1 alias for cleanup_agent_run.',
      inputSchema: {
        type: 'object',
        properties: {
          repoPath: { type: 'string' },
          runId: { type: 'string' },
          removeWorktree: { type: 'boolean' },
        },
        required: ['repoPath', 'runId'],
      },
      annotations: {
        title: 'Clean up agy run (legacy)',
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
  ],
}));

function requireArguments(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new McpError(ErrorCode.InvalidParams, 'Tool arguments must be an object');
  }
  return value as Record<string, unknown>;
}

function requireString(args: Record<string, unknown>, name: string): string {
  const value = args[name];
  if (typeof value !== 'string' || !value.trim()) {
    throw new McpError(ErrorCode.InvalidParams, `${name} is required`);
  }
  return value;
}

function textResult(result: unknown) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
  };
}

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  try {
    const args = requireArguments(request.params.arguments ?? {});
    switch (request.params.name) {
      case 'delegate_to_agent':
        requireString(args, 'repoPath');
        requireString(args, 'task');
        requireString(args, 'agent');
        return textResult(await delegateToAgent(args as unknown as DelegateAgentArgs));
      case 'get_agent_run_report':
        return textResult(await getAgentRunReport(
          requireString(args, 'repoPath'),
          requireString(args, 'runId'),
          args,
        ));
      case 'apply_agent_run':
        requireString(args, 'repoPath');
        requireString(args, 'runId');
        return textResult(await applyAgentRun(args as unknown as ApplyAgentRunArgs));
      case 'cleanup_agent_run':
        return textResult(await cleanupAgentRun(
          requireString(args, 'repoPath'),
          requireString(args, 'runId'),
          args.removeWorktree === true,
        ));
      case 'list_agent_backends':
        return textResult(await listAgentBackends(
          typeof args.repoPath === 'string' ? args.repoPath : process.cwd(),
        ));
      case 'delegate_to_agy':
        requireString(args, 'repoPath');
        requireString(args, 'task');
        return textResult(await delegateToAgy(args as unknown as DelegateArgs));
      case 'get_agy_run_report':
        return textResult(await getAgyRunReport(
          requireString(args, 'repoPath'),
          requireString(args, 'runId'),
          args,
        ));
      case 'cleanup_agy_run':
        return textResult(await cleanupAgyRun(
          requireString(args, 'repoPath'),
          requireString(args, 'runId'),
          args.removeWorktree === true,
        ));
      default:
        throw new McpError(
          ErrorCode.MethodNotFound,
          `Unknown tool: ${request.params.name}`,
        );
    }
  } catch (error: any) {
    return {
      content: [{
        type: 'text' as const,
        text: `Error: ${error?.message ?? 'Unknown error'}`,
      }],
      isError: true,
    };
  }
});

async function main() {
  if (process.argv[2] === '--run-agent-task' || process.argv[2] === '--run-agy-task') {
    const runDir = process.argv[3];
    if (!runDir) throw new Error('Missing run directory for background agent task.');
    await executeAgentRun(runDir);
    return;
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('codex-agent-delegator MCP server running on stdio');
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
