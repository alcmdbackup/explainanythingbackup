# Disable AI Suggestion Panel During Streaming Research

## Problem Statement
During content streaming (when the AI is generating/writing content to the editor), users should not be able to interact with the AI suggestion panel. The panel needs a visual treatment that communicates "not available right now" while streaming is in progress.

## High Level Summary
The codebase has established visual patterns for disabled and loading states. This research documents **8 distinct visual design approaches** for disabling the AI suggestion panel during streaming, ranging from subtle opacity reduction to full overlay treatments. Additional research covers accessibility considerations and animation timing patterns.

---

## Visual Design Approaches

### Approach 1: Opacity Fade (Minimal)
**Existing Pattern:** `disabled:opacity-50` used throughout buttons and inputs

**Visual Treatment:**
- Reduce entire panel opacity to 50%
- Add `pointer-events-none` to block interaction
- Maintain panel structure and visibility

**Pros:**
- Consistent with existing disabled patterns (buttons, inputs use this)
- Minimal visual disruption
- Users can still see panel contents
- Simple to implement

**Cons:**
- Subtle - may not be immediately obvious panel is disabled
- No explanation of WHY it's disabled

**Tailwind Classes:** `opacity-50 pointer-events-none transition-opacity duration-200`

---

### Approach 2: Glassmorphism Overlay
**Existing Pattern:** Gallery cards use `backdrop-filter: blur(12px)` for glassmorphism

**Visual Treatment:**
- Overlay the panel with a frosted glass effect
- 12px blur with semi-transparent background
- Centered message: "Writing in progress..." with ink-dots spinner
- Panel contents visible but clearly obscured

**Pros:**
- Premium visual that matches design system (gallery cards use this)
- Clearly communicates "wait" state
- Provides context with text message
- Elegant and modern feel

**Cons:**
- More visually disruptive
- May feel heavy-handed for short streaming durations
- Requires overlay positioning

**CSS Pattern:**
```css
.streaming-overlay {
  backdrop-filter: blur(12px);
  background: rgba(var(--surface-elevated-rgb), 0.85);
  /* Centered spinner + "Writing in progress..." text */
}
```

---

### Approach 3: Collapse/Minimize Panel
**Existing Pattern:** Panel already has collapse animation (`w-[360px]` → `w-0`, `opacity-100` → `opacity-0`)

**Visual Treatment:**
- Auto-collapse panel when streaming starts
- Show small toggle button with streaming indicator (quill spinner)
- Panel expands back when streaming completes
- Optionally disable the expand button during streaming

**Pros:**
- Removes visual clutter during streaming
- Uses existing animation infrastructure
- Focuses user attention on the editor/content
- Clear physical removal of the option

**Cons:**
- Jarring if panel was actively being viewed
- May feel like functionality is "taken away"
- User loses visual reference to their prompt history

**Animation:** `transition-all duration-300 ease-in-out`

---

### Approach 4: Skeleton/Ghost State
**Existing Pattern:** `.gallery-skeleton` uses pulsing gradient animation

**Visual Treatment:**
- Replace interactive elements with skeleton placeholders
- Keep panel structure visible but show gray pulsing shapes
- Textarea → pulsing rectangle
- Buttons → pulsing pill shapes
- Optional: small "Available after writing completes" text

**Pros:**
- Clear visual that content is "loading/waiting"
- Maintains spatial layout expectations
- Modern loading pattern users recognize
- Provides hope that functionality will return

**Cons:**
- May feel like the panel is broken/loading rather than intentionally disabled
- More visual complexity
- Skeleton patterns typically indicate "loading data" not "disabled"

**Animation:**
```css
@keyframes skeletonPulse {
  0%, 100% { opacity: 0.4; }
  50% { opacity: 0.7; }
}
```

---

### Approach 5: Contextual Message Card
**Existing Pattern:** Error/success cards with left border accent (4px solid color)

**Visual Treatment:**
- Replace panel content with a status card
- Gold left border (streaming indicator color)
- Quill spinner icon + "Writing in progress" title
- Message: "AI editing will be available once writing completes"
- Same card styling as error/success states

**Pros:**
- Matches existing status card pattern (error, success)
- Provides clear explanation
- Visually distinct state
- Can include helpful context

**Cons:**
- Hides entire panel functionality
- User can't preview their prompt history
- More disruptive than opacity approaches

**Structure:**
```
┌────────────────────────────────┐
│ ▌ [Quill Spinner] Writing...   │
│ ▌                              │
│ ▌ AI editing will be available │
│ ▌ once content generation      │
│ ▌ completes.                   │
└────────────────────────────────┘
```

---

### Approach 6: Pulse Animation + Conditional Hiding
**Existing Pattern:** SourceChip uses `opacity-60 animate-pulse` during loading

**Visual Treatment:**
- Panel fades to 60% opacity with subtle pulse animation
- Hide interactive elements (remove buttons, submit button) completely
- Keep header + history visible but non-interactive
- Small inline text: "Available when writing completes"

**Pros:**
- Pulse animation draws attention to "waiting" state
- Conditional hiding removes temptation to click
- More visible than static opacity (movement catches eye)
- SourceChip already uses this exact pattern

**Cons:**
- Animation may be distracting during longer streams
- Must respect `prefers-reduced-motion` (disable animation)
- Hiding elements can cause layout shift

**Tailwind Classes:** `opacity-60 animate-pulse transition-opacity duration-200`

---

### Approach 7: Dashed Border + Opacity (Accessibility-Optimized)
**Existing Pattern:** Combined pattern for colorblind accessibility

**Visual Treatment:**
- Reduce opacity to 65% (subtle but noticeable)
- Add dashed border around panel (1px dashed)
- Maintain focus ring visibility (gold ring)
- Works equally well for colorblind users

**Pros:**
- Dashed border provides non-color visual cue
- Better for colorblind users than opacity alone
- Maintains text readability at 65% opacity
- Focus rings remain visible for keyboard users

**Cons:**
- Dashed border may look "unpolished"
- Two visual changes at once (opacity + border)

**CSS Pattern:**
```css
.disabled-panel-state {
  opacity: 0.65;
  border: 1px dashed var(--border-default);
}
```

---

### Approach 8: Header Badge + Disabled Controls
**Existing Pattern:** Validation badges in AIEditorPanel use color-coded pills

**Visual Treatment:**
- Add gold/amber "Writing..." badge in panel header (next to title)
- Badge contains quill spinner + text
- All controls get standard `disabled:opacity-50`
- Panel structure fully visible

**Pros:**
- Compact, non-intrusive indicator
- Matches existing badge pattern (validation badges)
- Explains WHY without overlay
- Header always visible even when scrolled

**Cons:**
- Small badge might be missed
- Header area may feel crowded
- Doesn't communicate urgency

**Badge Structure:**
```
┌──────────────────────────────────────┐
│ AI Editor  [⚡ Writing...]           │
│                                      │
│ [textarea - opacity-50, disabled]    │
│ [button - opacity-50, disabled]      │
└──────────────────────────────────────┘
```

---

## Comparison Matrix

| Approach | Visibility | Disruptiveness | Pattern Match | User Clarity | Accessibility |
|----------|------------|----------------|---------------|--------------|---------------|
| 1. Opacity Fade | High | Low | ★★★★★ | ★★☆☆☆ | ★★★☆☆ |
| 2. Glassmorphism | Medium | Medium | ★★★★☆ | ★★★★☆ | ★★★★☆ |
| 3. Collapse Panel | None | High | ★★★★★ | ★★★☆☆ | ★★★☆☆ |
| 4. Skeleton State | Medium | Medium | ★★★☆☆ | ★★★☆☆ | ★★★☆☆ |
| 5. Message Card | Low | High | ★★★★★ | ★★★★★ | ★★★★★ |
| 6. Pulse + Hide | High | Medium | ★★★★☆ | ★★★★☆ | ★★☆☆☆ |
| 7. Dashed Border | High | Low | ★★★☆☆ | ★★★☆☆ | ★★★★★ |
| 8. Header Badge | High | Low | ★★★★★ | ★★★☆☆ | ★★★★☆ |

### Recommendation
**Approach 1 (Opacity Fade)** is the most consistent with existing patterns and least disruptive. Consider combining with a small tooltip or subtle text message for added clarity.

**Approach 2 (Glassmorphism)** provides the best balance of visual polish and user communication if a more prominent treatment is desired.

**Approach 7 (Dashed Border)** is best for accessibility compliance - provides multiple visual cues (opacity + border pattern) that work for colorblind users.

**Approach 8 (Header Badge)** is the least disruptive option that still explains WHY the panel is disabled.

---

## Accessibility Considerations

### Current State
The codebase has **excellent `prefers-reduced-motion` support** but **limited ARIA attributes** for state changes.

### Missing Patterns (Gaps to Address)
| Pattern | Current | Recommended |
|---------|---------|-------------|
| `aria-busy` | ❌ Not used | Add to panel during streaming |
| `aria-disabled` | ❌ Not used | Add to panel container |
| `aria-live` regions | ❌ Not used | Announce streaming state changes |
| Focus management | ⚠️ Basic | Restore focus after streaming |

### Recommended ARIA Implementation
```tsx
<div
  aria-busy={isStreaming}
  aria-disabled={isStreaming}
  aria-describedby="streaming-status"
>
  <span id="streaming-status" className="sr-only">
    {isStreaming ? "Panel disabled while AI generates content" : "Ready"}
  </span>
  {/* Panel content */}
</div>
```

### Motion Preference Support
All approaches that use animation (Approach 4, 6) must respect:
```css
@media (prefers-reduced-motion: reduce) {
  .animate-pulse { animation: none !important; }
  .transition-all { transition: none !important; }
}
```

The codebase already has this pattern in `globals.css` for text reveal animations.

### Colorblind-Safe Options
- **Best:** Approach 7 (dashed border) - uses shape, not just color
- **Good:** Approach 2, 5, 8 - use multiple visual cues
- **Avoid alone:** Approaches that only change opacity/color

---

## Animation Timing Reference

| Pattern | Duration | Easing | Use Case |
|---------|----------|--------|----------|
| Quick state change | 150ms | ease-out | Toggle buttons |
| Standard transition | 200ms | ease-in-out | Button hover, opacity |
| Panel collapse | 300ms | ease-in-out | Width/visibility |
| Premium feel | 300ms | `cubic-bezier(0.4, 0, 0.2, 1)` | Cards, overlays |
| Loading pulse | 1.5s | ease-in-out infinite | Skeleton, pulse |

---

## Documents Read
- docs/feature_deep_dives/ai_suggestions_overview.md
- docs/docs_overall/architecture.md
- docs/docs_overall/design_style_guide.md (referenced via agents)

## Code Files Read
- src/components/AIEditorPanel.tsx (visual states, loading, error, progress patterns)
- src/components/AdvancedAIEditorModal.tsx (modal disabled states, processing)
- src/components/import/ImportModal.tsx (state machine pattern, detecting state)
- src/components/sources/SourceChip.tsx (pulse animation, failed state styling)
- src/components/OutputModeToggle.tsx (disabled toggle patterns)
- src/components/ui/button.tsx (disabled patterns, focus-visible)
- src/components/ui/spinner.tsx (loading spinner variants - quill, ink-dots)
- src/components/ui/input.tsx (disabled input styling)
- src/components/ui/select.tsx (data-[disabled] Radix patterns)
- src/components/ui/checkbox.tsx (disabled checkbox patterns)
- src/app/globals.css (animations, skeleton, glassmorphism, prefers-reduced-motion)
- src/app/results/page.tsx (streaming indicators, progress bar)
- src/hooks/useStreamingEditor.ts (streaming state management)
- src/lib/textRevealAnimations.ts (text reveal effects)
- src/editorFiles/lexicalEditor/DiffTagHoverPlugin.tsx (state tracking patterns)
