---
description: Walk through a project's plan ONE PHASE AT A TIME — user-facing impact + technical plan, with wireframes for UI changes
argument-hint: [phase-number]
allowed-tools: Bash(git:*), Read, Glob, Grep, AskUserQuestion
---

# /plan-walkthrough - Phase-by-Phase Plan Walkthrough

Walk through the active project's planning document one phase at a time. Unlike `/summarize-plan` (which gives a high-level overview of the entire plan), this command zooms into a single phase and explains it in moderate detail with two sections: **User-facing impact** and **Technical plan**. Includes ASCII wireframes when the phase touches UI.

## Usage

```
/plan-walkthrough               # walks Phase 1
/plan-walkthrough 2             # walks Phase 2
/plan-walkthrough 4             # walks Phase 4
```

`phase-number` (optional, default `1`): which phase to walk through. Must be an integer ≥ 1.

## CRITICAL: One Phase Per Invocation

**You MUST walk through ONLY ONE phase per invocation.** Even if the user later asks for "the next phase", that requires a new invocation. Do NOT chain phases together. Do NOT continue past the requested phase. The whole point of this command is sequential discussion — the user is digesting one phase before moving on.

End every walkthrough with: `Ready for Phase [N+1] when you are.` (or, if walking the final phase, a closing note that the plan is complete).

## Execution Steps

### 1. Find Project Folder

Find the active project by matching the current branch against `_status.json` files:

```bash
BRANCH=$(git branch --show-current)
grep -Frl "\"branch\": \"${BRANCH}\"" docs/planning/*/_status.json
```

This returns the path to the matching `_status.json`; strip the filename to get the project folder.

Validation:
- If no matching `_status.json` found, abort with: "Error: No project found for branch '$BRANCH'. Switch to the project's feature branch or run /initialize."
- If multiple matches found (rare), list them and use AskUserQuestion to let the user pick one.

### 2. Read the Planning Doc

Read `*_planning.md` from the project folder. Abort with `"Error: No planning file found in [folder]."` if missing.

### 3. Identify Phases

Locate phase headings in the plan. Phases are typically `### Phase N: [Name]` or `## Phase N — [Name]` (allow either separator and either heading depth, but consistent within a single doc). Build an ordered list of `{phaseNumber, phaseName, lineRange}`.

If the plan has no phase structure (e.g., a flat task list with no `### Phase` headings), abort with: `"Error: This plan has no phase structure. Use /summarize-plan instead."`

### 4. Determine Target Phase

Parse `$ARGUMENTS` as an integer. If it parses cleanly as a non-negative integer, use it. Otherwise default to `1`.

Validate: target phase must exist in the plan. If user requests Phase 9 but the plan has 6 phases, abort with: `"Error: Phase 9 not found. This plan has [N] phases (1–[N])."`

Also extract sub-tasks of the target phase. Sub-tasks are typically `- [ ] **N.X** ...` checkbox lines or sub-headings like `#### N.A — ...`. Capture both the task descriptions and any code/file references.

### 5. Detect UI Changes in the Phase

Scan the target phase's task descriptions for UI signals:
- File paths containing `.tsx`, `/components/`, `/app/admin/`, `page.tsx`, `Renderer.tsx`
- Words: `wizard`, `tab`, `dropdown`, `dialog`, `button`, `field`, `column`, `badge`, `view`, `panel`, `legend`, `tooltip`, `card`, `cell`, `header`, `toolbar`
- Mentions of `<ComponentName>` or `[Component]` patterns

If ANY signal fires, the phase has UI changes — include at least one wireframe in the output.

### 6. Generate the Walkthrough

Output this exact structure:

```
# Phase [N] — [Phase Name]

## User-facing impact

[2-3 short paragraphs explaining what changes from the user's perspective. Who's the user? Usually an admin/operator using the admin UI, but could also be a developer using a CLI, an LLM-pipeline worker, etc. — infer from the phase's task content.]

[Cover: what they can NOW see / do / click / configure that they couldn't before this phase. What does success FEEL like for them?]

[If the phase is purely backend with no observable user-facing change (e.g., a pure refactor), say so plainly: "No user-facing impact — this phase is internal scaffolding for Phase [X]." Then explain what becomes possible later because of this phase.]

[Wireframes here, if UI changes. ASCII box-drawing characters; mark dynamic content with brackets or italics. Show concrete content (real-looking values) — never `[placeholder]`. If there are multiple distinct screens (e.g., wizard step + invocation detail), show each.]

## Technical plan

[2-3 paragraphs of the technical work. Hit: the major components introduced, key file paths, the patterns being followed, anything non-obvious. Do NOT exhaustively re-list every sub-task — the planning doc has those. The walkthrough is supposed to be a conversational explanation that complements the plan, not a summary of it.]

**Tasks at a glance:**
- [Sub-task summary: 1 line each, pulled from the planning doc but lightly compressed. Cover ALL sub-tasks but keep each tight.]
- [...]

## Dependencies

[1-2 sentences: what phases must come before this one, what later phases depend on it. If the phase is self-contained or can run in parallel with another, say so.]

## Done state

[2-3 sentences: a concrete description of what "Phase [N] is finished" looks like. Tests passing? UI rendering correctly? A specific assertion or check the user can run? Be specific enough that the user could grep for it.]

---

Ready for Phase [N+1] when you are.
```

If walking the final phase of the plan, replace the trailing line with:

```
That's the final phase. The plan is complete. Use /summarize-plan for a top-level recap, or /plan-review to validate before implementation.
```

### 7. Wireframe Guidelines

When the phase has UI changes:

- **Use box-drawing characters** (`┌`, `─`, `┐`, `│`, `└`, `┘`, `├`, `┤`, `┬`, `┴`, `┼`, `╔`, `═`, `╗`, `║`, `╚`, `╝`) for boxes. Use `▾` / `▸` for collapsible sections, `●` for filled radios, `◯` for empty.
- **Width budget: ~100 characters max** per line for desktop wireframes; ~60 for mobile. Wider lines wrap awkwardly in chat.
- **Show realistic content** — real-looking values, copy, paths. Avoid `[placeholder]` markers in flowing UI text. Use `[Button]` only for actual button labels.
- **Mark interactive states** when relevant: hover, click, expanded vs collapsed, mode toggles.
- **One wireframe per distinct screen/state**, not one per minor variation. If a tab has 3 modes, show one mode and describe the others in 1 sentence each.
- **Order:** primary surface first (the thing that's mostly NEW in this phase), then secondary surfaces. If the phase touches an existing surface lightly (e.g., adds one column), show just the affected region with `...` indicating elided context.

### 8. Output Length Discipline

- **User-facing impact**: 80–200 words. Tight. Concrete examples > abstract descriptions.
- **Technical plan**: 80–200 words PLUS the bulleted task list (which can be longer if the phase has many sub-tasks).
- **Dependencies**: 1-2 sentences.
- **Done state**: 1-3 sentences.
- **Wireframes**: as long as needed for clarity, but never duplicate wireframes for trivial variations.
- **Total per phase**: aim for 600–1200 words including wireframes. Less for phases without UI; more is OK only when wireframes demand it.

If the phase is a thin one (e.g., "wire the new agent into the agent registry"), don't pad — write a 200-word walkthrough and end. The two-section structure is required even for thin phases, but each section can be short.

### 9. Tone

Conversational, present-tense, second person ("you"). Reference the planning doc's task numbers (`Task 2.A.1`, `Phase 4 task 4.8`) when pointing at specific commitments. Write as if you're walking a teammate through the plan over coffee — informed and grounded, not a marketing pitch and not a dry spec dump.

Avoid:
- Marketing language ("revolutionary", "powerful", "seamless")
- Filler ("It's worth noting that...", "Importantly,...")
- Over-hedging ("might possibly potentially...")
- Restating the plan verbatim

Prefer:
- Specifics over generalities ("the wizard's agent-type dropdown gains an `iterativeEditingAgent` option" > "we add a new option")
- Concrete file paths + line numbers when the plan has them
- Plain English for trade-offs ("3 cycles costs ~$0.024 — comfortable at 30% iteration budget")

## Examples

For a plan with 6 phases, the user invokes the command 6 times across a conversation:

```
User:  /plan-walkthrough
You:   [walks Phase 1, ends with "Ready for Phase 2 when you are."]
User:  /plan-walkthrough 2
You:   [walks Phase 2, ends with "Ready for Phase 3 when you are."]
...
User:  /plan-walkthrough 6
You:   [walks Phase 6, ends with "That's the final phase. The plan is complete..."]
```

The user can also jump non-sequentially (`/plan-walkthrough 4` after Phase 1) — that's fine. Just walk the requested phase and end with the next-phase prompt regardless.
