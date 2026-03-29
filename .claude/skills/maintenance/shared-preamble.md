## Maintenance Skill Protocol

You are running as an automated maintenance check. Follow this protocol exactly:

### Research Pattern (4 rounds × 4 agents)
For each round, spawn 4 Explore agents in parallel with different investigation angles.
Wait for all agents to complete before starting the next round.

- **Round 1: Discovery** — broad scan of the target area, identify all relevant files and patterns
- **Round 2: Deep Dive** — investigate the most promising findings from Round 1 in detail
- **Round 3: Cross-Reference** — validate findings against related code, tests, and docs
- **Round 4: Synthesis** — prioritize findings by severity/impact, draft recommendations

### Output Format
Write a markdown report to the specified report file with:
1. **Executive Summary** (3-5 bullets)
2. **Findings** (ranked by severity: Critical > High > Medium > Low)
3. **Recommendations** (actionable items with specific file paths)
4. **Files Examined** (list of all files read)
5. **Agent Research Log** (key findings from each round)

### Constraints
- Only modify the report file (the _research.md specified in your prompt)
- Commit only the project folder when done (as instructed in your prompt)
- No pushes, no branch changes, no modifications outside the project folder
- Stay within budget ($5 per skill run)
- Complete within 150 turns
