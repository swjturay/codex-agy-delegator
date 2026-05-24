import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ErrorCode,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";

import { delegateToAgy, DelegateArgs } from "./tools/delegateToAgy.js";
import { getAgyRunReport } from "./tools/getAgyRunReport.js";
import { cleanupAgyRun } from "./tools/cleanupAgyRun.js";

const server = new Server(
  {
    name: "codex-agy-delegator",
    version: "0.1.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "delegate_to_agy",
        description: "Delegate a coding task to the Antigravity (agy) worker.",
        inputSchema: {
          type: "object",
          properties: {
            repoPath: { type: "string", description: "Absolute path to the target repository." },
            task: { type: "string", description: "The task instruction for agy." },
            allowedFiles: { type: "array", items: { type: "string" }, description: "Files allowed to be modified." },
            forbiddenFiles: { type: "array", items: { type: "string" }, description: "Files not allowed to be modified." },
            testCommands: { type: "array", items: { type: "string" }, description: "Commands to run for tests, e.g. ['npm test']." },
            timeoutMs: { type: "number", description: "Timeout in milliseconds." },
            useWorktree: { type: "boolean", description: "Whether to use a git worktree to avoid polluting the main repo." },
            branchPrefix: { type: "string", description: "Prefix for the temporary branch." },
            dryRun: { type: "boolean", description: "If true, skips running agy." },
          },
          required: ["repoPath", "task"],
        },
      },
      {
        name: "get_agy_run_report",
        description: "Retrieve the report of a previous agy run.",
        inputSchema: {
          type: "object",
          properties: {
            repoPath: { type: "string", description: "Absolute path to the repository." },
            runId: { type: "string", description: "The run ID to fetch." },
          },
          required: ["repoPath", "runId"],
        },
      },
      {
        name: "cleanup_agy_run",
        description: "Clean up resources associated with an agy run.",
        inputSchema: {
          type: "object",
          properties: {
            repoPath: { type: "string", description: "Absolute path to the repository." },
            runId: { type: "string", description: "The run ID to cleanup." },
            removeWorktree: { type: "boolean", description: "Whether to remove the worktree entirely." },
          },
          required: ["repoPath", "runId"],
        },
      },
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  try {
    switch (request.params.name) {
      case "delegate_to_agy": {
        const args = request.params.arguments as unknown as DelegateArgs;
        if (!args.repoPath || !args.task) {
          throw new McpError(ErrorCode.InvalidParams, "repoPath and task are required");
        }
        const result = await delegateToAgy(args);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }
      case "get_agy_run_report": {
        const args = request.params.arguments as any;
        if (!args.repoPath || !args.runId) {
          throw new McpError(ErrorCode.InvalidParams, "repoPath and runId are required");
        }
        const result = await getAgyRunReport(args.repoPath, args.runId);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }
      case "cleanup_agy_run": {
        const args = request.params.arguments as any;
        if (!args.repoPath || !args.runId) {
          throw new McpError(ErrorCode.InvalidParams, "repoPath and runId are required");
        }
        const result = await cleanupAgyRun(args.repoPath, args.runId, args.removeWorktree);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }
      default:
        throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${request.params.name}`);
    }
  } catch (error: any) {
    return {
      content: [
        {
          type: "text",
          text: `Error: ${error.message}`,
        },
      ],
      isError: true,
    };
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("codex-agy-delegator MCP server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
