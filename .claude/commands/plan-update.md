---
description: Scan planning doc for checkbox completeness, enforce verification requirements, and update checkboxes
argument-hint: [project-name]
allowed-tools: Bash(git:*), Read, Edit, Glob, Grep, AskUserQuestion
---

# /plan-update - Planning Doc Checkbox Audit & Update

Scan a planning doc for checkbox completeness, enforce verification requirements, validate test paths, and update checkboxes.

## Usage
```
/plan-update [project-name]
```

## Execution Steps

### 1. Locate Project and Planning File

**With argument**: Direct match by project name.
```bash
# Try glob match
```
Use `Glob("docs/planning/*${ARGUMENTS}*/*_planning.md")` to find the planning file.

**Without argument**: Derive from current branch.
```bash
BRANCH=$(git branch --show-current)
BRANCH_TYPE="${BRANCH%%/*}"
PROJECT_NAME="${BRANCH#*/}"
```

Try in order:
1. `grep -Frl "\"branch\": \"${BRANCH}\"" docs/planning/*/_status.json` — primary lookup by branch field in _status.json
2. **Fallback** if grep finds nothing (some older _status.json files lack a `branch` key): `Glob("docs/planning/*${PROJECT_NAME}*/*_planning.md")` — match by project name directly

If no planning file found → abort with: "Error: No planning file found for project '${PROJECT_NAME}'. Run /initialize first."

Read the planning file content.

### 2. Checkbox Scanning (Code-Fence Aware)

Parse the planning doc for all actionable items. **Skip lines inside fenced code blocks** to avoid false positives on example checkbox syntax.

**Code-fence tracking logic:**
- Track open/close state: when a line starts with ``` (triple backtick), toggle fence state
- While inside a fenced block, skip all lines — do not count checkboxes
- Only scan lines outside fenced blocks

**Scan for:**
- Lines matching `- [ ]` (unchecked items)
- Lines matching `- [x]` or `- [X]` (checked items)
- Lines in actionable sections (Options Considered, Phased Execution Plan, Testing, Verification, Documentation Updates) that are list items (`- `) but lack checkbox prefix

### 3. Checkbox Enforcement

For each actionable section (Options Considered, Phased Execution Plan, Testing, Verification, Documentation Updates):

1. Identify list items (`- `) that lack checkbox prefix (`- [ ]` or `- [x]`)
2. Report missing checkboxes with line numbers
3. Use AskUserQuestion: "Found N items without checkboxes in [section]. Add checkboxes?"
   - "Yes, add checkboxes" → Edit the planning doc to add `- [ ]` prefix
   - "Skip" → continue without adding

### 4. Test Path Validation

Check the Testing section for specific file paths:

1. Scan for test items under Unit Tests, Integration Tests, E2E Tests subsections
2. Verify each test item includes a specific file path (e.g., `src/lib/services/foo.test.ts`), not just a generic description
3. If any test items lack file paths → warn: "Test item '[description]' has no file path. Add specific test file path for trackability."

### 5. Bug-Test Validation

If the plan mentions bug fixes (search for keywords: "bug", "fix", "regression", "broken", "issue"):

1. Check for corresponding regression test items in the Testing section
2. If bug fixes exist without regression tests → warn: "Plan mentions bug fix '[description]' but no regression test item found. Add a regression test checkbox."

### 6. Verification Section Validation

Check that the Verification section exists and has substance:

1. **Section exists?** Look for `## Verification` heading (outside code fences)
2. **Has content?** At least one of:
   - A) Playwright verification items (for UI changes)
   - B) Automated test items with specific file paths or commands
3. **If section missing**: Use AskUserQuestion:
   - "Planning doc has no Verification section. Plans require verification (Playwright for UI, automated tests for logic). How to proceed?"
   - Options: "Add Verification section now" / "Reject plan — cannot proceed without verification"
4. **If section exists but empty or missing both A and B**: Same prompt as above
5. **UI detection**: If plan touches files matching `src/app/**`, `src/components/**`, `*.tsx` patterns → Playwright verification is required. Flag if missing.

### 7. Checkbox Update

Allow the user to mark items as complete:

1. Display all unchecked items grouped by section with index numbers
2. Use AskUserQuestion (multiSelect): "Select items to mark as complete:"
   - List each unchecked item
3. For selected items, Edit the planning doc to change `- [ ]` to `- [x]`

### 8. Summary Output

Display a summary:

```
Plan Update Summary — [project name]
──────────────────────────────────────
Section                    Checked  Unchecked
Options Considered         N        N
Phased Execution Plan      N        N
Testing                    N        N
Verification               N        N
Documentation Updates      N        N
──────────────────────────────────────
Total                      N        N

Issues:
- [list any warnings from steps 3-6]

Unchecked items:
1. [Phase 1] Item description
2. [Testing] Item description
...
```
