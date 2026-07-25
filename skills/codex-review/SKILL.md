# Delegated Agent Review Skill

## Purpose

Review delegated changes efficiently without treating a worker report as proof
of correctness.

## Review sequence

1. Check `status`: `success`, `needs_review`, `blocked`, `failed`, or a running
   state.
2. Confirm the backend, changed-file count, and changed-file list match the task.
3. Check every verification command, exit code, and timeout flag.
4. Read `riskNotes`, `reviewFocus`, and `assumptions`.
5. Request `detail: "diffStat"` when scope is unclear.
6. Inspect the patch or focused source files for public API, data model,
   permissions, error handling, dependencies, and failed-test changes.
7. Decide: accept, request rework, make a minor local correction, or block.

Never apply a `blocked` run. Treat `needs_review` as unresolved unless the
underlying failure is understood and explicitly accepted. Applying it requires
both `confirm: true` and `allowNeedsReview: true`.

After acceptance, call `apply_agent_run` with `confirm: true`, verify the target
working tree, and then clean up the managed run/worktree.
