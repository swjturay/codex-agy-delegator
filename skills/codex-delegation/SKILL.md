# Codex Delegation Skill

## Purpose
This skill teaches Codex when and how to delegate tasks to the Antigravity (agy) worker via the MCP server, instead of consuming your own tokens to implement changes directly.

## Suitable Tasks for Delegation
Delegate tasks that are:
- Bulk refactoring (e.g., renaming variables across many files)
- Adding or backfilling unit tests
- Documentation generation or commenting
- Mechanical migrations (e.g., updating API versions)
- Searching the codebase and organizing candidate files
- Low-risk UI or style tweaks

## Unsuitable Tasks (Do NOT Delegate)
Do not delegate tasks that involve:
- Security-sensitive code (e.g., Auth, Payments, Cryptography)
- Data migrations that are irreversible or highly complex
- Major architectural decisions or redesigns
- Reading or modifying secrets and privacy-sensitive files
- Tasks where the user explicitly asked you (Codex) to write the code yourself

## How to Delegate
Before delegating, you must synthesize a "narrow task card". The task must explicitly state:
- **Goal:** The exact expected outcome.
- **Allowed Files:** The specific files or glob patterns the worker can touch.
- **Forbidden Files:** The files the worker must not touch.
- **Acceptance Criteria / Tests:** Commands to verify success.
- **Output Format:** Strict JSON report format (the MCP server enforces this).

### Instructions for Codex
1. Do not provide the entire project context to the worker. Give only the necessary context in the task description.
2. Call the `delegate_to_agy` MCP tool.
3. Review the returned structured report: `changedFiles`, `diffStat`, `diffSummary`, `tests`, `riskNotes`, and `reviewFocus`.
4. If the worker fails or returns incomplete results, do a minimal necessary review based on the `reviewFocus`. Do not reread the entire project.
