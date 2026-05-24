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

> **节省 Codex Token，为 AI 结对编程提速。**  
> Codex-Agy Delegator 是一个基于 MCP (Model Context Protocol) 协议的服务，允许 **Codex** 将低风险、大批量或重复性的编码任务安全地委派给本地的 **Antigravity (agy)** Worker 去执行。

---

## 📖 目录
- [为什么需要这个项目？](#-为什么需要这个项目)
- [核心架构与原理](#-核心架构与原理)
- [安装指南](#-安装指南)
- [Codex 一键配置](#-codex-一键配置)
- [配置 Skills](#-配置-skills)
- [典型工作流](#-典型工作流)
- [安全与隔离](#-安全与隔离)

---

## 🎯 为什么需要这个项目？
相较于让 Codex 亲自去阅读整个项目文件、输出巨大的代码变更并消耗海量的上下文（Token），该系统会将任务下发给一个隔离在 `git worktree` 中的 `agy` 执行者。
- **极致的 Token 优化：** Codex 只需要审查执行者返回的极简 JSON 报告，不再需要阅读动辄几千行的 diff。
- **安全隔离：** Worker 的所有修改都被限制在独立的 Git worktree 中，不会污染你的当前分支。
- **角色分离：** Codex 专职担任审查者（Reviewer）与架构师，脏活累活全权交给 agy。

## 🛠 核心架构与原理
1. **MCP Server (执行层):** 负责管理 git worktrees、生成严格的 `task.md`、唤起 `agy` 执行者、运行测试脚本、截断冗长日志，并从结果中提取结构化报告。
2. **Skills (规则层):**
   - **Codex Skills:** 教授 Codex *何时* 应该委派任务，以及 *如何* 在不重新阅读全库的前提下审查 JSON 报告。
   - **Agy Skill:** 将 Antigravity 代理约束为 Worker 角色，强制其遵循 `allowedFiles` 和 `forbiddenFiles`，并严格输出 JSON。

## 📋 前置准备
在安装之前，请确保您的环境已完成以下准备：
1. **Node.js 与 TypeScript**：需要 Node 18 或更高版本。
2. **Antigravity CLI (`agy`)**：MCP Server 依赖本地的 Antigravity CLI 来执行被委派的代码任务。
   - 必须全局安装 `agy`，并确保可在命令行的 `$PATH` 中直接调用。
   - 必须**提前完成 `agy` 的登录和认证配置**。确保 CLI 在后台非交互式运行时，不会因为缺少认证凭证或弹窗而被阻塞。
3. **Codex**：本地已安装 Codex 或支持 MCP 协议的客户端。

## 💻 安装指南

在安装前，请确保系统已配置 Node.js 和 TypeScript。

```bash
git clone https://github.com/swjturay/codex-agy-delegator.git
cd codex-agy-delegator
npm install
npm run build
```

验证是否构建成功：
```bash
npm run selfcheck
```

## ⚡ 一键配置 (Quick Setup)

我们提供了一个极其方便的自动化脚本，它能够同时为您安装 Skills 并注入 MCP 配置。

请在项目根目录运行：

```bash
npm run setup
```

该命令将自动执行以下两步：
1. **安装 Skills**: 自动将 `codex-delegation` 和 `codex-review` 注入到 `~/.codex/skills/`，将 `agy-worker` 注入到 `~/.antigravitycli/skills/`。
2. **配置 MCP**: 自动探寻您的 Codex 配置文件（如 `~/.codex/mcp.toml`），并追加该 MCP 服务的绝对路径配置。

<details>
<summary>手动配置 (如果您想指定其他目录)</summary>

### 手动配置 MCP
将以下内容手动添加到你的 `mcp.toml` 或 `config.json` 中：

```toml
[mcp_servers.codex-agy-delegator]
command = "node"
args = ["/你本地的绝对路径/codex-agy-delegator/dist/src/index.js"]
```

### 手动安装 Skills
**对于 Codex**: 复制或链接提供的 Skills 到您的 Codex 自定义规则或 Prompt 中：
- [`skills/codex-delegation/SKILL.md`](skills/codex-delegation/SKILL.md) (教 Codex *如何委派*)
- [`skills/codex-review/SKILL.md`](skills/codex-review/SKILL.md) (教 Codex *如何审查*)

**对于 Antigravity (agy)**: MCP Server 会自动生成带有严格指令的 `task.md` 传给 `agy`。为了最佳效果，您可以将 [`skills/agy-worker/SKILL.md`](skills/agy-worker/SKILL.md) 预置为 agy 的系统 Prompt。
</details>

## 🚀 典型工作流

1. **用户请求：** "Codex，请把 `src/models/` 目录下所有的 `interface` 换成 `type`。"
2. **Codex 委派任务：** Codex 调用 MCP 工具：
   ```json
   {
     "repoPath": "/path/to/repo",
     "task": "把 src/models/ 下所有的 interface 转换为 type",
     "allowedFiles": ["src/models/*.ts"]
   }
   ```
3. **MCP Server 执行：** 
   创建 `.agy-worktrees` 分支 -> 唤起 `agy` -> 运行测试 -> 提取 `AgyWorkerReport` JSON。
4. **Codex 审查：** Codex 收到精简的 JSON。看到测试通过，且风险点为空后，回复：*"Worker 已经成功完成了重构，测试通过。您可以去合并 worktree 分支了。"*

## 🛡 安全与隔离
- **不自动提交/推送：** 代码修改将完全停留在安全的 worktree 中。
- **禁止文件拦截：** 如果 Worker 意外修改了 `forbiddenFiles`，MCP Server 会立刻拦截并标记任务为 `blocked`。
- **超时杀死：** 对 Agy 进程设定严格的超时阈值，防止跑偏或死循环。
