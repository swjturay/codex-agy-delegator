# Security Policy

## Supported versions

Security fixes are provided for the latest published minor release.

| Version | Supported |
| --- | --- |
| 0.2.x | Yes |
| 0.1.x | No |

## Reporting a vulnerability

Do not open a public issue for a suspected vulnerability. Use GitHub's
**Security → Report a vulnerability** flow for this repository. Include:

- the affected version and operating system;
- the selected agent and permission mode;
- a minimal reproduction;
- the expected and observed filesystem or process boundary.

Avoid including credentials, tokens, or private repository contents.

## Operational guidance

- Keep the default `workspace-write` permission mode.
- Use generated worktrees and narrow `allowedFiles`/`forbiddenFiles`.
- Treat `allowUnsafe: true` as a deliberate trust decision.
- Review reports and patches before calling `apply_agent_run`.
- Do not delegate secret handling or irreversible production operations.
