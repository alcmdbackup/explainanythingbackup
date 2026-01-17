# Disable AI Suggestion Panel During Streaming Plan

## Background
The ExplainAnything app has an AI Editor Panel (`AIEditorPanel.tsx`) that allows users to request AI-powered edits to explanations. When a user submits a search query, content streams into the editor. The streaming state is managed by `pageLifecycleReducer` in `results/page.tsx` (line 26: `isStreaming as getIsStreaming`, line 94: `const isStreaming = getIsStreaming(pageLifecycleState)`). During this streaming phase, the AI suggestion panel should not be interactive because applying AI suggestions to incomplete content would produce unpredictable results. The codebase already has established patterns for disabled states (`disabled:opacity-50`, `pointer-events-none`) used consistently across buttons, inputs, and other interactive components.

## Problem
Currently, when content is streaming into the editor, the AI Editor Panel remains fully interactive. Users could potentially:
1. Submit AI suggestion requests while content is still being generated
2. Attempt to use quick actions or output mode toggles during streaming
3. Experience confusing behavior if AI suggestions are applied to partial content

The panel needs a clear visual treatment that communicates "not available right now" while streaming is in progress, preventing user interaction and potential data corruption.

## Options Considered
Eight visual design approaches were researched (see Appendix for illustrations):

| # | Approach | Disruption | Chosen? |
|---|----------|------------|---------|
| 1 | **Opacity Fade** | Low | ✅ Selected |
| 2 | Glassmorphism Overlay | Medium | |
| 3 | Collapse Panel | High | |
| 4 | Skeleton State | Medium | |
| 5 | Message Card | High | |
| 6 | Pulse + Hide Buttons | Medium | |
| 7 | Dashed Border + Opacity | Low | |
| 8 | Header Badge + Disabled | Low | |

**Chosen: Approach 1 (Opacity Fade)** - Most consistent with existing disabled patterns, minimal disruption, simple to implement.

## Phased Execution Plan

### Phase 1: Add `isStreaming` Prop to AIEditorPanel
**Goal:** Pass streaming state from parent to panel

**Files to modify:**
- `src/components/AIEditorPanel.tsx` - Add `isStreaming?: boolean` to interface (currently lines 25-56)
- `src/app/results/page.tsx` - Pass `isStreaming` prop where AIEditorPanel is rendered (around line 1294)

**Code snippet - AIEditorPanel.tsx interface:**
```tsx
// AIEditorPanel.tsx - Add to AIEditorPanelProps interface (lines 25-56)
interface AIEditorPanelProps {
  // ... existing props (userPrompt, onUserPromptChange, etc.)
  isStreaming?: boolean;  // NEW: Disable panel during content streaming
}

export function AIEditorPanel({
  isStreaming = false,  // NEW: Default to false
  // ... existing destructured props
}: AIEditorPanelProps) {
  // ...
}
```

**Code snippet - results/page.tsx prop passing:**
```tsx
// results/page.tsx - Around line 1294 where AIEditorPanel is rendered
// isStreaming is already available from pageLifecycleReducer (line 94)
<AIEditorPanel
  // ... existing props
  isStreaming={isStreaming}  // NEW: Pass streaming state
/>
```

### Phase 2: Apply Visual Disabled State (Primary Protection)
**Goal:** Reduce panel opacity and block interactions when streaming

**Coordination with Phase 4:** This wrapper-level `pointer-events-none` is the PRIMARY protection that blocks all clicks. Phase 4 adds individual `disabled` attributes as DEFENSE-IN-DEPTH for accessibility and edge cases where CSS might not load.

**Files to modify:**
- `src/components/AIEditorPanel.tsx` - Add conditional styling to content wrapper

**Exact placement:** The panel content div (around line 498) currently has `opacity-100/0` for open/closed state. Add `isStreaming` as an additional condition:

**Code snippet:**
```tsx
// In AIEditorPanel.tsx, modify the existing content wrapper (line ~498)
// BEFORE: className={cn("...", isOpen ? 'opacity-100' : 'opacity-0')}
// AFTER:
<div
  className={cn(
    "...", // existing classes
    isOpen ? 'opacity-100' : 'opacity-0',
    isStreaming && "opacity-50 pointer-events-none"  // NEW: streaming disabled state
  )}
>
  {/* existing panel content */}
</div>
```

**Note:** The `opacity-50` for streaming will override `opacity-100` when both `isOpen` and `isStreaming` are true, which is the desired behavior.

### Phase 3: Add ARIA Attributes for Accessibility
**Goal:** Announce streaming state to screen readers

**Files to modify:**
- `src/components/AIEditorPanel.tsx` - Add sr-only status announcement

**Approach:** Use a single sr-only span with `aria-live="polite"` to announce state changes. Do NOT use `aria-busy` on wrapper div (it's redundant when individual controls are disabled and causes double announcements).

**Code snippet:**
```tsx
// Add near the top of the panel content, inside the main wrapper
{isStreaming && (
  <span className="sr-only" role="status" aria-live="polite">
    AI Editor panel disabled while content is being generated
  </span>
)}
```

**Why sr-only only (not aria-busy):**
- Individual controls get `disabled` attribute which screen readers already announce
- `aria-live="polite"` announces the message without interrupting
- Adding `aria-busy` would create redundant announcements

### Phase 4: Disable Individual Controls (Defense in Depth)
**Goal:** Ensure all interactive elements are explicitly disabled for accessibility and CSS fallback

**Why both Phase 2 AND Phase 4?**
- Phase 2 (`pointer-events-none`) = visual + click blocking via CSS
- Phase 4 (`disabled` attribute) = semantic HTML, keyboard navigation blocking, screen reader support
- If CSS fails to load, HTML `disabled` still prevents interaction

**Files to modify:**
- `src/components/AIEditorPanel.tsx` - Add `disabled={isStreaming || isLoading}` to:
  - Textarea (around line 545)
  - Submit button (around line 627)
  - Quick action buttons (around line 557)
  - OutputModeToggle component (around line 526)
  - Expand modal button

**Code snippet:**
```tsx
// Textarea
<textarea
  disabled={isStreaming || isLoading}
  // ... other props
/>

// Submit Button
<Button
  disabled={isStreaming || isLoading || !userPrompt.trim()}
  // ... other props
>
  {isLoading ? 'Composing...' : 'Get Suggestions'}
</Button>

// OutputModeToggle - VERIFIED: accepts disabled prop (line 15 of OutputModeToggle.tsx)
<OutputModeToggle
  disabled={isStreaming || isLoading}
  // ... other props
/>

// Quick action buttons - add to each
<button
  disabled={isStreaming || isLoading}
  onClick={...}
>
  Simplify
</button>
```

### Phase 5: Run Lint, TSC, Build, and Tests
**Goal:** Verify no regressions

**Commands:**
```bash
npm run lint
npm run tsc
npm run build
npm run test
npm run test:integration
npm run test:e2e
```

## Testing

### Unit Tests
- **File:** `src/components/AIEditorPanel.test.tsx` (add to existing colocated test file)
- **Tests to add:**
  - `renders with opacity-50 class when isStreaming=true`
  - `has pointer-events-none when isStreaming=true`
  - `textarea is disabled when isStreaming=true`
  - `submit button is disabled when isStreaming=true`
  - `renders sr-only status announcement when isStreaming=true`
  - `renders normally when isStreaming=false`

### E2E Tests
- **File:** `src/__tests__/e2e/specs/06-ai-suggestions/ai-panel-streaming.spec.ts` (directory verified to exist)
- **Tag:** Add `@critical` tag to ensure tests run in CI (per testing_overview.md)
- **Streaming state simulation:**
  1. Trigger via new query submission (which initiates streaming)
  2. Detect streaming active: check for `opacity-50` class on panel OR wait for progress bar selector
  3. Detect streaming complete: `page.waitForFunction(() => !document.querySelector('.opacity-50'))` OR wait for editor content to stabilize
  4. Use `page.waitForSelector('[data-testid="ai-editor-panel"]')` then check class states
- **Tests to add:**
  ```typescript
  test.describe('@critical AI Panel Streaming', () => {
    test('panel appears disabled during content streaming', async ({ page }) => {
      // Submit new query to trigger streaming
      // Assert panel has opacity-50 and pointer-events-none classes
    });
    test('panel re-enables after streaming completes', async ({ page }) => {
      // Wait for streaming to complete
      // Assert panel no longer has disabled classes
    });
    test('cannot submit suggestions while streaming', async ({ page }) => {
      // Attempt to click submit button during streaming
      // Assert button is disabled and click has no effect
    });
  });
  ```

### Manual Verification (Staging)
1. Navigate to results page with a new query
2. Observe AI Editor Panel becomes visually disabled (50% opacity)
3. Attempt to click textarea - should not be focusable
4. Attempt to click submit button - should not respond
5. Wait for streaming to complete - panel should re-enable
6. Verify panel functions normally after streaming

## Rollback Strategy

**If issues are detected in production:**

1. **Detection:** Monitor Sentry for errors in `AIEditorPanel.tsx` or `results/page.tsx`
2. **Symptoms to watch:**
   - Panel permanently stuck in disabled state (opacity-50 not clearing)
   - `isStreaming` state not transitioning to `false` after content loads
   - User reports of "can't use AI editor"

3. **Rollback steps:**
   - Revert the commit that added `isStreaming` prop to AIEditorPanel
   - Or: Set `isStreaming={false}` hardcoded in results/page.tsx as hotfix
   - Deploy hotfix via Vercel

4. **Low risk assessment:**
   - Change is additive (new prop with default `false`)
   - Existing functionality unchanged if prop not passed
   - Visual-only change, no data mutations

## Documentation Updates
- `docs/feature_deep_dives/ai_suggestions_overview.md` - Add section on streaming state handling

---

## Appendix: Visual Design Options

### Low Disruption Options (Panel stays visible)

#### 1. Opacity Fade
```
┌─────────────────────────┐
│ AI Editor               │  ← Normal header
│                         │
│ ░░░░░░░░░░░░░░░░░░░░░░ │  ← Everything at 50% opacity
│ ░░ [textarea] ░░░░░░░░ │     (grayed out, can't click)
│ ░░░░░░░░░░░░░░░░░░░░░░ │
│ ░░ [Get Suggestions] ░ │
└─────────────────────────┘
```
**Best for:** Consistency. Matches how buttons/inputs already disable.
**Downside:** Subtle - user might try to click before noticing.

---

#### 7. Dashed Border + Opacity
```
┌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌┐
╎ AI Editor               ╎  ← Dashed border around panel
╎                         ╎
╎ ░░░░░░░░░░░░░░░░░░░░░░ ╎  ← 65% opacity
╎ ░░ [textarea] ░░░░░░░░ ╎
╎ ░░░░░░░░░░░░░░░░░░░░░░ ╎
╎ ░░ [Get Suggestions] ░ ╎
└╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌┘
```
**Best for:** Accessibility. Colorblind users see the dashed border.
**Downside:** Dashed border may look less polished.

---

#### 8. Header Badge + Disabled Controls
```
┌─────────────────────────┐
│ AI Editor [✨Writing...] │  ← Gold badge with spinner
│                         │
│ ░░░░░░░░░░░░░░░░░░░░░░ │  ← Standard disabled (50% opacity)
│ ░░ [textarea] ░░░░░░░░ │
│ ░░░░░░░░░░░░░░░░░░░░░░ │
│ ░░ [Get Suggestions] ░ │
└─────────────────────────┘
```
**Best for:** Explains WHY it's disabled without hiding content.
**Downside:** Small badge might be missed.

---

### Medium Disruption Options (Overlay or transform)

#### 2. Glassmorphism Overlay
```
┌─────────────────────────┐
│ AI Editor               │
│  ┌───────────────────┐  │
│  │   ╭─────╮         │  │  ← Frosted glass overlay
│  │   │ 🖋️  │         │  │     with blur effect
│  │   ╰─────╯         │  │
│  │  Writing...       │  │  ← Centered spinner + text
│  └───────────────────┘  │
└─────────────────────────┘
```
**Best for:** Premium feel, clear communication.
**Downside:** More visually heavy, may feel slow for short streams.

---

#### 4. Skeleton State
```
┌─────────────────────────┐
│ AI Editor               │
│                         │
│ ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓ │  ← Pulsing gray rectangles
│ ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓ │     (breathing animation)
│ ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓ │
│ ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓ │
└─────────────────────────┘
```
**Best for:** Modern loading feel.
**Downside:** Implies "loading data" not "intentionally disabled."

---

#### 6. Pulse Animation + Hide Buttons
```
┌─────────────────────────┐
│ AI Editor               │  ← Normal header
│                         │
│ ░░░░░░░░░░░░░░░░░░░░░░ │  ← 60% opacity, pulsing
│ ░░ [textarea] ░░░░░░░░ │     (breathing in/out)
│ ░░░░░░░░░░░░░░░░░░░░░░ │
│                         │  ← Buttons HIDDEN entirely
│ "Available after write" │
└─────────────────────────┘
```
**Best for:** Removes temptation to click.
**Downside:** Animation can be distracting; layout shifts.

---

### High Disruption Options (Content hidden or panel removed)

#### 3. Collapse Panel
```
┌──┐
│ >│  ← Panel collapsed to thin strip
│🖋️│     with spinning quill icon
│  │
│  │
│  │
└──┘
```
**Best for:** Focus entirely on editor content.
**Downside:** Jarring if user was looking at the panel.

---

#### 5. Message Card
```
┌─────────────────────────┐
│ ▌ 🖋️ Writing...         │  ← Gold left border
│ ▌                       │
│ ▌ AI editing will be    │  ← Explanatory message
│ ▌ available once        │
│ ▌ content generation    │
│ ▌ completes.            │
│ ▌                       │
└─────────────────────────┘
```
**Best for:** Clearest communication, matches error/success cards.
**Downside:** Hides all panel functionality completely.

---

### Quick Recommendation Table

| Priority | Best Choice |
|----------|-------------|
| **Fast & simple** | Approach 1 (Opacity Fade) |
| **Best UX balance** | Approach 8 (Header Badge) |
| **Most accessible** | Approach 7 (Dashed Border) |
| **Premium feel** | Approach 2 (Glassmorphism) |
