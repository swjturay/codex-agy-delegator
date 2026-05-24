# Codex Review Skill

## Purpose
This skill teaches Codex how to efficiently review the results of tasks delegated to the Antigravity (agy) worker, minimizing token usage while maintaining high code quality and safety.

## Review Sequence
When the MCP `delegate_to_agy` tool returns a report, follow this order of review:
1. **Check Status:** Look at the `status` field (`success`, `failed`, `blocked`, `needs_review`).
2. **Review Changed Files:** Read the `changedFiles` array to ensure no unexpected files were touched.
3. **Check Diff Stat:** Read `diffStat` for a high-level overview of line additions/deletions.
4. **Check Tests:** Look at the `tests` results to ensure all tests passed (`exitCode === 0`).
5. **Check Risk Notes:** Read the `riskNotes` provided by the worker.
6. **Focus Review:** Only read the actual diff or open files mentioned in `reviewFocus`. Do not indiscriminately read all changed files unless necessary.

## Priority Areas for Review
Pay special attention to changes involving:
- Public API signatures
- Data model and schema changes
- Authentication and permission logic
- Error handling mechanisms
- Dependency updates
- Test failures or regressions

## What to Avoid
To save tokens:
- **Avoid reading unrelated files.** Trust the worker's isolation if tests pass and risk notes are clean.
- **Do not redo mechanical work.** If the worker successfully migrated 50 files, don't read them all; sample a few or rely on tests.
- **Do not expand the refactor scope** without strong evidence that it is broken.

## Final Output / Decision
Based on your review, you must output one of the following decisions to the user:
- **Accept:** The changes are good. (If worktree was used, you can provide the command to merge/apply).
- **Rework Required:** Pass feedback back to the worker for another run.
- **Minor Fixes:** Fix small issues yourself instead of doing a full roundtrip.
- **Block:** Reject the changes due to severe violations or architectural misalignment.
