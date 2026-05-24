# Codex-Agy Delegator MCP Server

<div align="center">
  <a href="README.md">English</a> | <a href="README_zh-CN.md">简体中文</a>
</div>

<br/>

<div align="center">
  <img alt="Node.js" src="https://img.shields.io/badge/Node.js-18+-green.svg" />
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-5.3+-blue.svg" />
  <img alt="License" src="https://img.shields.io/badge/License-MIT-yellow.svg" />
  <img alt="MCP" src="https://img.shields.io/badge/MCP-Supported-purple.svg" />
</div>

<br/>

> **Save Codex tokens and supercharge your AI pair programming.**  
> The Codex-Agy Delegator is an MCP (Model Context Protocol) Server that allows **Codex** to securely delegate low-risk, bulk, or repetitive coding tasks to an **Antigravity (agy)** worker.

---

## 📖 Table of Contents
- [Why Use This?](#-why-use-this)
- [How It Works](#-how-it-works)
- [Installation](#-installation)
- [Quick Setup for Codex](#-quick-setup-for-codex)
- [Setting Up the Skills](#-setting-up-the-skills)
- [Example Workflow](#-example-workflow)
- [Security & Isolation](#-security--isolation)

---

## 🎯 Why Use This?
Instead of Codex spending huge context windows performing mechanical changes or reading large diffs, it spins up an isolated `agy` worker in a `git worktree`. 
- **Token Efficiency:** Codex reads a highly condensed JSON report instead of large diffs.
- **Safety:** Worker modifications are isolated in a Git worktree.
- **Role Separation:** Codex acts purely as the Reviewer and Architect, while Agy does the heavy lifting.

## 🛠 How It Works
1. **MCP Server:** The execution layer. It manages git worktrees, creates instructions (`task.md`), spawns the `agy` worker, runs tests, and parses the structured report.
2. **Skills (Markdown rules):** The behavioral layer.
   - **Codex Skills:** Teaches Codex *when* to delegate and *how* to review the JSON report without falling back to full-project scanning.
   - **Agy Skill:** Restricts the Antigravity worker to boundaries (`allowedFiles`, `forbiddenFiles`) and enforces strict JSON output.

## 📋 Prerequisites
Before installing, ensure your environment is prepared:
1. **Node.js & TypeScript**: Node version 18+ is required.
2. **Antigravity CLI (`agy`)**: The MCP server relies on the local Antigravity CLI to execute delegated tasks.
   - You must have `agy` installed and globally accessible in your `$PATH`.
   - You must **complete authentication and setup for `agy`** beforehand. The CLI must be able to run prompts non-interactively without blocking on login prompts.
3. **Codex**: A local installation of Codex or a compatible MCP client.

## 💻 Installation

Ensure you have Node.js and TypeScript installed on your system.

```bash
git clone https://github.com/swjturay/codex-agy-delegator.git
cd codex-agy-delegator
npm install
npm run build
```

To verify the build:
```bash
npm run selfcheck
```

## ⚡ Quick Setup for Codex

We provide an automated script to help you configure Codex quickly. Run:

```bash
npm run install:codex
```

This script will generate your local absolute path and attempt to auto-append it to common Codex MCP configuration files (e.g., `~/.codex/mcp.toml`). If it cannot find the file automatically, it will print the TOML block for you to copy.

<details>
<summary>Manual Configuration Example</summary>

Add this to your `mcp.toml` or `config.json` manually:

```toml
[mcp_servers.codex-agy-delegator]
command = "node"
args = ["/absolute/path/to/your/repo/codex-agy-delegator/dist/src/index.js"]
```
</details>

## 🧠 Setting Up the Skills

### For Codex
Copy or link the provided skills into your Codex skills directory:
- [`skills/codex-delegation/SKILL.md`](skills/codex-delegation/SKILL.md) (teaches Codex *how to delegate*)
- [`skills/codex-review/SKILL.md`](skills/codex-review/SKILL.md) (teaches Codex *how to review*)

### For Antigravity (agy)
The MCP server will automatically pass a synthesized `task.md` to `agy`. To ensure best results, pre-load [`skills/agy-worker/SKILL.md`](skills/agy-worker/SKILL.md) into your default Antigravity CLI system prompt.

## 🚀 Example Workflow

1. **User Request:** "Codex, please update all `interface` definitions in `src/models/` to `type`."
2. **Codex Delegates:** Codex uses the MCP tool:
   ```json
   {
     "repoPath": "/path/to/repo",
     "task": "Update all interface definitions to type in src/models/",
     "allowedFiles": ["src/models/*.ts"]
   }
   ```
3. **MCP Server Executes:** 
   Creates a `.agy-worktrees` branch -> Spawns `agy` -> Runs tests -> Extracts the `AgyWorkerReport` JSON.
4. **Codex Reviews:** Codex reads the returned, condensed JSON. Tests passed, no risk notes. Codex replies: *"The refactor was completed successfully by the worker. Tests passed. You can merge the worktree branch."*

## 🛡 Security & Isolation
- **No auto-commit/push:** Leaves changes in a safe worktree.
- **Forbidden files enforcement:** If the worker touches restricted files, the MCP server flags the run as `blocked`.
- **Timeouts:** Agy processes are strictly killed after timeouts to prevent runaway processes.
