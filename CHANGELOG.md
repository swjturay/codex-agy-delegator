# Changelog

All notable changes to this project are documented here.

## 0.2.0 - 2026-07-25

### Added

- Universal `delegate_to_agent` support for Antigravity, Codex, Claude Code,
  and explicit custom executables.
- Agent discovery, persisted background progress, report/log retrieval,
  reviewed patch application, and managed cleanup tools.
- Safe backend permission modes with explicit opt-in for full access.
- End-to-end tests and CI across macOS, Linux, and Windows.

### Security

- Removed unconditional `--dangerously-skip-permissions`.
- Prevented run ID path traversal during report retrieval and cleanup.
- Refused cleanup of worktrees outside generated managed roots.
- Removed shell parsing from test and custom-agent execution.
- Added clean-tree checks and `git apply --check` before patch application.
- Updated dependencies; `npm audit` reports no known vulnerabilities at release.

### Changed

- Node.js 20 or newer is now required.
- New run artifacts use `.codex-agent-runs/` and sibling
  `<repo>-agent-worktrees/` directories.
- Antigravity CLI 1.1.1 or newer is required.
- macOS installs use `~/Library/Application Support/codex-agent-delegator`.

### Compatibility

- `delegate_to_agy`, `get_agy_run_report`, and `cleanup_agy_run` remain as
  deprecated aliases.
- Existing `.codex-agy-runs/` reports and sibling agy worktrees remain
  discoverable for reporting and safe cleanup.
