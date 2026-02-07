# Use Explore Agents In Finalize Research

## Problem Statement

The `/finalize` skill's Step 1 (Plan Completion Verification) currently performs a simple text-based diff comparison: it reads the planning file, extracts planned file paths/tests/docs, and compares them against `git diff --name-only origin/main`. This approach is shallow — it can detect if a listed file was touched but cannot assess whether the _intent_ of each planned phase was actually fulfilled. It also doesn't verify that appropriate test types (unit, integration, E2E) were added for new functionality.

The user wants two new capabilities as the first two steps of `/finalize`:

1. **Agent-based plan assessment** — Launch 4 parallel Explore agents to deeply assess plan completeness, reporting only critical gaps.
2. **Test coverage verification** — Verify that unit, integration, and E2E tests were added for the branch's changes.

## High Level Summary

### Current `/finalize` Workflow (6 steps)

| Step | Name | What it does |
|------|------|-------------|
| 1 | Plan Completion Verification | Text-based diff comparison of planned vs actual file changes |
| 2 | Fetch and Rebase | `git fetch origin main && git rebase origin/main` |
| 3 | Run Checks | lint, tsc, build, unit tests, integration tests |
| 4 | E2E Tests | Optional (`--e2e` flag), runs `@critical` tagged tests |
| 5 | Commit Changes | Commits any fixes |
| 5.5 | Documentation Updates | Maps changed files to docs via `.claude/doc-mapping.json` |
| 6 | Push and Create PR | Pushes and creates PR via `gh pr create` |

### Current Step 1 Limitations

- **Surface-level comparison** — Only checks if file paths from the plan appear in git diff; doesn't verify whether the intended logic, architecture, or behavior was implemented.
- **No semantic understanding** — Can't distinguish between a file that was trivially touched vs one where the planned feature was fully implemented.
- **No test verification** — Doesn't check whether appropriate test types exist; just checks if test files listed in the plan were created.
- **Single-threaded** — All verification happens sequentially in the main conversation, consuming context.

### Proposed New Steps

**New Step 1: Agent-Based Plan Assessment (replaces old Step 1)**
- Launch 4 Explore agents in parallel (single message with 4 Task tool calls)
- Each agent reads the planning doc + relevant code to assess completeness from a different perspective
- Agents report back structured JSON with critical gaps only
- Aggregate results and present to user

**New Step 2: Test Coverage Verification (new step)**
- Check `git diff --name-only origin/main` for test files
- Verify unit tests (`.test.ts`/`.test.tsx`) exist near changed source files
- Verify integration tests (`.integration.test.ts`) exist in `src/__tests__/integration/`
- Verify E2E tests (`.spec.ts`) exist in `src/__tests__/e2e/specs/`
- Report which test types are missing

## Documents Read

- `docs/docs_overall/getting_started.md` — Documentation structure and reading order
- `docs/docs_overall/architecture.md` — System design, data flow, tech stack
- `docs/docs_overall/project_workflow.md` — Project workflow phases (research → plan → execute → finalize)
- `.claude/commands/finalize.md` — Current finalize skill (214 lines, 6-step workflow)
- `.claude/commands/plan-review.md` — Multi-agent plan review with parallel Task agents and JSON voting
- `.claude/doc-mapping.json` — Code-to-doc mapping rules (277 lines, 40+ patterns)

## Code Files Read

- `.claude/commands/finalize.md` — The skill being modified
- `.claude/commands/plan-review.md` — Reference pattern for launching parallel agents
- `.claude/doc-mapping.json` — Used by finalize Step 5.5
- `.claude/skills/plan-review/SKILL.md` — Skill frontmatter showing `allowed-tools` YAML list format with `Task`
- `.claude/skills/plan-review-loop/SKILL.md` — Detailed agent launch instructions and JSON output enforcement
- `.claude/commands/research.md` — Shows `subagent_type=Explore` usage pattern
- `docs/feature_deep_dives/iterative_planning_agent.md` — Agent troubleshooting, state persistence, hook integration

## Key Findings

### 1. Parallel Agent Pattern (from `/plan-review`)

The project already has a proven pattern for launching parallel agents in skills:

- **Tool**: `Task` with `subagent_type` parameter
- **Parallelism**: All agents MUST be launched in a SINGLE message with multiple Task tool calls
- **Output format**: Strict JSON responses with structured fields
- **Agent types available**: `Explore` (codebase research), `Plan` (review/evaluation)

For plan assessment, `Explore` agents are the right choice because they need to read code files and cross-reference against the planning doc — that's codebase exploration, not plan evaluation.

### 2. Test Organization (How to Verify Tests Exist)

| Test Type | Location Pattern | File Pattern | Run Command |
|-----------|-----------------|-------------|-------------|
| Unit | Colocated with source in `src/` | `*.test.ts`, `*.test.tsx` | `npm run test:unit` |
| Integration | `src/__tests__/integration/` | `*.integration.test.ts` | `npm run test:integration` |
| E2E | `src/__tests__/e2e/specs/` | `*.spec.ts` | `npm run test:e2e` |

**Exclusion patterns** (files that are NOT unit tests despite matching `*.test.*`):
- Files in `src/__tests__/e2e/` — E2E tests
- Files in `src/__tests__/integration/` — integration tests
- Files matching `*.esm.test.ts` — ESM-only tests

**Verification approach**: Compare `git diff --name-only origin/main` for new/modified source files against new/modified test files. Flag missing test types.

### 3. Agent Perspective Design (4 Explore Agents)

For plan completeness assessment, 4 perspectives cover the key dimensions:

| Agent | Perspective | What It Checks |
|-------|------------|----------------|
| 1 | **Implementation Completeness** | Were all planned phases implemented? Are planned files modified with the intended changes (not just touched)? |
| 2 | **Architecture & Patterns** | Do changes follow existing codebase patterns? Are services/actions/schemas consistent with conventions? |
| 3 | **Test Coverage** | Were appropriate tests added? Do test descriptions match planned test scenarios? Are edge cases covered? |
| 4 | **Documentation & Integration** | Were doc updates made? Are imports/exports correct? Do new modules integrate properly with existing code? |

Each agent should:
1. Read the planning doc to understand intended work
2. Read `git diff --name-only origin/main` output to see what changed
3. Explore relevant changed files to assess implementation depth
4. Return JSON with `critical_gaps` only (no minor issues — keep it focused)

### 4. Differences From `/plan-review` Pattern

| Aspect | `/plan-review` | New `/finalize` Step 1 |
|--------|---------------|----------------------|
| Agent type | `Plan` | `Explore` (needs to read code, not just review a doc) |
| Agent count | 3 | 4 |
| Output | Score 1-5 + gaps + minor issues | Critical gaps ONLY (boolean: gaps or no gaps) |
| Loop | Iterative until consensus | Single pass — report and ask user |
| Action on gaps | Auto-fix planning doc | Report to user, let them decide proceed/stop |

### 5. Skill File Constraints

The finalize skill is defined in `.claude/commands/finalize.md` with frontmatter:
```yaml
allowed-tools: Bash(git:*), Bash(npm:*), Bash(npx:*), Bash(gh:*), Read, Edit, Write, Grep, Glob, AskUserQuestion
```

**Important**: `Task` is NOT currently in `allowed-tools`. It must be added for the explore agents to work. The plan-review skill includes `Task` in its allowed-tools for exactly this reason.

### 6. Test Verification Approach

Two-pronged verification:

**Automated check (Step 2)**:
```bash
# Get all changed source files (excluding tests, configs, docs)
git diff --name-only origin/main | grep -E '^src/.*\.(ts|tsx)$' | grep -v '\.test\.' | grep -v '\.spec\.' | grep -v '__tests__'

# Get all changed/added test files by type
git diff --name-only origin/main | grep -E '\.test\.(ts|tsx)$' | grep -v 'integration' | grep -v 'e2e'  # Unit
git diff --name-only origin/main | grep -E '\.integration\.test\.ts$'  # Integration
git diff --name-only origin/main | grep -E 'e2e/specs/.*\.spec\.ts$'  # E2E
```

**Semantic check (part of Agent 3 in Step 1)**:
Agent 3 reads the planning doc's "Testing" section and cross-references against actual test files to assess whether the planned test scenarios were actually implemented.

### 7. Proposed New Step Order

| New Step | Name | Description |
|----------|------|-------------|
| **1** | Agent-Based Plan Assessment | 4 parallel Explore agents assess plan completion, report critical gaps |
| **2** | Test Coverage Verification | Automated check for unit/integration/E2E test presence |
| 3 | Fetch and Rebase | (unchanged from current Step 2) |
| 4 | Run Checks | (unchanged from current Step 3) |
| 5 | E2E Tests | (unchanged from current Step 4) |
| 6 | Commit Changes | (unchanged from current Step 5) |
| 6.5 | Documentation Updates | (unchanged from current Step 5.5) |
| 7 | Push and Create PR | (unchanged from current Step 6) |

### 8. allowed-tools Configuration

**Current finalize frontmatter** (flat string, no Task):
```yaml
allowed-tools: Bash(git:*), Bash(npm:*), Bash(npx:*), Bash(gh:*), Read, Edit, Write, Grep, Glob, AskUserQuestion
```

**Required change** — Add `Task` to enable launching Explore agents. Two format options exist in the codebase:

- **Commands (`.claude/commands/*.md`)** use flat comma-separated string format
- **Skills (`.claude/skills/*/SKILL.md`)** use YAML list format

Since finalize is a command file, the addition should follow the flat format:
```yaml
allowed-tools: Bash(git:*), Bash(npm:*), Bash(npx:*), Bash(gh:*), Read, Edit, Write, Grep, Glob, AskUserQuestion, Task
```

### 9. Agent JSON Output Enforcement

From `/plan-review` pattern and `iterative_planning_agent.md`:

**Prompts must enforce JSON-only output** with this instruction:
```
YOU MUST respond with ONLY this JSON structure:
{ ... }
```

**Handling agent deviations**:
- Agents may include commentary before/after JSON — orchestrator should extract JSON block
- Use defensive parsing: if response isn't clean JSON, look for `{...}` block
- If JSON is malformed → report to user, don't crash. Ask "Retry or proceed?"

**Proposed JSON schema for finalize Explore agents** (simpler than plan-review):
```json
{
  "perspective": "implementation_completeness",
  "critical_gaps": ["Each gap is a string describing a BLOCKING issue"],
  "summary": "1-2 sentence summary of assessment"
}
```

No readiness score needed — finalize is pass/fail (gaps or no gaps), not a 1-5 scoring system.

### 10. Failure Handling for New Steps

Based on existing finalize patterns:

| Scenario | Current Pattern | New Steps Should |
|----------|----------------|------------------|
| No planning file found | Warn and skip verification | Same — skip Step 1 (agent assessment), proceed to Step 2 |
| Agent returns invalid JSON | N/A (new) | Log warning, report to user, ask "Retry or proceed?" |
| Agent times out | N/A (new) | Report partial results, ask user to proceed or retry |
| No test files in diff | N/A (new) | Report which test types are missing, ask user proceed/stop |
| All agents report no gaps | N/A (new) | Display "Plan assessment PASSED" and proceed |
| Some agents report gaps | N/A (new) | Display structured gap report, ask proceed/stop |

**Consistency with existing finalize flow**: The current Step 1d uses `AskUserQuestion` with proceed/stop options when gaps are found. New steps should follow the same pattern for consistency.

### 11. Agent Prompt Design Considerations

Each Explore agent needs context to do its job. The prompt should include:

1. **Planning file path** — so agent can read the plan
2. **Git diff output** — list of changed files (passed as text in prompt, not requiring agent to run git)
3. **Specific perspective** — what this agent should focus on
4. **JSON output template** — exact structure expected

**Why pass git diff in the prompt**: Explore agents have Read/Grep/Glob but not necessarily Bash. Passing the diff output directly avoids each agent needing to run `git diff` independently, saving 4 redundant shell calls.

### 12. Context Efficiency

Key benefit of using Explore agents: each agent runs in its own context window, not consuming the main finalize conversation's context. This is important because finalize already has many steps that use context (rebase, checks, doc updates, PR creation). Moving plan assessment to subagents keeps the main context lean for the subsequent steps.
