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