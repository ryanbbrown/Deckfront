# Project Instructions

## Project Context
- This is a greenfield side project.
- Unless the user explicitly says otherwise, there are no backwards-compatibility requirements.
- When interpreting strategy search, PSRO, equilibrium, strategy-family, or balance-report results, read `docs/strategy-search-evidence.md` first.

## Workflow
- Plans live in `.plans/`, should be committed, and should be named with implementation-order prefixes like `01-auth.md`, `02-billing.md`, and `03-dashboard.md`.
- Superseded plans and decision records move to `.plans/archive/` with a banner naming the document that replaced them. Never use an archived document for a decision.
- Multi-agent reviews live in `.reviews/`, which is ignored by Git.
- Generated HTML artifacts live in `.html/` and should be committed when they capture useful design, planning, or review context.
- Keep `README.md` current with the minimum context needed to run and understand the project.
## Delegated work
- Use the `implement` skill workflow for substantial changes: one writer subagent owns the working tree, and the main agent stays the decision-maker.
- Use the `review-panel` skill for reviews, not an ad-hoc review subagent. Review a detailed implementation plan in plan mode before the work starts. Review the writer's output in implementation mode against the recorded pre-implementation SHA.
- The main agent may edit files directly when the edit is small and a handoff to the writer costs more than the edit.

## Development
- Prefer the simplest implementation that satisfies the current product intent.
- Every implementation step must end with passing verification.
- Write tests for behavior that would be expensive or risky to verify manually.
- Run the relevant tests, typecheck, and lint before declaring work complete.
