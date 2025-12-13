# Automated Checks Plan

## Goal
Set up git hooks to **guarantee** these checks run before every commit:
- TypeScript type checking (`npx tsc --noEmit`)
- Linting (`npm run lint`)
- Tests (`npm test`)
- Build (`npm run build`)

## Current State

### What Claude Code Provides
- **CLAUDE.md instructions**: Behavioral guidance (advisory, not enforced)
- **Permission pre-approval**: Makes approved commands run without confirmation
- **Hooks system**: 9 lifecycle hooks that can execute shell commands at various points (PreToolUse, PostToolUse, UserPromptSubmit, Stop, SubagentStop, PreCompact, Notification, SessionStart, SessionEnd)

### Current Configuration
- Global CLAUDE.md already instructs: "After every code block you write, lint, compile and write corresponding tests"
- Permission pre-approvals exist for: `npm test:*`, `npx tsc:*`, `npx eslint:*`
- No git hooks currently configured in project
- ✅ **Claude Code hooks CONFIGURED** (`.claude/settings.json`) - Option 4 implementation:
  - **PostToolUse**: Quick lint of individual files after Edit/Write (~0.5-1s per edit)
  - **Stop**: Full checks (tsc + lint + tests) when Claude finishes, skips for markdown/JSON-only changes

## Claude Code Hooks Capabilities

Claude Code provides **9 lifecycle hooks** that execute shell commands at various workflow stages:

### Available Hook Events

1. **PreToolUse** - Executes before tool calls, can block them
2. **PostToolUse** - Runs after tool calls complete
3. **UserPromptSubmit** - Triggers when users submit prompts, before processing
4. **Stop** - Fires when Claude Code finishes responding
5. **SubagentStop** - Runs when subagent tasks complete
6. **PreCompact** - Executes before compaction operations
7. **Notification** - Activates when Claude Code sends notifications
8. **SessionStart** - Runs at session initiation or resumption
9. **SessionEnd** - Triggers at session termination

### Configuration

Hooks are configured in `.claude/settings.json` (project) or user settings (global). Each hook has:
- **matcher**: Tool name or `*` for all tools
- **type**: Currently "command"
- **command**: Shell command to execute

### Example Use Cases for Quality Checks

**Auto-format on file edits:**
```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Edit",
        "type": "command",
        "command": "npx prettier --write $FILE_PATH"
      }
    ]
  }
}
```

**Type check after code changes:**
```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "*",
        "type": "command",
        "command": "npx tsc --noEmit"
      }
    ]
  }
}
```

**Block sensitive file modifications:**
```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Edit",
        "type": "command",
        "command": "if [[ $FILE_PATH == *'.env'* ]]; then exit 1; fi"
      }
    ]
  }
}
```

### Limitations

- Hooks run only during Claude Code's workflow (not for manual git commits)
- Can be resource-intensive if running full test suites on every tool use
- Require careful review (hooks run with your current environment credentials)

## Comparison: Claude Code Hooks vs Git Hooks

| Aspect | Claude Code Hooks | Git Hooks |
|--------|-------------------|-----------|
| **Scope** | Runs when Claude makes changes | Runs on ALL commits (Claude + manual) |
| **Timing** | During development (immediate feedback) | At commit time (final validation) |
| **Performance** | Can run on each file edit | Runs once per commit |
| **Coverage** | Claude Code sessions only | All git operations |
| **Setup** | .claude/settings.json | .husky/ or .git/hooks/ |
| **Bypass** | Not applicable during session | `git commit --no-verify` |

### Recommended Strategy

**Use BOTH for comprehensive coverage:**
- **Claude Code hooks**: Fast feedback during development (type check, lint on edit)
- **Git hooks**: Final validation before commits (all checks including build)

This provides fast iteration during development while guaranteeing quality at commit time.

## Implementation Approaches

### Option A: Claude Code Hooks Only (Fastest Development)

**Best for**: Projects where Claude Code does most/all development work

**How it works:**
- Type check + lint run after each Edit operation (PostToolUse)
- Tests run when Claude finishes responding (Stop) **only if non-MD files were changed**

**Pros:**
- Instant feedback during development
- Tests run before returning control to user
- Skips tests when only docs/markdown changed
- No commit-time delays
- Simpler setup

**Cons:**
- Doesn't cover manual commits
- No protection if hooks bypassed

**Configuration**: `.claude/settings.json`
```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Edit",
        "type": "command",
        "command": "npx tsc --noEmit && npm run lint"
      }
    ],
    "Stop": [
      {
        "matcher": "*",
        "type": "command",
        "command": "if git diff HEAD --name-only | grep -v '\\.md$' | grep -q .; then npm test; fi"
      }
    ]
  }
}
```

**How the Stop hook works:**
- Checks if there are any changes to non-markdown files
- Only runs tests if code files were modified
- Skips tests if only markdown files changed or no files changed

### Option B: Git Hooks Only (Complete Coverage)

**Best for**: Teams with mixed manual/automated development

**Pros:**
- Guarantees checks on ALL commits
- Standard git workflow
- Works for all developers

**Cons:**
- Slower commits (especially with build)
- No feedback until commit time

**See detailed setup below** (husky configuration)

### Option C: Both (Recommended)

**Best for**: Projects requiring both speed and guarantees

**Pros:**
- Fast feedback during development (Claude hooks)
- Final validation before commits (git hooks)
- Comprehensive quality assurance

**Cons:**
- More initial setup
- Potential duplicate check runs

**Setup**: Configure both Claude Code hooks (Option A) AND git hooks (Option B)

## Implementation Plan: Git Hooks (Option B/C)

### 1. Install Dependencies
```bash
npm install --save-dev husky lint-staged
npx husky init
```

### 2. Configure Pre-commit Hook

Create `.husky/pre-commit`:
```bash
#!/usr/bin/env sh
. "$(dirname -- "$0")/_/husky.sh"

echo "Running pre-commit checks..."

# Type check
echo "1/4 TypeScript type checking..."
npx tsc --noEmit || exit 1

# Lint
echo "2/4 Linting..."
npm run lint || exit 1

# Tests
echo "3/4 Running tests..."
npm test || exit 1

# Build
echo "4/4 Building..."
npm run build || exit 1

echo "All checks passed!"
```

### 3. Update package.json

Add to `package.json`:
```json
{
  "scripts": {
    "prepare": "husky"
  },
  "lint-staged": {
    "*.{ts,tsx}": [
      "npx tsc --noEmit",
      "npm run lint",
      "npm test -- --findRelatedTests"
    ]
  }
}
```

### 4. Optional: Enhanced Project CLAUDE.md

Add to project-level `CLAUDE.md`:
```markdown
## Code Quality Checks
- After editing TypeScript files: run `npx tsc --noEmit` to check types
- After editing components: run related tests
- Before committing: all checks will run automatically via git hook
- If checks fail during development, fix before attempting commit

## Pre-commit Hook
Git hook will automatically run:
1. TypeScript type check
2. Linting
3. Full test suite
4. Production build

All must pass for commit to succeed.
```

### 5. Test Setup
```bash
# Make a trivial change
echo "// test" >> src/test-file.ts

# Attempt commit
git add src/test-file.ts
git commit -m "test: verify pre-commit hook"

# Verify hook runs and checks execute
# Clean up test file
```

## Implementation Plan: Claude Code Hooks (Option A/C)

### 1. Create Project Settings

Create or update `.claude/settings.json` in project root:

**Full configuration** (type check after edits, conditional tests before returning):

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Edit",
        "type": "command",
        "command": "npx tsc --noEmit || echo 'Type check failed'"
      },
      {
        "matcher": "Write",
        "type": "command",
        "command": "npx tsc --noEmit || echo 'Type check failed'"
      }
    ],
    "Stop": [
      {
        "matcher": "*",
        "type": "command",
        "command": "if git diff HEAD --name-only | grep -v '\\.md$' | grep -q .; then npm run lint && npm test; else echo 'No code changes, skipping tests'; fi"
      }
    ]
  }
}
```

**Conditional test logic:**
- `git diff HEAD --name-only`: Lists all changed files
- `grep -v '\\.md$'`: Excludes markdown files
- `grep -q .`: Checks if any files remain
- Only runs lint + tests if non-MD files were changed

### 2. Alternative: Exclude Additional File Types

To skip tests for more file types (markdown, JSON, YAML config files):

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Edit",
        "type": "command",
        "command": "npx tsc --noEmit || echo 'Type check failed'"
      }
    ],
    "Stop": [
      {
        "matcher": "*",
        "type": "command",
        "command": "if git diff HEAD --name-only | grep -vE '\\.(md|json|ya?ml)$' | grep -q .; then npm test; else echo 'No code changes, skipping tests'; fi"
      }
    ]
  }
}
```

### 3. Alternative: Lighter Configuration (Type Check Only)

For faster feedback without any test runs:

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "*",
        "type": "command",
        "command": "npx tsc --noEmit"
      }
    ]
  }
}
```

### 4. Test Setup

```bash
# Test 1: Code changes trigger tests
# - Ask Claude to make a code change
# - Verify PostToolUse hook runs after Edit (type check)
# - Verify Stop hook runs tests before returning

# Test 2: Markdown changes skip tests
# - Ask Claude to edit only .md files
# - Verify Stop hook skips tests (should see "No code changes" message)

# Test 3: No changes skip tests
# - Ask Claude a question without making edits
# - Verify Stop hook skips tests
```

### 5. Performance Tuning

**Fast checks (recommended):**
- Type checking: ~2-5 seconds
- Linting: ~1-3 seconds

**Slower checks:**
- Full test suite: ~10-30 seconds
- Build: ~30-60 seconds

**Performance benefits of conditional tests:**
- Docs-only sessions: No test overhead
- Question-only sessions: No test overhead
- Code sessions: Tests run once at end (not per file)

**Recommendation**: Use PostToolUse for fast checks (type, lint), use conditional Stop hook for tests.

## Implementation Steps

### For Option A (Claude Code Hooks Only)

1. **Create `.claude/settings.json`** with:
   - PostToolUse hooks for type check + lint (runs after each edit)
   - Stop hook for tests (runs before Claude returns)
2. **Test** by asking Claude to make code changes
3. **Verify** hooks run at correct times and catch errors

**Time**: 2-5 minutes

### For Option B (Git Hooks Only)

1. **Install husky & lint-staged**: `npm install --save-dev husky lint-staged && npx husky init`
2. **Create pre-commit hook** in `.husky/pre-commit` with all checks
3. **Update package.json** with prepare script and lint-staged config
4. **Test** with trial commit

**Time**: 10-15 minutes

### For Option C (Both - Recommended)

1. **Setup Claude Code hooks** (Option A steps)
2. **Setup git hooks** (Option B steps)
3. **Configure to avoid duplication**:
   - Claude hooks: Fast checks only (type, lint)
   - Git hooks: Complete validation (type, lint, test, build)
4. **Test both** workflows

**Time**: 15-20 minutes

## Considerations

### Performance
- **Build check is slow**: ~30-60 seconds on every commit
- Alternative: Run build only in CI, use faster checks in pre-commit
- Can configure different hooks for different scenarios

### Flexibility
- Emergency bypass: `git commit --no-verify` (use sparingly)
- Can configure different checks for different file types via lint-staged
- Can create separate hooks: pre-commit (fast checks) vs pre-push (build)

### Alternative: Split Fast/Slow Checks

**Pre-commit (fast checks only):**
```bash
npx tsc --noEmit
npm run lint
npm test
```

**Pre-push (includes build):**
```bash
npm run build
```

This keeps commits fast while ensuring builds work before pushing.

## Recommendations

### For Solo Developers Using Primarily Claude Code
**→ Option A or C**
- Start with Claude Code hooks for instant feedback
- Add git hooks if you make manual commits or want final validation

### For Teams or Mixed Development
**→ Option B or C (Required)**
- Git hooks are essential to cover all developers
- Claude Code hooks optional but improve individual developer experience

### For Maximum Quality Assurance
**→ Option C (Both)**
- Claude Code hooks: Fast feedback loop (type, lint on every edit)
- Git hooks: Guarantee before commits (all checks including build)
- CI/CD: Final safety net even if hooks bypassed

### Performance Considerations
- If build time is slow (>30s), consider:
  - Claude hooks: type + lint only
  - Git pre-commit: type + lint + tests
  - Git pre-push: build
  - CI/CD: full validation including build

### Starting Point
**Recommended**: Start with **Option C** (both hooks), fast checks only in Claude hooks. Add slower checks to git hooks as needed.

## CI/CD Safety Net

Even with git hooks, recommend GitHub Actions for final validation:
- Hooks can be bypassed with `--no-verify`
- CI catches issues if hooks skipped
- Provides clean integration with PR workflow

## Implementation Timeline

1. **Install & configure** (5 min)
2. **Test & verify** (5 min)
3. **Optional CLAUDE.md updates** (2 min)
4. **Team documentation** (if needed)

Total: ~10-15 minutes

## Success Criteria

### For Claude Code Hooks (Option A/C)
- [ ] `.claude/settings.json` configured with PostToolUse hooks
- [ ] Type check runs automatically after Edit/Write operations
- [ ] Errors are caught and reported immediately
- [ ] Hooks execute without blocking development flow

### For Git Hooks (Option B/C)
- [ ] Husky installed and initialized
- [ ] Pre-commit hook created and executable
- [ ] All four checks run on commit attempt
- [ ] Failed checks block commit
- [ ] Successful checks allow commit
- [ ] Hook works for both manual and Claude Code commits

### For Combined Approach (Option C)
- [ ] Both hook systems configured and tested
- [ ] No unnecessary duplicate checks
- [ ] Fast feedback during development (Claude hooks)
- [ ] Final validation before commits (git hooks)
