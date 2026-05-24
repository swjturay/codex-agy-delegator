# Codex-Agy Delegator MCP Server

## 1. Project Purpose
The **Codex-Agy Delegator** provides an MCP (Model Context Protocol) interface that allows **Codex** to securely delegate low-risk, bulk, or repetitive coding tasks to an **Antigravity CLI (agy)** worker. 

The goal is to **save Codex tokens**. Instead of Codex spending huge context windows performing mechanical changes or reading large diffs, it spins up an isolated `agy` worker in a `git worktree`. The worker performs the task and returns a highly condensed JSON report (diff summaries, test results, risk notes). Codex then acts purely as a Reviewer and Gatekeeper.

## 2. Why MCP + Skills are Both Needed
- **MCP Server:** This is the execution layer. It handles git worktrees, creates `task.md`, safely spawns the `agy` subprocess, runs tests, truncates logs, and parses the structured report. It enforces isolation and guarantees the output returned to Codex is minimal.
- **Skills (Markdown rules):** These are the behavioral layer. 
  - `codex-delegation` and `codex-review` Skills teach Codex *when* to use the MCP server, what tasks are safe, and how to read the condensed report without falling back to reading the whole project.
  - `agy-worker` Skill teaches the Antigravity agent to act strictly as a worker, output the required JSON format, and respect `allowedFiles`/`forbiddenFiles` boundaries.

## 3. Installation
Ensure you have Node.js and TypeScript installed.

```bash
cd tools/codex-agy-delegator
npm install
```
*(If you do not have `npm` globally installed, you can use `yarn` or `pnpm`)*

Dependencies required:
- `@modelcontextprotocol/sdk`
- `@types/node` (dev)
- `typescript` (dev)

## 4. Building
Compile the TypeScript code to JavaScript:

```bash
npm run build
```

Verify everything is working with:
```bash
npm run selfcheck
```

## 5. Codex MCP Configuration
We have provided an automated script to help you configure Codex quickly. Simply run:

```bash
npm run install:codex
```

This script will generate the absolute path for your local setup and attempt to auto-append it to common Codex MCP configuration files (like `~/.codex/mcp.toml`). If it cannot find the file automatically, it will print the configuration block for you to copy and paste manually.

**Example of the generated `mcp.toml` block:**
```toml
[mcp_servers.codex-agy-delegator]
command = "node"
# The script will automatically resolve this to your real absolute path!
args = ["/absolute/path/to/your/repo/tools/codex-agy-delegator/dist/index.js"]
```

## 6. How to Install / Reference Codex Skills
Copy or link the provided skills into your Codex skills directory or prompt instructions.
- Add `skills/codex-delegation/SKILL.md` so Codex knows *how to delegate*.
- Add `skills/codex-review/SKILL.md` so Codex knows *how to review*.

## 7. How to Install / Reference Antigravity Skill
When the MCP Server invokes `agy`, you can configure your default Antigravity CLI to load `skills/agy-worker/SKILL.md` globally, or include it in your system prompts for the agy CLI. The MCP server will automatically pass a synthesized `task.md` that enforces the JSON output.

## 8. Complete Example Workflow
1. **User Request:** "Codex, please update all `interface` definitions in `src/models/` to `type`."
2. **Codex Action:** Codex realizes this is a bulk refactor. It calls the `delegate_to_agy` MCP tool:
   ```json
   {
     "repoPath": "/path/to/repo",
     "task": "Update all interface definitions to type in src/models/",
     "allowedFiles": ["src/models/*.ts"]
   }
   ```
3. **MCP Server:**
   - Creates a git worktree `.agy-worktrees/<run-id>`.
   - Writes `task.md`.
   - Spawns `agy "task.md content"`.
4. **Agy Worker:** Reads the task, performs the changes, and outputs the `AgyWorkerReport` JSON.
5. **MCP Server:** Runs tests, extracts the JSON, and returns a condensed summary to Codex.
6. **Codex Review:** Codex reads the returned JSON. Tests passed, risk notes are clean. Codex tells the user: "The refactor was completed successfully by the worker. Tests passed. You can merge the worktree branch."

## 9. Security & Limits
- **No auto-commit/push:** The MCP server will never commit or push changes. It leaves them in the worktree.
- **Forbidden files enforcement:** If the worker modifies a file in `forbiddenFiles`, the MCP server flags the run as `blocked` and warns Codex.
- **Timeouts:** Agy processes are strictly killed after `timeoutMs`.
- **Safe Command Execution:** Shell execution avoids string interpolation (`execFile`/`spawn` are used).

## 10. Known Limitations
- The MCP server currently expects `agy` to be available in the `PATH` and callable via `agy [instructions]`. If your Antigravity CLI uses different flags, you must modify `src/tools/delegateToAgy.ts`.
- Simple wildcard matching for `forbiddenFiles` is used (basic `includes`). For complex globs, a library like `minimatch` should be added.

## 11. Future Improvements
- Add auto-cleanup of stale worktrees.
- Support parallel execution of multiple agy workers for large codebases.
- Better glob pattern support for `allowedFiles`/`forbiddenFiles`.
