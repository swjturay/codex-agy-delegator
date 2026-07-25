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

Codex Agent Delegator 是一个本地 MCP 服务，可将边界明确的编码任务委派给
Antigravity（`agy`）、OpenAI Codex、Claude Code 或指定的自定义可执行程序。
每次运行默认放在独立的 Git worktree 中，并返回便于审查的精简报告。

v0.2.0 将原先仅支持 agy 的执行链路升级为通用代理链路，同时保留 v0.1
的三个 agy 工具名作为兼容别名。

## 支持的代理

| 后端 | 最低要求/准备 | 默认安全编辑模式 |
| --- | --- | --- |
| Antigravity | `agy` 1.1.1+，已登录 | `--sandbox --mode accept-edits` |
| OpenAI Codex | Codex CLI，已登录 | `codex exec --ephemeral --ignore-user-config --sandbox workspace-write` |
| Claude Code | Claude Code CLI，已登录 | `claude --print --output-format json --permission-mode acceptEdits` |
| 自定义程序 | 可执行文件与参数数组 | 必须设置 `allowUnsafe: true`；绝不通过 shell 运行 |

默认权限是 `workspace-write`。`full-access` 一定要显式设置
`allowUnsafe: true`。自定义程序也必须显式确认，因为服务无法验证它的沙箱。

## 环境要求

- macOS、Linux 或 Windows
- Node.js 20 或更高版本
- Git
- 上表中至少一个已经完成认证的代理 CLI
- Codex 或其他支持 MCP 的宿主客户端

## macOS 安装

在“终端”中执行：

```bash
curl -fsSL https://raw.githubusercontent.com/swjturay/codex-agy-delegator/main/install.sh | bash
```

Mac 全新安装会使用系统惯例目录：

```text
~/Library/Application Support/codex-agent-delegator
```

安装器会：

1. 检查 Git、Node.js 与 npm；
2. 克隆项目，或只对干净的旧安装执行 fast-forward 更新；
3. 根据锁文件安装依赖并构建 `dist/index.js`；
4. 安装随项目提供的 Codex Skills；
5. 备份并更新 `~/.codex/config.toml`。

如果检测到已有的 `~/.codex-agy-delegator` v0.1 安装，会在原目录平滑升级。
安装后重启 Codex，再调用 `list_agent_backends` 检查本机代理。

## MCP 工具

| 工具 | 用途 |
| --- | --- |
| `delegate_to_agent` | 启动 agy、Codex、Claude 或自定义代理 |
| `get_agent_run_report` | 查询进度，或读取日志、diff 统计、补丁 |
| `apply_agent_run` | 将已审查的补丁应用到干净的目标仓库 |
| `cleanup_agent_run` | 取消任务并安全清理运行记录/worktree |
| `list_agent_backends` | 检查内置代理 CLI 是否已安装且兼容 |

兼容工具仍可使用：`delegate_to_agy`、`get_agy_run_report`、
`cleanup_agy_run`。

`delegate_to_agent` 要求明确传入 `agent`；旧的 `delegate_to_agy`
别名始终选择 Antigravity。

### 委派给 Codex

```json
{
  "repoPath": "/项目的绝对路径",
  "task": "为 URL 解析器补充单元测试。",
  "agent": "codex",
  "allowedFiles": ["src/url.ts", "tests/url.test.ts"],
  "forbiddenFiles": [".env", "package-lock.json"],
  "testCommands": ["npm run typecheck", "npm test"],
  "permissionMode": "workspace-write",
  "useWorktree": true
}
```

### 委派给 Claude Code

```json
{
  "repoPath": "/项目的绝对路径",
  "task": "更新分页字段的 API 文档。",
  "agent": "claude",
  "allowedFiles": ["docs/**"],
  "testCommands": ["npm run lint:docs"]
}
```

默认异步执行。拿到 `runId` 后查询：

```json
{
  "repoPath": "/项目的绝对路径",
  "runId": "委派返回的_RUN_ID",
  "detail": "compact"
}
```

审查成功后，应用补丁必须显式确认：

```json
{
  "repoPath": "/项目的绝对路径",
  "runId": "委派返回的_RUN_ID",
  "confirm": true
}
```

`needs_review` 状态还要设置 `allowNeedsReview: true`；`blocked`
状态永远不能应用。

## 安全模型

- 自动生成的 Git worktree 避免污染当前分支。
- 使用各代理自己的沙箱/权限模式限制进程。
- 代理结束后独立校验允许和禁止文件规则。
- 测试命令与自定义程序都按“可执行文件 + 参数数组”运行，不使用
  `shell: true`。
- 删除前严格验证 run ID 与清理目标。
- worktree 不在受管的同级目录时，清理操作会拒绝执行。
- 服务不会替你提交或推送代码。

Git worktree 不是操作系统沙箱。建议保留 `workspace-write`、设置尽可能窄的
文件范围，只在明确审查过的场景使用 `full-access`。不要委派密钥处理或不可逆
的数据迁移。

运行记录保存在 `.codex-agent-runs/`；worktree 保存在仓库同级的
`<仓库名>-agent-worktrees/`。v0.2 仍可读取和清理 v0.1 的旧运行记录。

## 其他平台与手动安装

Linux：

```bash
curl -fsSL https://raw.githubusercontent.com/swjturay/codex-agy-delegator/main/install.sh | bash
```

Windows PowerShell：

```powershell
Invoke-WebRequest -Uri "https://raw.githubusercontent.com/swjturay/codex-agy-delegator/main/install.ps1" -UseBasicParsing | Invoke-Expression
```

手动构建：

```bash
git clone https://github.com/swjturay/codex-agy-delegator.git
cd codex-agy-delegator
npm ci
npm run build
```

将服务写入 `~/.codex/config.toml`：

```toml
[mcp_servers.codex-agent-delegator]
command = "/node/的绝对路径"
args = ["/项目绝对路径/codex-agy-delegator/dist/index.js"]
startup_timeout_sec = 15.0
tool_timeout_sec = 120.0
```

## 开发与验证

```bash
npm ci
npm run typecheck
npm test
npm run test:coverage
```

迁移说明见 [CHANGELOG.md](CHANGELOG.md)，安全问题报告方式见
[SECURITY.md](SECURITY.md)。
