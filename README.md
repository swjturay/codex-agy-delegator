# Codex Agent Delegator

<div align="center">
  <a href="README.md">English</a> | <a href="README_zh-CN.md">简体中文</a>
</div>

<p align="center">
  <img alt="Node.js 20+" src="https://img.shields.io/badge/Node.js-20%2B-green.svg" />
  <img alt="MCP" src="https://img.shields.io/badge/MCP-Supported-purple.svg" />
  <a href="https://github.com/swjturay/codex-agy-delegator/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/swjturay/codex-agy-delegator/actions/workflows/ci.yml/badge.svg" /></a>
  <a href="https://github.com/swjturay/codex-agy-delegator/releases"><img alt="Release" src="https://img.shields.io/github/v/release/swjturay/codex-agy-delegator" /></a>
  <img alt="License" src="https://img.shields.io/badge/License-MIT-yellow.svg" />
</p>

Codex Agent Delegator is a local MCP server that delegates bounded coding tasks to
Antigravity (`agy`), OpenAI Codex, Claude Code, or an explicit custom executable.
Each run is isolated in a git worktree by default and returns a compact,
review-oriented report.

Version 0.2.0 replaces the agy-only execution path while keeping the three v0.1
agy tool names as compatibility aliases.

## Supported agent backends

| Backend | Minimum/setup | Safe edit mode used by default |
| --- | --- | --- |
| Antigravity | `agy` 1.1.1+, authenticated | `--sandbox --mode accept-edits` |
| OpenAI Codex | Codex CLI, authenticated | `codex exec --ephemeral --ignore-user-config --sandbox workspace-write` |
| Claude Code | Claude Code CLI, authenticated | `claude --print --output-format json --permission-mode acceptEdits` |
| Custom | An executable and argument array | Requires `allowUnsafe: true`; never runs through a shell |

`workspace-write` is the default permission mode. `full-access` always requires
`allowUnsafe: true`. A custom executable also requires that opt-in because the
server cannot verify its sandbox.

## Requirements

- macOS, Linux, or Windows
- Node.js 20 or newer
- Git
- At least one authenticated agent CLI from the table above
- Codex or another MCP client for hosting this server

## Install on macOS

Run from Terminal:

```bash
curl -fsSL https://raw.githubusercontent.com/swjturay/codex-agy-delegator/main/install.sh | bash
```

On a fresh Mac, files are installed under:

```text
~/Library/Application Support/codex-agent-delegator
```

The installer:

1. verifies Git, Node.js, and npm;
2. clones or fast-forwards an existing clean installation;
3. installs the locked dependencies and builds `dist/index.js`;
4. installs the bundled Codex skills;
5. backs up and updates `~/.codex/config.toml`.

An existing `~/.codex-agy-delegator` v0.1 installation is upgraded in place.
Restart Codex after installation, then call `list_agent_backends`.

Linux and Windows commands are documented in
[Installation details](#manual-and-other-platform-installation).

## MCP tools

| Tool | Purpose |
| --- | --- |
| `delegate_to_agent` | Start an agy, Codex, Claude, or custom run |
| `get_agent_run_report` | Poll progress or fetch logs, diff stat, or patch |
| `apply_agent_run` | Apply a reviewed patch to a clean repository |
| `cleanup_agent_run` | Cancel a run and remove managed artifacts/worktree |
| `list_agent_backends` | Probe installed built-in agent CLIs |

Legacy aliases remain available: `delegate_to_agy`, `get_agy_run_report`, and
`cleanup_agy_run`.

`delegate_to_agent` requires an explicit `agent` selection. The legacy
`delegate_to_agy` alias always selects Antigravity.

### Delegate to Codex

```json
{
  "repoPath": "/absolute/path/to/project",
  "task": "Add unit tests for the URL parser.",
  "agent": "codex",
  "allowedFiles": ["src/url.ts", "tests/url.test.ts"],
  "forbiddenFiles": [".env", "package-lock.json"],
  "testCommands": ["npm run typecheck", "npm test"],
  "permissionMode": "workspace-write",
  "useWorktree": true
}
```

### Delegate to Claude Code

```json
{
  "repoPath": "/absolute/path/to/project",
  "task": "Update the API reference for the new pagination fields.",
  "agent": "claude",
  "allowedFiles": ["docs/**"],
  "testCommands": ["npm run lint:docs"]
}
```

Runs are asynchronous by default. Poll with:

```json
{
  "repoPath": "/absolute/path/to/project",
  "runId": "RUN_ID_FROM_DELEGATE",
  "detail": "compact"
}
```

After reviewing a successful run, applying it requires explicit confirmation:

```json
{
  "repoPath": "/absolute/path/to/project",
  "runId": "RUN_ID_FROM_DELEGATE",
  "confirm": true
}
```

`needs_review` runs additionally require `allowNeedsReview: true`. A `blocked`
run can never be applied.

## Security model

- A generated git worktree isolates changes from your current branch.
- The backend's native sandbox/permission mode limits the agent process.
- File allow/deny rules are independently checked after execution.
- Test commands and custom agents are executed as an executable plus argument
  array, never with `shell: true`.
- Run IDs and cleanup targets are validated before filesystem removal.
- Cleanup refuses worktree paths outside the generated sibling worktree roots.
- The server never commits or pushes delegated changes.

A git worktree is not an operating-system sandbox. Keep `workspace-write`,
use narrow file rules, and reserve `full-access` for cases you have reviewed.
Do not delegate secrets or destructive migrations.

Run artifacts are stored in `.codex-agent-runs/`. Worktrees are stored beside
the repository in `<repo>-agent-worktrees/`. Both v0.2 and legacy v0.1 run
reports can be read and cleaned up.

## Manual and other-platform installation

Linux:

```bash
curl -fsSL https://raw.githubusercontent.com/swjturay/codex-agy-delegator/main/install.sh | bash
```

Windows PowerShell:

```powershell
Invoke-WebRequest -Uri "https://raw.githubusercontent.com/swjturay/codex-agy-delegator/main/install.ps1" -UseBasicParsing | Invoke-Expression
```

Manual build:

```bash
git clone https://github.com/swjturay/codex-agy-delegator.git
cd codex-agy-delegator
npm ci
npm run build
```

Add the server to `~/.codex/config.toml`:

```toml
[mcp_servers.codex-agent-delegator]
command = "/absolute/path/to/node"
args = ["/absolute/path/to/codex-agy-delegator/dist/index.js"]
startup_timeout_sec = 15.0
tool_timeout_sec = 120.0
```

## Development

```bash
npm ci
npm run typecheck
npm test
npm run test:coverage
```

See [CHANGELOG.md](CHANGELOG.md) for migration notes and
[SECURITY.md](SECURITY.md) for vulnerability reporting.
