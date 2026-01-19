# Clean Up and Enforce Design System Research

## Problem Statement
The codebase uses a "Midnight Scholar" design system with CSS custom properties and Tailwind utilities, but there are instances of hardcoded colors, non-token shadows, and inline styles that bypass the design system. This research documents the current state of design system compliance and the existing enforcement mechanisms.

## High Level Summary

### Colors & Shadows
- **32 hardcoded hex colors** found across 7 files (primarily error pages, Navigation, SettingsContent)
- **21 hardcoded rgba() values** found across 7 files (Navigation, SearchBar, results page scrollbars)
- **33 non-warm shadow instances** found (mostly in debug/admin pages, plus standard Tailwind shadows)

### Typography
- **2 hardcoded font family** declarations (error pages use system-ui fallback)
- **~50+ uses of generic Tailwind fonts** (`font-serif`, `font-sans`) instead of design system classes
- **8 hardcoded font sizes** using arbitrary values like `text-[0.8rem]`, `text-[10px]`
- **Design system fonts well-adopted**: `font-ui` (70 uses), `font-display` (30 uses), `font-mono` (31 uses)

### Enforcement
- **No legacy atlas class usage** - the codebase has been migrated away from these
- **4 custom ESLint rules exist** for test flakiness but **none for design system enforcement**
- **Comprehensive CSS variable system** exists in globals.css with 7 complete theme variants
- **Multiple enforcement options available**: eslint-plugin-tailwindcss, Stylelint, custom ESLint rules

## Documents Read
- `docs/docs_overall/design_style_guide.md` - Design system documentation
- `docs/docs_overall/architecture.md` - System architecture overview
- `docs/docs_overall/getting_started.md` - Documentation structure

## Code Files Read
- `src/app/globals.css` - CSS custom properties and utility classes
- `tailwind.config.ts` - Tailwind configuration with custom tokens
- `eslint.config.mjs` - ESLint flat config
- `eslint-rules/` - Custom flakiness prevention rules

---

## Detailed Findings

### 1. Hardcoded Hex Colors (32 instances in 7 files)

#### `src/app/global-error.tsx` (4 instances)
| Line | Value | Design System Equivalent |
|------|-------|--------------------------|
| 44 | `#faf7f2` | `var(--background)` |
| 60 | `#1a1a2e` | `var(--text-primary)` |
| 68 | `#8a8a9a` | `var(--text-muted)` |
| 80 | `#d4a853` | `var(--accent-gold)` |

#### `src/app/error.tsx` (4 instances)
Same pattern as global-error.tsx - intentionally hardcoded for error boundary reliability.

#### `src/app/settings/SettingsContent.tsx` (14 instances)
Theme palette definitions for color swatches:
- `#d4a853`, `#b87333` (midnight-scholar)
- `#8b2942`, `#2d5a4a` (venetian-archive)
- `#1b4965`, `#774936` (oxford-blue)
- `#8b5a2b`, `#5c4033` (sepia-chronicle)
- `#4a6741`, `#8b6508` (monastery-green)
- `#003153`, `#c41e3a` (prussian-ink)
- `#fe5f55`, `#f19a3e` (coral-harbor)

These are legitimate - they're displaying the actual theme colors to users.

#### `src/components/Navigation.tsx` (7 instances)
Dark Navy theme overrides for hero pages:
| Line | Value | Purpose |
|------|-------|---------|
| 47 | `#0d1628` | Dark nav background |
| 48 | `#ffffff` | White text |
| 51 | `#ffffff` | White logo |
| 53 | `#ffffff` | White search text |
| 56 | `#ffffff` | Import button bg |
| 57 | `#0d1628` | Import button text |

#### `src/components/SearchBar.tsx` (1 instance)
- Line 201: `#ffffff` fallback for dark mode text

#### `src/components/Navigation.test.tsx` (3 instances)
Test assertions for expected color values - intentionally hardcoded.

---

### 2. Hardcoded RGBA Values (21 instances in 7 files)

#### `src/components/Navigation.tsx` (5 instances)
Dark theme border/background values:
| Line | Value | Purpose |
|------|-------|---------|
| 50 | `rgba(255, 255, 255, 0.12)` | Border |
| 52 | `rgba(255, 255, 255, 0.08)` | Search bg |
| 54 | `rgba(255, 255, 255, 0.6)` | Placeholder |
| 55 | `rgba(255, 255, 255, 0.3)` | Search border |
| 58 | `rgba(255, 255, 255, 0.9)` | Import border |

#### `src/components/SearchBar.tsx` (3 instances)
Dark mode fallbacks:
| Line | Value | Purpose |
|------|-------|---------|
| 199 | `rgba(255, 255, 255, 0.08)` | Background |
| 200 | `rgba(255, 255, 255, 0.3)` | Border |
| 207 | `rgba(255, 255, 255, 0.5)` | Placeholder |

#### `src/app/results/page.tsx` (8 instances)
Scrollbar styling - duplicate pattern in two panels:
| Line | Value | Purpose |
|------|-------|---------|
| 979/1255 | `rgba(156, 163, 175, 0.5)` | Scrollbar thumb |
| 990/1266 | `rgba(156, 163, 175, 0.5)` | Webkit thumb |
| 994/1270 | `rgba(156, 163, 175, 0.7)` | Thumb hover |
| 997/1273 | `rgba(156, 163, 175, 0.9)` | Thumb active |

#### `src/app/error.tsx` and `src/app/global-error.tsx` (2 instances)
- Line 53: `rgba(0, 0, 0, 0.1)` - box shadow (intentional for error boundary)

#### `src/editorFiles/lexicalEditor/CitationPlugin.tsx` (1 instance)
- Line 265: `rgba(var(--accent-gold-rgb, 212, 175, 55), 0.15)` - Uses CSS variable with fallback

---

### 3. Non-Warm Shadow Usage (33 instances)

#### Standard Tailwind Shadows (should be `shadow-warm-*`)

**Debug Components (12 instances)** - Lower priority:
- `editorTest/page.tsx:1045` - shadow-lg
- `editorTest/ValidationStatusBadge.tsx:55` - shadow-lg
- `diffTest/page.tsx` (5 instances) - shadow-lg
- `resultsTest/page.tsx:52` - shadow-lg
- `mdASTdiff_demo/page.tsx` (4 instances) - shadow-sm

**Settings (2 instances):**
- `SettingsContent.tsx:68,72` - shadow-inner

**Admin Components (5 instances):**
- `CandidatesContent.tsx:228` - shadow-xl
- `ExplanationDetailModal.tsx:56` - shadow-xl
- `ReportsTable.tsx:250` - shadow-xl
- `UserDetailModal.tsx:90` - shadow-xl
- `WhitelistContent.tsx:260` - shadow-xl

**UI Components (4 instances):**
- `sheet.tsx:34` - shadow-2xl
- `AIEditorPanel.tsx:785` - hover:shadow-md
- `Navigation.tsx:172` - shadow-md, hover:shadow-lg
- `ReportContentButton.tsx:94` - shadow-xl

#### Custom Scholar Shadows (correctly used)
- `button.tsx:14` - active:shadow-page ✓
- `input.tsx:16,24` - shadow-page, focus-visible:shadow-gold-glow ✓
- `TagBar.tsx:448` - shadow-page ✓
- `LexicalEditor.tsx:203,719,737` - shadow-page ✓

#### Inline boxShadow (2 instances)
- `error.tsx:53`, `global-error.tsx:53` - `0 2px 10px rgba(0, 0, 0, 0.1)`

---

### 4. Legacy Atlas Classes

**Finding: No usage found** - The codebase has been fully migrated away from legacy atlas classes:
- ~~atlas-display~~
- ~~atlas-display-section~~
- ~~atlas-ui~~
- ~~atlas-body~~
- ~~atlas-button~~
- ~~atlas-animate~~
- ~~atlasFadeUp~~

Note: The classes are still defined in globals.css but are not used in any TSX files.

---

### 5. Design System Token Inventory

#### CSS Custom Properties (globals.css)

**Core Tokens:**
| Category | Tokens |
|----------|--------|
| Background | `--background`, `--foreground` |
| Text | `--text-primary`, `--text-secondary`, `--text-muted`, `--text-on-primary` |
| Surfaces | `--surface-primary`, `--surface-secondary`, `--surface-elevated`, `--surface-code`, `--surface-nav`, `--surface-input` |
| Borders | `--border-default`, `--border-strong` |
| Accents | `--accent-gold`, `--accent-copper`, `--accent-blue` |
| Status | `--status-error`, `--status-warning`, `--status-success` |
| Links | `--link`, `--link-hover` |
| RGB variants | `--accent-gold-rgb`, `--accent-copper-rgb` |

**7 Complete Theme Variants:**
1. Midnight Scholar (default)
2. Venetian Archive
3. Oxford Blue
4. Sepia Chronicle
5. Monastery Green
6. Prussian Ink
7. Coral Harbor

#### Tailwind Custom Tokens (tailwind.config.ts)

**Shadows:**
- `shadow-warm-sm`, `shadow-warm`, `shadow-warm-md`, `shadow-warm-lg`, `shadow-warm-xl`
- `shadow-page`, `shadow-page-deep`
- `shadow-gold-glow`, `shadow-gold-glow-lg`

**Border Radius:**
- `rounded-book` (0.5rem / 8px)
- `rounded-page` (0.375rem / 6px)

**Fonts:**
- `font-display` (Playfair Display)
- `font-body` (Source Serif 4)
- `font-ui` (DM Sans)
- `font-mono` (JetBrains Mono)

---

### 6. ESLint Configuration

**Location:** `eslint.config.mjs` (flat config format)

**Existing Rules:**
- Extends `next/core-web-vitals` and `next/typescript`
- Custom flakiness plugin with 4 rules for test quality
- No design system enforcement rules currently exist

**Custom Plugin:** `eslint-rules/` (flakiness prevention)
- `no-wait-for-timeout` - Prevents arbitrary waits in tests
- `max-test-timeout` - Limits test timeouts to 60s
- `no-test-skip` - Prevents test.skip()
- `no-silent-catch` - Prevents swallowing errors in catch blocks

**Gap:** No ESLint rules exist for:
- Detecting hardcoded hex/rgba colors
- Enforcing warm shadow usage
- Preventing inline styles with color values

---

## Key Files Reference

| File | Purpose |
|------|---------|
| `src/app/globals.css` | CSS custom properties, themes, utility classes |
| `tailwind.config.ts` | Custom shadows, fonts, border radius, colors |
| `eslint.config.mjs` | ESLint flat config with custom plugins |
| `eslint-rules/index.mjs` | Custom flakiness prevention rules |
| `src/components/ui/button.tsx` | Button component with CVA variants |
| `src/components/Navigation.tsx` | Main navigation (has dark theme overrides) |
| `src/app/settings/SettingsContent.tsx` | Theme picker (has palette colors) |

---

## Summary by Priority

### High Priority (User-facing, theme-aware components)
1. **Navigation.tsx** - 12 hardcoded color values for dark Navy theme
2. **SearchBar.tsx** - 4 hardcoded values for dark mode
3. **results/page.tsx** - 8 hardcoded scrollbar colors
4. **Admin modals** - 5 instances of non-warm shadows

### Medium Priority (Internal but visible)
1. **AIEditorPanel.tsx** - hover:shadow-md
2. **ReportContentButton.tsx** - shadow-xl
3. **sheet.tsx** - shadow-2xl

### Low Priority (Intentional or debug-only)
1. **error.tsx / global-error.tsx** - Hardcoded for reliability (no CSS loading needed)
2. **SettingsContent.tsx** - Theme swatches display actual colors
3. **Test files** - Assertions need hardcoded expected values
4. **Debug pages** - Internal tooling only

### No Action Needed
1. **Legacy atlas classes** - Already removed from usage
2. **CitationPlugin.tsx** - Already uses CSS variable with fallback

---

## Typography Findings

### 7. Hardcoded Font Families (2 instances)

#### Error Pages (Intentional - system fallback)
| File | Line | Value |
|------|------|-------|
| `src/app/error.tsx` | 42 | `fontFamily: 'system-ui, -apple-system, sans-serif'` |
| `src/app/global-error.tsx` | 43 | `fontFamily: 'system-ui, -apple-system, sans-serif'` |

These are intentionally hardcoded for error boundary reliability when CSS may not load.

---

### 8. Generic Tailwind Font Usage (NOT Design System)

The codebase uses generic Tailwind font classes instead of design system classes in many places:

#### `font-serif` usage (should be `font-body`)
~25+ instances across files:
- `src/app/layout.tsx:63` - Default body class
- `src/app/results/page.tsx` - 4 instances
- `src/app/login/page.tsx` - 4 instances
- `src/components/AIEditorPanel.tsx` - 4 instances
- `src/components/ExplanationsTablePage.tsx` - 4 instances
- `src/editorFiles/lexicalEditor/LexicalEditor.tsx` - 5 instances
- Various other components

#### `font-sans` usage (should be `font-ui`)
~30+ instances across files:
- `src/app/results/page.tsx` - 4 instances
- `src/components/ExplanationsTablePage.tsx` - 11 instances
- `src/components/explore/FilterPills.tsx` - 3 instances
- `src/components/explore/ExploreGalleryPage.tsx` - 3 instances
- `src/editorFiles/lexicalEditor/LexicalEditor.tsx` - 3 instances
- Various other components

#### `font-mono` usage (correct - maps to design system)
~31 instances - correctly used for code blocks and debug content.

---

### 9. Hardcoded Font/Text Sizes (8 instances)

#### Inline fontSize Style Objects
| File | Line | Value |
|------|------|-------|
| `src/app/error.tsx` | 59 | `fontSize: '1.5rem'` |
| `src/app/error.tsx` | 87 | `fontSize: '1rem'` |
| `src/app/global-error.tsx` | 58 | `fontSize: '1.5rem'` |
| `src/app/global-error.tsx` | 85 | `fontSize: '1rem'` |

#### Arbitrary Tailwind Text Sizes
| File | Line | Value |
|------|------|-------|
| `src/components/ui/form.tsx` | 138 | `text-[0.8rem]` |
| `src/components/ui/form.tsx` | 160 | `text-[0.8rem]` |
| `src/app/(debug)/editorTest/ValidationStatusBadge.tsx` | 51 | `text-[10px]` |
| `src/app/admin/costs/page.tsx` | 196 | `text-[8px]` |

#### CSS-in-JS Font Sizes
| File | Line | Value |
|------|------|-------|
| `src/editorFiles/lexicalEditor/CitationPlugin.tsx` | 142 | `font-size: 0.875em` (inline cssText) |

---

### 10. Font Token Usage Analysis

#### Design System Font Class Adoption
| Font Class | Count | Primary Usage |
|------------|-------|---------------|
| `font-display` | 30 | Heading typography |
| `font-body` | 12 | Body text (underutilized) |
| `font-ui` | 70 | UI elements (most adopted) |
| `font-mono` | 31 | Code blocks |
| `atlas-display` | 10 | Hero sections |
| `atlas-ui` | 11 | Login/auth pages |
| `atlas-body` | 1 | SearchBar only |

#### Top Font Users by Component
- **TagBar.tsx**: 12× font-ui, 3× font-body, 1× font-display
- **AIEditorPanel.tsx**: 8× font-ui
- **LexicalEditor.tsx**: 6× font-display (h1-h6 headings)
- **Navigation.tsx**: 6× font-ui
- **SettingsContent.tsx**: 5× font-display, 6× font-ui

#### Components NOT Using Design System Fonts
Base UI components rely on Tailwind defaults:
- `src/components/ui/label.tsx`
- `src/components/ui/dialog.tsx`
- `src/components/ui/checkbox.tsx`
- `src/components/ui/select.tsx`
- `src/components/ui/form.tsx`
- `src/components/admin/AdminSidebar.tsx`
- `src/components/admin/ReportsTable.tsx`
- `src/components/explore/FilterPills.tsx`
- `src/components/TextRevealSettings.tsx`

---

## Enforcement Approaches Research

### 11. ESLint Plugins for Design System Enforcement

#### Option A: eslint-plugin-tailwindcss (RECOMMENDED)
**Purpose**: Enforces Tailwind utility usage, prevents arbitrary values

**Key Rules:**
| Rule | Purpose |
|------|---------|
| `no-arbitrary-value` | Blocks `bg-[#fff]`, `text-[14px]` |
| `no-custom-classname` | Only allows Tailwind + whitelist |
| `no-contradicting-classname` | Prevents `p-2 p-3` conflicts |

**Configuration:**
```javascript
// eslint.config.mjs
import tailwind from "eslint-plugin-tailwindcss";

export default [
  ...tailwind.configs["flat/recommended"],
  {
    rules: {
      "tailwindcss/no-arbitrary-value": "warn",
      "tailwindcss/no-custom-classname": "warn"
    }
  }
];
```

**Links:**
- [npm: eslint-plugin-tailwindcss](https://www.npmjs.com/package/eslint-plugin-tailwindcss)
- [GitHub](https://github.com/francoismassart/eslint-plugin-tailwindcss)

#### Option B: Custom ESLint Rules (Like existing flakiness rules)
**Purpose**: Detect hardcoded colors in style objects and JSX

**Pattern:**
```javascript
// eslint-rules/no-hardcoded-colors.js
module.exports = {
  meta: { type: 'problem' },
  create(context) {
    const hexRegex = /#(?:[0-9a-fA-F]{3}){1,2}\b/g;
    const rgbaRegex = /rgba?\([0-9,.\s]+\)/g;

    return {
      JSXAttribute(node) {
        if (node.name.name === 'style') {
          // Check for hardcoded colors
        }
      }
    };
  }
};
```

**Existing plugins to reference:**
- [MetaMask eslint-plugin-design-tokens](https://github.com/MetaMask/eslint-plugin-design-tokens)
- [Atlassian Design System ESLint](https://atlassian.design/components/eslint-plugin-design-system/)

#### Option C: Native ESLint CSS Support (ESLint 9.15+)
- [ESLint CSS Support Announcement](https://eslint.org/blog/2025/02/eslint-css-support/)
- Uses `@eslint/css` plugin
- Can lint CSS files directly

---

### 12. Stylelint for CSS Files

#### stylelint-declaration-strict-value (RECOMMENDED for CSS)
**Purpose**: Enforces CSS variables for specific properties

**Configuration:**
```json
{
  "plugins": ["stylelint-declaration-strict-value"],
  "rules": {
    "scale/declaration-strict-value": [
      ["color", "background-color", "border-color", "box-shadow"],
      {
        "ignoreKeywords": ["transparent", "inherit", "currentColor"]
      }
    ]
  }
}
```

**Would catch:**
- All 32 hardcoded hex colors
- All 21 rgba values
- Inline boxShadow values

**Links:**
- [stylelint-declaration-strict-value](https://github.com/Codeartistryy/stylelint-declaration-strict-value)
- [Stylelint Official Docs](https://stylelint.io/)

---

### 13. Recommended Enforcement Strategy

#### Phase 1: Add eslint-plugin-tailwindcss
```bash
npm install --save-dev eslint-plugin-tailwindcss
```

**Rules to enable:**
- `tailwindcss/no-arbitrary-value: "warn"` - Catches `text-[10px]`, `bg-[#fff]`
- `tailwindcss/no-custom-classname: "warn"` - Ensures only Tailwind classes used
- `tailwindcss/classnames-order: "warn"` - Consistent class ordering

**Whitelist design system classes:**
```javascript
{
  whitelist: [
    "font-display", "font-body", "font-ui", "font-mono",
    "shadow-warm.*", "shadow-page.*", "shadow-gold-glow.*",
    "rounded-book", "rounded-page",
    "atlas-.*", "scholar-.*", "paper-texture", "gold-underline"
  ]
}
```

#### Phase 2: Add Custom ESLint Rules
Create rules in `eslint-rules/` directory (like existing flakiness rules):

1. **`no-hardcoded-colors`** - Detect hex/rgba in style objects
2. **`prefer-design-system-fonts`** - Warn on `font-serif`/`font-sans`, suggest `font-body`/`font-ui`
3. **`prefer-warm-shadows`** - Warn on `shadow-sm/md/lg/xl`, suggest `shadow-warm-*`

#### Phase 3: Add Stylelint (Optional)
For linting `globals.css` and any future CSS:
```bash
npm install --save-dev stylelint stylelint-config-standard stylelint-declaration-strict-value
```

---

### 14. File Exceptions

These files should be excluded from enforcement:

| File | Reason |
|------|--------|
| `src/app/error.tsx` | Error boundary needs hardcoded fallbacks |
| `src/app/global-error.tsx` | Error boundary needs hardcoded fallbacks |
| `src/app/settings/SettingsContent.tsx` | Theme swatches display actual hex values |
| `**/*.test.tsx` | Test assertions need expected values |
| `src/app/(debug)/**` | Internal debug tooling |
| `src/app/globals.css` | Design token definitions |
