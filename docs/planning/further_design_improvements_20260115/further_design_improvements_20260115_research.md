# Further Design Improvements Research

**Date**: 2026-01-15
**Git Commit**: 15b136375f4bd54a1537aee4db6b3602fd37ca4a
**Branch**: fix/further_design_improvements_20260115

## Problem Statement

Assess the current design system implementation to identify:
1. How consistently the "Midnight Scholar" design system is applied
2. Opportunities to enforce design consistency via Claude Code hooks
3. How to extend the home page typography style elsewhere
4. Opportunities for animations and icons
5. How to create more contrast between top nav, results page, and AI panel

## High Level Summary

The codebase has **strong design system adoption** (90%+ in production code) with comprehensive CSS variable-based theming. Key opportunities exist for:
- **Darker navigation bar** to create visual hierarchy
- **Typography extension** - the `atlas-display` + `atlas-ui` pattern from home page could enhance other areas
- **Contrast improvements** - currently nav/panel/content have very subtle contrast
- **Hook-based enforcement** - Claude Code PreToolUse hooks can validate design tokens before code is written
- **Minor inconsistencies** to fix - undefined `--status-error` tokens, some hardcoded colors in error pages

---

## Documents Read

- `docs/docs_overall/design_style_guide.md` - Complete design system reference
- `docs/docs_overall/getting_started.md` - Documentation structure
- `docs/docs_overall/architecture.md` - System architecture
- `docs/docs_overall/project_workflow.md` - Project workflow

## Code Files Read

### Home Page Typography
- `src/app/page.tsx` (lines 42-48) - Main title and subtitle implementation
- `src/app/globals.css` (lines 1691-1754) - `.atlas-display`, `.atlas-ui`, animations
- `src/app/layout.tsx` (lines 10-29) - Font definitions

### Navigation
- `src/components/Navigation.tsx` (167 lines) - Main nav component
- `src/components/SearchBar.tsx` (206 lines) - Nav search variant
- `src/contexts/ThemeContext.tsx` (109 lines) - Theme management

### Results Page
- `src/app/results/page.tsx` (1290 lines) - Full results page implementation
- `src/components/explore/ExplanationCard.tsx` - Gallery card styling
- `tailwind.config.ts` (lines 68-152) - Shadow system, typography config

### AI Suggestion Panel
- `src/components/AIEditorPanel.tsx` (832 lines) - Main panel component
- `src/components/ai-panel-variants.ts` (208 lines) - Style definitions
- `src/components/AdvancedAIEditorModal.tsx` - Modal variant
- `src/contexts/PanelVariantContext.tsx` (72 lines) - Variant context

### Design Consistency
- Multiple component files for pattern analysis
- `src/components/sources/SourceChip.tsx`, `SourceInput.tsx`, `FailedSourcesModal.tsx`
- `src/app/error.tsx`, `src/app/global-error.tsx`
- Debug pages in `src/app/(debug)/`

---

## Detailed Findings

### 1. Home Page Typography ("Explain Anything")

**Location**: `src/app/page.tsx:42-48`

```tsx
<h1 className="atlas-display text-[var(--text-primary)] mb-4 atlas-animate-fade-up stagger-1">
    Explain Anything
</h1>
<p className="atlas-ui text-[var(--text-muted)] tracking-wide atlas-animate-fade-up stagger-2">
    Learn about any topic, simply explained
</p>
```

**Typography Classes** (`src/app/globals.css:1691-1705`):

| Class | Font | Size | Weight | Letter-spacing |
|-------|------|------|--------|----------------|
| `.atlas-display` | Playfair Display | 3.5rem | 500 | 0.01em |
| `.atlas-ui` | DM Sans | 0.875rem | 400 | 0.02em |

**Animation** (`src/app/globals.css:1740-1754`):
- `atlas-animate-fade-up`: 0.5s ease-out, translateY(10px→0) + opacity(0→1)
- Stagger delays: `stagger-1` = 0ms, `stagger-2` = 40ms

**Opportunities to Apply Elsewhere**:
- Results page title could use `atlas-display` instead of plain `font-display`
- Section headers throughout could benefit from the same animation pattern
- Explore page headings could adopt this style

---

### 2. Top Navigation Analysis

**Location**: `src/components/Navigation.tsx`

**Current Styling**:
```tsx
<nav className="scholar-nav bg-[var(--surface-secondary)] border-b border-[var(--border-default)] relative">
```

**Current Colors**:

| Mode | Background | Border |
|------|------------|--------|
| Light | `#ffffff` (pure white) | `#e8e4dc` (parchment) |
| Dark | `#121f36` (mahogany) | `#2a3a57` (shelf shadow) |

**Contrast Issue**: Navigation (`#ffffff`) on page background (`#faf7f2`) has minimal contrast - relies on subtle border and `shadow-warm` for separation.

**Gold Accent Line** (`Navigation.tsx:144`):
```tsx
<div className="absolute bottom-0 left-0 right-0 h-[2px] bg-gradient-to-r from-transparent via-[var(--accent-gold)] to-transparent opacity-60">
```

**Opportunity for Darker Nav**:
Current nav uses `surface-secondary` (lightest surface). Options for darker nav:
1. Use `surface-elevated` (`#f5f0e6` light / `#1a2a47` dark)
2. Create new `surface-nav` token with darker value
3. Use a semi-transparent dark overlay

---

### 3. Results Page Design

**Location**: `src/app/results/page.tsx`

**Page Background** (line 920):
```tsx
<div className="h-screen bg-[var(--surface-primary)] flex flex-col">
```

**Content Card** (line 1252):
```tsx
<div className="scholar-card p-6">
```

**Color Hierarchy** (Light Mode):
| Element | Color | Hex |
|---------|-------|-----|
| Page background | `--surface-primary` | `#faf7f2` |
| Content card | `--surface-secondary` | `#ffffff` |
| AI Panel | `--surface-elevated` | `#f5f0e6` |
| Nav bar | `--surface-secondary` | `#ffffff` |

**Current Contrast Problem**: Nav and content card both use `#ffffff` - no visual distinction.

---

### 4. AI Suggestion Panel Analysis

**Location**: `src/components/AIEditorPanel.tsx`, `src/components/ai-panel-variants.ts`

**Current Styling** (ai-panel-variants.ts:66-70):
```
bg-[var(--surface-elevated)]
border-l border-[var(--border-default)]
shadow-warm-lg
```

**Panel Width**: 360px when open, 0 when collapsed

**Recent Changes** (commit 100ff0f):
- Simplified from 5 design variants to 1 "lined-paper" variant
- Increased section label size to `text-sm`
- Added `shadow-warm-lg` for stronger visual pop
- Stronger border dividers (`border-t-2`)

**Current Colors** (Light Mode):
- Background: `#f5f0e6` (surface-elevated)
- Left border: `#e8e4dc` (border-default)

**Contrast with Results Page**: Panel (`#f5f0e6`) vs page (`#faf7f2`) = very subtle ~3% luminance difference

---

### 5. Design System Consistency Assessment

**Strong Adoption (90%+ compliance in production)**:
- CSS variable color tokens: ~250+ consistent usages
- Shadow tokens (`shadow-warm-*`): 88 instances
- Border radius tokens (`rounded-page`, `rounded-book`): 88 instances
- Typography tokens (`font-display`, `font-body`, `font-ui`): 100+ instances

**Issues Found**:

| Issue | Files Affected | Fix |
|-------|---------------|-----|
| Undefined `--status-error` token | SourceChip.tsx, SourceInput.tsx, FailedSourcesModal.tsx, AdvancedAIEditorModal.tsx, TagSelector.tsx | Replace with `--destructive` |
| Hardcoded hex colors | error.tsx, global-error.tsx | Use design tokens |
| Hardcoded input bg `#f7f3eb` | ai-panel-variants.ts, AdvancedAIEditorModal.tsx | Consider adding `--surface-input` token |
| Standard Tailwind shadows | UI components, ToolbarPlugin.tsx | Use `shadow-warm-*` variants |
| Generic `font-sans`/`font-serif` | results/page.tsx, login/page.tsx | Use `font-ui`/`font-body` |

**Debug Pages**: Extensively use standard Tailwind values (acceptable for internal tooling)

---

### 6. Claude Code Hooks for Design Enforcement

#### 6.1 Existing Hook Infrastructure

The project already has a robust hook system for enforcing documentation reads:

**Configuration**: `.claude/settings.json`

**Current Flow**:
1. `track-prerequisites.sh` (PostToolUse on Read/TodoWrite) - Tracks when docs are read
2. `check-workflow-ready.sh` (PreToolUse on Edit/Write) - Blocks edits until prerequisites met
3. `_status.json` in each project folder - Stores prerequisite timestamps

**Currently Tracked Documents**:
- `getting_started.md` → `prerequisites.getting_started_read`
- `project_workflow.md` → `prerequisites.project_workflow_read`
- `testing_overview.md` → `prerequisites.testing_overview_read` (for test files only)

**Key Files**:
- `.claude/hooks/track-prerequisites.sh:61-68` - Doc read tracking
- `.claude/hooks/check-workflow-ready.sh:183-217` - Test file prerequisite check pattern

**Status File Format** (`_status.json`):
```json
{
  "project": "project_name",
  "branch": "branch_name",
  "created_at": "2026-01-10T14:49:33Z",
  "prerequisites": {
    "getting_started_read": "2026-01-10T14:49:50Z",
    "project_workflow_read": "2026-01-10T14:49:50Z",
    "design_style_guide_read": null  // <-- ADD THIS
  }
}
```

#### 6.2 Implementation Plan for Design Style Guide Enforcement

**Step 1**: Update `track-prerequisites.sh` to track design_style_guide.md reads:
```bash
# Add to line 67 (after testing_overview.md check):
elif [[ "$FILE_PATH" == *"design_style_guide.md"* ]]; then
  FIELD_TO_UPDATE=".prerequisites.design_style_guide_read"
```

**Step 2**: Add `is_frontend_file()` function to `check-workflow-ready.sh`:
```bash
is_frontend_file() {
  local path="$1"
  # Component files
  [[ "$path" == *"/components/"* ]] && return 0
  # App pages (TSX files)
  [[ "$path" == *"/app/"* ]] && [[ "$path" == *.tsx ]] && return 0
  # Styling files
  [[ "$path" == *.css ]] && return 0
  [[ "$path" == *"tailwind.config"* ]] && return 0
  # Editor files (Lexical)
  [[ "$path" == *"/editorFiles/"* ]] && return 0
  # Hooks (often contain UI logic)
  [[ "$path" == *"/hooks/"* ]] && return 0
  return 1
}
```

**Step 3**: Add prerequisite check (similar to test file pattern at line 202):
```bash
if is_frontend_file "$FILE_PATH"; then
  DESIGN_STYLE_GUIDE_READ=$(jq -r '.prerequisites.design_style_guide_read // empty' "$STATUS_FILE" 2>/dev/null)

  if [ -z "$DESIGN_STYLE_GUIDE_READ" ]; then
    cat << 'EOF'
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "deny",
    "permissionDecisionReason": "Frontend file prerequisite not met.\n\nBefore editing frontend files, read:\n  /docs/docs_overall/design_style_guide.md\n\nThis ensures familiarity with:\n- Midnight Scholar design system\n- CSS variable tokens (--surface-*, --accent-*, --text-*)\n- Typography tokens (font-display, font-body, font-ui)\n- Shadow system (shadow-warm-*)\n- Border radius tokens (rounded-page, rounded-book)"
  }
}
EOF
    exit 0
  fi
fi
```

#### 6.3 Additional Design Validation Hook (Optional)

**Hook Types Available**:
- `PreToolUse` - Can block/modify Edit/Write operations
- `PostToolUse` - Can run linting after changes

**Example PreToolUse Hook for Design Validation**:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [
          {
            "type": "command",
            "command": "${CLAUDE_PROJECT_DIR}/scripts/validate-design-system.sh"
          }
        ]
      }
    ]
  }
}
```

**Validation Script Pattern**:
```bash
#!/bin/bash
INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path')
CONTENT=$(echo "$INPUT" | jq -r '.tool_input.content')

# Check for violations
if echo "$CONTENT" | grep -qE 'bg-(red|blue|green)-[0-9]+'; then
    echo '{"decision": "deny", "reason": "Use design tokens instead of arbitrary colors"}'
    exit 0
fi
exit 0
```

**Key Enforcement Opportunities**:
1. Block arbitrary Tailwind colors (require `var(--*)` tokens)
2. Require `shadow-warm-*` instead of standard shadows
3. Require `rounded-page`/`rounded-book` instead of arbitrary radii
4. Flag `font-sans`/`font-serif` in favor of semantic tokens

**Documentation**:
- https://code.claude.com/docs/en/hooks
- https://code.claude.com/docs/en/hooks-guide

---

### 7. Animation & Icon Opportunities

**Existing Animations** (globals.css):

| Animation | Duration | Usage |
|-----------|----------|-------|
| `atlasFadeUp` | 0.5s | Home page entrance |
| `cardEntrance` | 0.5s | Gallery cards (staggered) |
| `inkDrop` | 1.4s | Loading dots |
| `flourishDraw` | 0.8s | Title underline |
| `candleFlicker` | 3s | Dark mode glow |
| `warmGlowPulse` | 2s | Pulsing gold glow |

**Underutilized Animations**:
- `text-reveal-blur`, `text-reveal-fade`, `text-reveal-ink` (defined but rarely used)
- `quill-write` (loading indicator, could be used more)
- `page-turn` (page transitions, not implemented)
- `bookmark-flutter` (bookmark interactions, not implemented)

**Icon Opportunities**:
- Results page actions could have icons (currently text-only buttons)
- Navigation links could have small icons
- Section headers could have decorative icons
- Success/error states could have animated icons

---

### 8. Contrast Improvement Strategy

**Current Light Mode Hierarchy** (ascending brightness):

| Element | Token | Hex | L* |
|---------|-------|-----|-----|
| AI Panel | surface-elevated | #f5f0e6 | 95.2 |
| Page BG | surface-primary | #faf7f2 | 97.3 |
| Nav/Cards | surface-secondary | #ffffff | 100 |

**Problem**: Hierarchy is inverted - content cards and nav are brightest, panel is darker than page.

**Proposed Hierarchy** (for better visual separation):

| Element | Proposed Token | Goal |
|---------|---------------|------|
| Nav bar | New `surface-nav` | Darker, more authoritative |
| Page BG | surface-primary | Warm cream (keep) |
| Content cards | surface-secondary | White (keep) |
| AI Panel | surface-elevated | Slightly darker (keep or increase) |

**Concrete Options for Darker Nav**:

1. **Light mode**: Use `#f0ebe0` or `#e8e4dc` (more parchment-like)
2. **Dark mode**: Use `#0a1628` (matching page bg) or darker `#060d17`
3. **Add visual weight**: Stronger bottom border, subtle gradient, or paper texture

---

## Code References

### Typography
- `src/app/page.tsx:42-48` - Home page title implementation
- `src/app/globals.css:1691-1705` - atlas-display, atlas-ui classes
- `src/app/globals.css:1740-1754` - Animation keyframes

### Navigation
- `src/components/Navigation.tsx:57-164` - Main nav structure
- `src/components/Navigation.tsx:144` - Gold accent line
- `src/app/globals.css:1600-1641` - scholar-nav classes

### Results Page
- `src/app/results/page.tsx:920` - Page container
- `src/app/results/page.tsx:1046` - Title styling
- `src/app/results/page.tsx:1252` - Content card

### AI Panel
- `src/components/AIEditorPanel.tsx:466-475` - Panel container
- `src/components/ai-panel-variants.ts:60-192` - Style definitions

### Design Tokens
- `src/app/globals.css:63-219` - All CSS variables
- `tailwind.config.ts:68-81` - Shadow definitions
- `tailwind.config.ts:84-85` - Border radius tokens

---

## Recommendations for Planning Phase

### Theme 1: Contrast & Visual Hierarchy

#### 1.1 Create Darker Navigation Bar (High Priority)
**Goal**: Give navigation more visual weight and create clear separation from content.

**Option A - New Token Approach** (Recommended):
- Add `--surface-nav` token to `globals.css`
- Light mode: `#f0ebe0` (warmer parchment) or `#e8e4dc` (border color, stronger)
- Dark mode: `#0d1a2d` (slightly darker than current `#121f36`)

**Option B - Use Existing Token**:
- Switch nav from `bg-[var(--surface-secondary)]` to `bg-[var(--surface-elevated)]`
- Light: `#f5f0e6` / Dark: `#1a2a47`

**Files to modify**:
- `src/app/globals.css` - Add new token (if Option A)
- `src/components/Navigation.tsx:57` - Change background class

**Visual Enhancement Options**:
- Add `paper-texture` class to nav for subtle grain
- Increase gold accent line opacity from 60% to 80%
- Add subtle gradient: `bg-gradient-to-b from-[var(--surface-nav)] to-[var(--surface-primary)]`

#### 1.2 Enhance AI Panel Contrast (Medium Priority)
**Current**: Panel uses `surface-elevated` (`#f5f0e6`) - only ~3% contrast with page.

**Options**:
- Increase `shadow-warm-lg` to `shadow-warm-xl` for more depth
- Add subtle left border gradient (gold → copper)
- Consider darker panel background: `#f0ebe0` or new `--surface-panel` token

**Files to modify**:
- `src/components/ai-panel-variants.ts:66-70`

---

### Theme 2: Typography Extension

#### 2.1 Apply Atlas Typography to Results Page (High Priority)
**Goal**: Bring the elegant "Explain Anything" style to the results page title.

**Current** (`src/app/results/page.tsx:1046`):
```tsx
<h1 className="text-3xl font-display font-bold text-[var(--text-primary)] leading-tight">
```

**Proposed**:
```tsx
<h1 className="atlas-display text-[var(--text-primary)] atlas-animate-fade-up stagger-1">
```

**Additional locations to consider**:
- Explore page heading (`src/components/explore/ExploreGalleryPage.tsx`)
- Settings page title (`src/app/settings/SettingsContent.tsx`)
- Login page title (`src/app/login/page.tsx`)

#### 2.2 Standardize Font Class Usage (Medium Priority)
**Replace generic Tailwind font classes with semantic tokens**:

| Current | Replace With |
|---------|--------------|
| `font-sans` | `font-ui` |
| `font-serif` | `font-body` |

**Files to update**:
- `src/app/results/page.tsx` (lines 994, 1042, 1053, 1093, 1125, 1141, 1151, 1161, 1170, 1178, 1189)
- `src/app/login/page.tsx` (lines 136, 146, 163, 187)
- `src/components/explore/ExploreGalleryPage.tsx` (lines 71, 91, 94, 99)

---

### Theme 3: Design System Consistency Fixes

#### 3.1 Fix Undefined Token References (High Priority)
**Issue**: `--status-error` and `--status-warning` are used but not defined in `globals.css`.

**Files to fix** (replace `var(--status-error)` with `var(--destructive)`):
- `src/components/sources/SourceChip.tsx` (lines 36, 61, 78)
- `src/components/sources/SourceInput.tsx` (lines 141, 161)
- `src/components/sources/FailedSourcesModal.tsx` (lines 41-42, 68, 70, 77)
- `src/components/AdvancedAIEditorModal.tsx` (line 285)
- `src/components/TagSelector.tsx` (line 153)

**Alternative**: Define the missing tokens in `globals.css`:
```css
--status-error: var(--destructive);
--status-warning: #d4a853; /* or a distinct warning color */
```

#### 3.2 Fix Hardcoded Colors in Error Pages (Medium Priority)
**Files**: `src/app/error.tsx`, `src/app/global-error.tsx`

**Current hardcoded values**:
- `#f8f9fa` → `var(--surface-primary)`
- `#1a1a2e` → `var(--text-primary)`
- `#666` → `var(--text-muted)`
- `#4f46e5` → `var(--accent-gold)` or `var(--accent-blue)`

#### 3.3 Standardize Shadow Usage (Low Priority)
**Replace standard Tailwind shadows with warm variants**:

| Current | Replace With |
|---------|--------------|
| `shadow-sm` | `shadow-warm-sm` |
| `shadow-md` | `shadow-warm-md` |
| `shadow-lg` | `shadow-warm-lg` |
| `shadow-xl` | `shadow-warm-xl` |

**Files to update**:
- `src/components/ui/dialog.tsx` (line 41)
- `src/components/ui/select.tsx` (lines 22, 78)
- `src/components/TagSelector.tsx` (line 184)
- `src/components/AdvancedAIEditorModal.tsx` (line 267)
- `src/editorFiles/lexicalEditor/ToolbarPlugin.tsx` (lines 179, 389)

#### 3.4 Create Input Background Token (Low Priority)
**Issue**: `#f7f3eb` is hardcoded for input backgrounds.

**Solution**: Add to `globals.css`:
```css
--surface-input: #f7f3eb; /* Light: between primary and elevated */
```
Dark mode equivalent: `#0d1a2d`

**Files to update**:
- `src/components/ai-panel-variants.ts` (line 47)
- `src/components/AdvancedAIEditorModal.tsx` (line 137)

---

### Theme 4: Animations & Icons

#### 4.1 Add Icons to Results Page Actions (Medium Priority)
**Current buttons are text-only**. Add icons for clarity:

| Button | Suggested Icon |
|--------|---------------|
| Rewrite | `PencilSquareIcon` or `SparklesIcon` |
| Save | `BookmarkIcon` |
| Edit | `PencilIcon` |
| Publish | `GlobeAltIcon` or `ArrowUpOnSquareIcon` |
| View Related | `LinkIcon` or `ArrowRightIcon` |

**Icon library**: Continue using Heroicons (already in use).

#### 4.2 Extend Entrance Animations (Low Priority)
**Apply `atlas-animate-fade-up` to more elements**:
- Results page title (with `stagger-1`)
- Results page subtitle/metadata (with `stagger-2`)
- Action buttons row (with `stagger-3`)
- Content card (with `stagger-4`)

**Consider implementing unused animations**:
- `text-reveal-ink` for content loading
- `bookmark-flutter` for save interactions
- `warmGlowPulse` for success states

---

### Theme 5: Design System Automation

#### 5.1 Implement PreToolUse Validation Hook (High Priority)
**Goal**: Automatically catch design system violations before code is written.

**Create** `.claude/settings.json` entry:
```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [
          {
            "type": "command",
            "command": "${CLAUDE_PROJECT_DIR}/scripts/validate-design-system.sh"
          }
        ]
      }
    ]
  }
}
```

**Create** `scripts/validate-design-system.sh`:
```bash
#!/bin/bash
INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path')
CONTENT=$(echo "$INPUT" | jq -r '.tool_input.content // .tool_input.new_string // empty')

# Only check TSX/JSX/CSS files
if [[ ! "$FILE_PATH" =~ \.(tsx|jsx|css)$ ]]; then
    exit 0
fi

VIOLATIONS=""

# Check for arbitrary Tailwind colors
if echo "$CONTENT" | grep -qE 'bg-(red|blue|green|yellow|gray|slate|zinc)-[0-9]+'; then
    VIOLATIONS+="- Use design tokens (var(--surface-*), var(--accent-*)) instead of arbitrary Tailwind colors\n"
fi

# Check for standard shadows instead of warm shadows
if echo "$CONTENT" | grep -qE 'shadow-(sm|md|lg|xl|2xl)[^-]' | grep -v 'shadow-warm'; then
    VIOLATIONS+="- Use shadow-warm-* variants instead of standard Tailwind shadows\n"
fi

# Check for hardcoded hex colors in className
if echo "$CONTENT" | grep -qE 'className=.*#[0-9a-fA-F]{3,6}'; then
    VIOLATIONS+="- Avoid hardcoded hex colors; use CSS variable tokens\n"
fi

# Check for undefined status tokens
if echo "$CONTENT" | grep -qE 'var\(--status-(error|warning)\)'; then
    VIOLATIONS+="- Use var(--destructive) instead of undefined --status-error/warning tokens\n"
fi

if [ -n "$VIOLATIONS" ]; then
    echo "{\"decision\": \"block\", \"reason\": \"Design system violations found:\n$VIOLATIONS\"}"
    exit 0
fi

exit 0
```

**Hook behavior options**:
- `"decision": "block"` - Prevents code from being written (strict)
- `"decision": "approve"` with `"reason"` - Allows but shows warning (lenient)

#### 5.2 Update Documentation (Low Priority)
After implementing changes, update:
- `docs/docs_overall/design_style_guide.md` - Add new tokens, document nav patterns
- Add design hook documentation to `CLAUDE.md` or separate doc

---

## Implementation Phases

### Phase 1: Quick Wins (1-2 hours)
- [ ] Fix undefined `--status-error` tokens (5 files)
- [ ] Fix hardcoded colors in error pages (2 files)
- [ ] Standardize font classes in results page

### Phase 2: Navigation Contrast (2-3 hours)
- [ ] Add `--surface-nav` token to globals.css
- [ ] Update Navigation.tsx to use new token
- [ ] Add paper-texture and enhance gold accent line
- [ ] Test in light/dark modes

### Phase 3: Typography Extension (1-2 hours)
- [ ] Apply `atlas-display` to results page title
- [ ] Add entrance animations with stagger delays
- [ ] Apply to explore and settings page titles

### Phase 4: Icons & Polish (2-3 hours)
- [ ] Add icons to results page action buttons
- [ ] Standardize shadow usage across UI components
- [ ] Add new input background token

### Phase 5: Automation (1-2 hours)
- [ ] Create validation hook script
- [ ] Add hook configuration to settings.json
- [ ] Test hook with intentional violations
- [ ] Document hook behavior

---

## Open Questions

1. **Nav color intensity**: Should the darker nav be subtle (`#f5f0e6`) or more pronounced (`#e8e4dc`)?
2. **Hook strictness**: Should violations block code (`"decision": "block"`) or just warn?
3. **Animation scope**: Apply entrance animations to all major pages or just results?
4. **Icon style**: Outline icons (current) or solid icons for better visibility?
5. **Status tokens**: Define new `--status-error`/`--status-warning` tokens or alias to existing `--destructive`?
