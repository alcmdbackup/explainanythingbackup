# UI Exploration: Content Editing Action Patterns

## Design philosophy 
- Simple, lighweight, intuitive
- Accessible to everyday people

## Overall thoughts
- Side bar feels better overall - more vertical space for scrolling and reading
- If go with top bar, then it should collapse
   - However, quick editing may still be good
   - Good in that no duplicate CTAs - clicking expands action menu
- However, need a way to draw attention to it
- Should top buttons and side bar be coupled?

## Option 1: Always-Visible Action Bar Approach
Feedback - this could be good

```
┌─ Reggie White ──────────────────── View all matches (5) ┐
│                                                        │
│ [✏️ Edit] [🔄 Rewrite] [💾 Save] [📱 Plain Text]       │ ← Always visible
│                                                        │
│ [When Edit/Rewrite clicked:]                           │
│ ┌────────────────────────────────────────────────────┐ │
│ │ 💡 Instructions (optional):                        │ │
│ │ "Make it more technical" or "Simplify for kids"   │ │
│ │ [Apply] [Cancel]                                   │ │
│ └────────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────┘
```

## Option 2: 3-Column Layout Design
Feedback - Don't like the vertically stacked buttons


```
┌─ Actions ─┐  ┌─ Main Content ──────────┐  ┌─ AI Suggestions ─┐
│           │  │                         │  │                  │
│ ✏️ Edit    │  │ # Reggie White          │  │ What would you   │
│ 🔄 Rewrite │  │                         │  │ like to improve? │
│ 💾 Save    │  │ Early Life and College  │  │ ┌──────────────┐ │
│ 📱 Plain   │  │ Career...               │  │ │ [text input] │ │
│           │  │                         │  │ └──────────────┘ │
│ ┌─────────┐ │  │ Reggie White was born   │  │ [Get AI Suggest] │
│ │ 💡 Ideas │ │  │ on December 19, 1961... │  │                  │
│ │ • More   │ │  │                         │  │                  │
│ │ examples │ │  │ NFL Career and...       │  │                  │
│ │ • Simpler│ │  │                         │  │                  │
│ │ language │ │  │                         │  │                  │
│ └─────────┘ │  └─────────────────────────┘  └──────────────────┘
│ [Apply]     │
└─────────────┘
```

## Option 3: Expanding Icon Bar (Elegant)
Feedback - vertical action buttons still awkward feeling

```
Initial state:    Hover/Click expanded:
┌─ ⚡ ──┐        ┌─ Actions ──────────┐
│  ✏️   │   →    │ ✏️ Edit this       │
│  🔄   │        │ 🔄 Rewrite with AI │
│  💾   │        │ 💾 Save to library │
└──────┘        └────────────────────┘
```

Progressive disclosure:
```
[ ✏️ Edit ] ← Always visible
├─ Click reveals:
   ┌─────────────────────┐
   │ 💡 Quick ideas:     │
   │ • Add more examples │
   │ • Simplify language │
   │ • Make it longer    │
   │ ┌─────────────────┐ │
   │ │ Custom: _______ │ │
   │ └─────────────────┘ │
   │ [Apply] [Cancel]    │
   └─────────────────────┘
```

## Option 4: Context-Aware Cards
Feedback - not great

```
┌─ Edit Content ─────────────────┐
│ ✏️ Make improvements with AI   │
│ [Quick Edit] [Custom Prompt]   │
└────────────────────────────────┘

┌─ Generate Variations ──────────┐
│ 🔄 Rewrite for different style │
│ [Rewrite] [With Tags]          │
└────────────────────────────────┘

┌─ Save & Share ─────────────────┐
│ 💾 Preserve your improvements  │
│ [Save] [View Plain Text]       │
└────────────────────────────────┘
```

=== PART 2 - specific patterns ===

 This is a great UX question. The user has a mode-based design (Read, Edit, Rewrite) but wants to ensure important actions 
  remain visible by default rather than being hidden behind mode switches or submenus. This is a common tension in interface 
  design - how do you organize functionality while maintaining discoverability and quick access to key features.

  Let me think about patterns that solve this:

  1. Primary/Secondary Action Hierarchy - Keep the most important actions always visible, mode-specific actions appear 
  contextually
  2. Contextual Action Bars - Different actions appear based on mode, but core actions remain constant
  3. Action Overflow with Smart Defaults - Show the most likely actions for current context, with overflow for less common ones
  4. Floating Action Button (FAB) with Context - Primary action changes based on mode
  5. Persistent Action Dock - Core actions always visible at bottom/top, mode-specific actions appear inline
  6. Smart Contextual Menus - Actions appear where they're needed in the content
  7. Progressive Disclosure - Start with essential actions, reveal more as user engages
  8. Hybrid Persistent + Contextual - Some actions always visible, others appear based on mode/context

  Let me think of specific patterns:

  Slack's approach: Always show core actions (message, call) but contextual actions appear based on conversation type

  Figma's approach: Tool-specific actions appear in context, but core actions (zoom, share, etc.) are always visible

  Google Docs: Core actions always visible (share, comment) but formatting appears when text selected

  Gmail: Always show compose, but actions change based on email selection

  Adobe Creative Suite: Always show file operations, but tool-specific controls appear contextually

  The key insight is to identify which actions are:
  1. Always needed regardless of mode
  2. Mode-specific but highly important
  3. Mode-specific and secondary

  Some creative patterns:

  1. Action Persistence with Context Injection

  2. Semantic Action Grouping involves organizing actions based on their conceptual relationships and user mental models. I'll 
  group related actions together, making navigation more intuitive and reducing cognitive load. This approach helps users 
  understand action hierarchies more naturally.
  3. Progressive Action Revelation means gradually exposing more complex actions as users become more familiar with the 
  interface. Start with core, essential actions and slowly introduce advanced features as user expertise grows.
  4. Contextual Action Morphing allows actions to dynamically transform based on user context, providing the most relevant 
  interactions at any given moment. This creates a fluid, adaptive interface that anticipates user needs.
  5. Dual-Layer Action Architecture separates core global actions from mode-specific actions, creating a clear visual and 
  functional hierarchy that supports multiple interaction modes seamlessly.

⏺ Here are UX patterns that maintain action visibility while leveraging mode-based design:

  1. Persistent Action Dock + Contextual Injection

  ┌─────────────────────────────────────────────────────────────┐
  │ Troy Aikman                           [View matches (5)]    │
  │                                                             │
  │ Mode: [👁️ Reading] [✏️ Edit] [🔄 Rewrite]                   │
  │                                                             │
  │ ┌─── Always Visible Core Actions ─────────────────────────┐ │
  │ │ [💾 Save] [📤 Share] [⭐ Favorite] │ [✏️ Start Edit]     │ │
  │ │                                    │ ◄── Mode injects   │ │
  │ │                                    │     here           │ │
  │ └────────────────────────────────────┴────────────────────┘ │
  │                                                             │
  │ Content Area                                                │
  └─────────────────────────────────────────────────────────────┘

  2. Smart Action Morphing

  ┌─────────────────────────────────────────────────────────────┐
  │ Troy Aikman                                                 │
  │                                                             │
  │ ┌─── Actions adapt to mode but stay in same positions ───┐ │
  │ │ [💾 Save] [📝 Edit] [🔄 Rewrite] [📤 Share] [⭐ Fav]    │ │
  │ │                                                         │ │
  │ │ Reading:  Save   Edit   Rewrite  Share   Favorite       │ │
  │ │ Editing:  Save   Done   Preview  Share   Favorite       │ │
  │ │ Rewrite:  Save   Edit   Apply    Share   Favorite       │ │
  │ └─────────────────────────────────────────────────────────┘ │
  └─────────────────────────────────────────────────────────────┘

  3. Contextual Action Injection Points

  ┌─────────────────────────────────────────────────────────────┐
  │ Troy Aikman                           [💾 Save] [📤 Share]  │
  │                                       ▲                     │
  │ Mode: [👁️ Reading]                     Always visible       │
  │                                                             │
  │ ┌─── Reading Mode Actions ─────────────────────────────────┐ │
  │ │ [✏️ Start Editing] [🔄 AI Rewrite] [📋 Copy] [🔍 Find]   │ │
  │ └─────────────────────────────────────────────────────────┘ │
  │                                                             │
  │ Content Area                                                │
  │                                                             │
  │ ┌─── Content Actions ────────────────────────────────────┐  │
  │ │ Hover paragraph → [✏️ Edit] [💬 Comment] [🔗 Link]      │  │
  │ └────────────────────────────────────────────────────────┘  │
  └─────────────────────────────────────────────────────────────┘

  4. Semantic Action Grouping

  ┌─────────────────────────────────────────────────────────────┐
  │ ┌─ UNIVERSAL ─┐ ┌─ CONTENT ──┐ ┌─ MODE ─────┐ ┌─ SOCIAL ─┐ │
  │ │[💾][📤][⭐]│ │[🔍][📋][🖨]│ │[✏️][🔄][👁]│ │[💬][👥]  │ │
  │ │Save Shr Fav│ │Fnd Cpy Prt│ │Edt Rwr Rd│ │Cmt Shr  │ │
  │ └────────────┘ └───────────┘ └──────────┘ └────────┘ │
  │                                                             │
  │ Groups persist, actions within groups change by mode        │
  └─────────────────────────────────────────────────────────────┘

  5. Progressive Action Revelation

  ┌─────────────────────────────────────────────────────────────┐
  │ ┌─ Tier 1: Always Visible ─────────────────────────────────┐ │
  │ │ [💾 Save] [📤 Share] [✏️ Edit] [⭐ Favorite]              │ │
  │ └───────────────────────────────────────────────────────────┘ │
  │                                                             │
  │ ┌─ Tier 2: Contextual (Reading mode) ─────────────────────┐ │
  │ │ [🔄 Rewrite] [📋 Copy] [🔍 Find] [📖 Read Aloud] [More▼]│ │
  │ └───────────────────────────────────────────────────────────┘ │
  │                                                             │
  │ ┌─ Tier 3: Content-Specific ──────────────────────────────┐ │
  │ │ Appears on hover/selection: [✏️][💬][🔗][📝]              │ │
  │ └───────────────────────────────────────────────────────────┘ │
  └─────────────────────────────────────────────────────────────┘

  6. Floating Action System

  ┌─────────────────────────────────────────────────────────────┐
  │ Troy Aikman                     ┌─ Floating Actions ──────┐ │
  │                                 │ [💾] Always there       │ │
  │ Content Area                    │ [📤] Always there       │ │
  │                                 │ ───────────────────────│ │
  │                                 │ [✏️] Mode: Reading      │ │
  │                                 │ [🔄] Mode: Reading      │ │
  │                                 │ ───────────────────────│ │
  │                                 │ [📋] Context: Selected  │ │
  │                                 └─────────────────────────┘ │
  │                                                             │
  │ Fixed position, content changes                             │
  └─────────────────────────────────────────────────────────────┘

  7. Command Palette + Visible Shortcuts

  ┌─────────────────────────────────────────────────────────────┐
  │ Troy Aikman     [💾 S] [📤 ⇧S] [✏️ E] [🔄 R]    [⌘K More] │
  │                  Save  Share   Edit  Rewrite   Commands   │
  │                                                             │
  │ ⌘K opens: All actions organized by:                        │
  │ • Universal actions (Save, Share, etc.)                    │
  │ • Current mode actions (Edit, Rewrite for Reading mode)    │
  │ • Content actions (Copy selection, etc.)                   │
  │                                                             │
  │ Keyboard shortcuts always work regardless of visibility    │
  └─────────────────────────────────────────────────────────────┘

  8. Adaptive Navigation Rail

  ┌─────┬───────────────────────────────────────────────────────┐
  │ 💾  │ Troy Aikman                                           │
  │ 📤  │                                                       │
  │ ⭐  │ ┌─ Reading Mode ─────────────────────────────────────┐ │
  │ ──  │ │ [✏️ Edit] [🔄 Rewrite] [📋 Copy] [🔍 Find]        │ │
  │ ✏️  │ └───────────────────────────────────────────────────┘ │
  │ 🔄  │                                                       │
  │ 📋  │ Content Area                                          │
  │ ──  │                                                       │
  │ ⚙️  │                                                       │
  │ ❓  │                                                       │
  └─────┴───────────────────────────────────────────────────────┘

  Best Pattern Recommendation: #3 Contextual Action Injection

  Why this works best:
  - Universal actions (Save, Share) always visible at top
  - Mode-specific actions appear in dedicated, predictable zones
  - Content actions appear contextually where needed
  - Discoverability maintained while avoiding clutter
  - Muscle memory develops for action locations

  Implementation for your case:
  ┌─────────────────────────────────────────────────────────────┐
  │ Troy Aikman                     [💾 Save] [📤 Share] [⭐]   │
  │                                                             │
  │ ┌─ Reading Actions ──────────────────────────────────────┐  │
  │ │ [✏️ Start Editing] [🔄 AI Rewrite] [📋 Copy Text]      │  │
  │ └────────────────────────────────────────────────────────┘  │
  │                                                             │
  │ Mode: [👁️ Reading] [✏️ Edit] [🔄 Rewrite]    [View all (5)] │
  │                                                             │
  │ Content with inline actions on hover/select                 │
  └─────────────────────────────────────────────────────────────┘