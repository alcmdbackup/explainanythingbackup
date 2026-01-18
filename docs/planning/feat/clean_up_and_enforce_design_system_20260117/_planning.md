# Clean Up and Enforce Design System Plan

## Background
The ExplainAnything codebase uses a "Midnight Scholar" design system with CSS custom properties, Tailwind utilities, and custom classes. However, research found 32 hardcoded hex colors, 21 rgba values, 8 hardcoded font sizes, ~50+ generic font class usages, and 33 non-warm shadow instances scattered across the codebase.

**Existing Enforcement (Layer 1):** Claude Code hooks already require reading `design_style_guide.md` before editing frontend files. This teaches patterns but doesn't catch violations in the code itself.

**Gap:** No automated lint-time enforcement exists - developers can still add hardcoded values without linting errors or warnings.

## Problem
Without enforcement, design system violations accumulate over time. New code continues to use hardcoded values (`#ffffff`, `text-[14px]`, `font-serif`) instead of design tokens (`var(--text-primary)`, `text-sm`, `font-body`). This causes:
1. **Theme breakage** - Hardcoded colors don't respond to theme changes
2. **Inconsistency** - Same intent expressed differently across components
3. **Maintenance burden** - Manual audits required to find violations
4. **Regression risk** - Fixed violations can be reintroduced

## Options Considered

### Option 1: eslint-plugin-tailwindcss only
- **Pros**: Single tool, catches arbitrary values in Tailwind classes
- **Cons**: Doesn't catch inline style objects, limited customization
- **Verdict**: Good foundation but insufficient alone

### Option 2: Custom ESLint rules only
- **Pros**: Full control, can target exact patterns
- **Cons**: More development effort, maintenance burden
- **Verdict**: Necessary for style object detection

### Option 3: Stylelint for CSS
- **Pros**: Purpose-built for CSS, stylelint-declaration-strict-value plugin
- **Cons**: Only lints CSS files, not JSX/TSX inline styles
- **Verdict**: Optional, globals.css rarely changes

### Option 4: Combined approach (SELECTED)
- eslint-plugin-tailwindcss for Tailwind class validation
- Custom ESLint rules for inline styles and semantic preferences
- File-based exceptions for intentional hardcoding
- **Verdict**: Comprehensive coverage with reasonable effort

### Out of Scope
- **CSS-in-JS libraries** (styled-components, emotion, CSS modules): Not used in this codebase. The project uses Tailwind CSS with inline className strings and occasional style objects. If CSS-in-JS is adopted later, additional tooling (stylelint-processor-styled-components) would be needed.
- **Server-side rendered styles**: All styling is client-side via Tailwind utilities.

---

## Existing Enforcement Architecture (Layer 1)

The codebase already has hook-based enforcement that requires reading the design style guide before editing frontend files. This provides **educational enforcement** but not **code-level enforcement**.

### Pre-Edit Hook: `check-workflow-ready.sh`

**Location:** `.claude/hooks/check-workflow-ready.sh` (lines 219-257)

**What it does:**
1. Detects frontend file edits (components, app/*.tsx, CSS, tailwind.config, editorFiles, hooks, reducers, contexts)
2. Checks if `design_style_guide.md` has been read (tracked in `_status.json`)
3. **Blocks the edit** if the guide hasn't been read

**Frontend file detection:**
```bash
is_frontend_file() {
  [[ "$path" == *"/components/"* ]] && return 0
  [[ "$path" == *"/app/"* ]] && [[ "$path" == *.tsx ]] && return 0
  [[ "$path" == *.css ]] && return 0
  [[ "$path" == *"tailwind.config"* ]] && return 0
  [[ "$path" == *"/editorFiles/"* ]] && return 0
  [[ "$path" == *"/hooks/"* ]] && return 0
  [[ "$path" == *"/reducers/"* ]] && return 0
  [[ "$path" == *"/contexts/"* ]] && return 0
  return 1
}
```

**Prerequisite tracking:** `track-prerequisites.sh` records when `design_style_guide.md` is read to `_status.json`.

### Post-Edit Hook: ESLint

**Location:** `.claude/settings.json` (lines 50-54)

**What it does:**
- Runs `npx eslint $FILE_PATH --quiet || true` after every Edit/Write
- Currently only catches standard ESLint rules
- **Gap:** No design system rules exist yet

### Layered Enforcement Strategy

| Layer | When | What | Purpose |
|-------|------|------|---------|
| **Layer 1** (existing) | Pre-edit | Hook blocks until guide read | Educational - teaches patterns |
| **Layer 2** (this plan) | Post-edit | ESLint catches violations | Enforcement - catches mistakes |

This plan adds **Layer 2** to complement the existing Layer 1 enforcement.

---

## Phased Execution Plan

### Phase 1: Create Custom ESLint Rules (Layer 2 Enforcement)
**Goal**: Add lint-time violation detection to complement existing hook enforcement

**IMPORTANT: Why Custom Rules First**
This project uses **Tailwind CSS v4.1.17**. The eslint-plugin-tailwindcss only has beta support for Tailwind v4 (v4.0.0-beta.0) which:
- May not be stable
- May not support Tailwind v4's CSS-first configuration
- Could cause false positives/negatives

**Decision**: Skip eslint-plugin-tailwindcss entirely. Custom ESLint rules provide:
- Full control over detection patterns
- No external dependency compatibility issues
- Tailwind version independence
- Ability to detect inline style objects (which the plugin can't do anyway)

**Files to create:**
- `eslint-rules/no-hardcoded-colors.js`
- `eslint-rules/no-arbitrary-text-sizes.js`
- `eslint-rules/prefer-design-system-fonts.js`
- `eslint-rules/prefer-warm-shadows.js`
- `eslint-rules/design-system.js`

**Optional Future Enhancement**: When eslint-plugin-tailwindcss has stable Tailwind v4 support:
```bash
# Future: Add plugin for additional arbitrary value detection
npm install --save-dev eslint-plugin-tailwindcss@latest

# Verify v4 support before enabling:
npm ls tailwindcss eslint-plugin-tailwindcss
# Only proceed if plugin version explicitly supports Tailwind v4
```

**Verification (after Phase 1 complete):**
- Run `npm run lint` - Should show warnings for existing violations
- Expected: ~53 hardcoded colors, ~8 arbitrary text sizes, ~50 generic fonts, ~33 non-warm shadows

---

**Rule Implementations (Phase 1 continued):**

**Rule 1: no-hardcoded-colors**
```javascript
// eslint-rules/no-hardcoded-colors.js
module.exports = {
  meta: {
    type: "problem",
    docs: {
      description: "Disallow hardcoded color values in style props",
      category: "Design System",
    },
    messages: {
      noHardcodedHex: "Use CSS variable instead of hardcoded hex '{{value}}'. Example: var(--text-primary)",
      noHardcodedRgba: "Use CSS variable instead of hardcoded rgba '{{value}}'. Example: var(--accent-gold)",
    },
  },
  create(context) {
    // Improved regex patterns:
    // - Hex: matches #fff, #ffffff, #ffffffff (with alpha)
    // - RGBA: uses balanced matching for nested var() calls
    const hexRegex = /#(?:[0-9a-fA-F]{3,4}){1,2}\b/;

    // Simple rgba detection - allows var() inside but still flags
    // rgba(255, 255, 255, 0.5) but NOT rgba(var(--color-rgb), 0.5)
    const rgbaRegex = /rgba?\s*\(\s*\d/; // Starts with digit = hardcoded

    // CSS style property names that can contain colors
    const colorProperties = new Set([
      "color", "backgroundColor", "borderColor", "borderTopColor",
      "borderRightColor", "borderBottomColor", "borderLeftColor",
      "outlineColor", "textDecorationColor", "fill", "stroke",
      "background", "border", "boxShadow", "textShadow",
      "caretColor", "columnRuleColor",
    ]);

    function checkValue(node, value) {
      if (typeof value !== "string") return;

      // Skip if using CSS variable
      if (value.includes("var(--")) return;

      if (hexRegex.test(value)) {
        context.report({
          node,
          messageId: "noHardcodedHex",
          data: { value: value.match(hexRegex)[0] },
        });
      }

      if (rgbaRegex.test(value)) {
        context.report({
          node,
          messageId: "noHardcodedRgba",
          data: { value: value.substring(0, 30) + (value.length > 30 ? "..." : "") },
        });
      }
    }

    function extractStringValue(node) {
      // Handle Literal: "string"
      if (node.type === "Literal" && typeof node.value === "string") {
        return { node, value: node.value };
      }
      // Handle TemplateLiteral: `string` (no expressions)
      if (node.type === "TemplateLiteral" && node.expressions.length === 0) {
        return { node, value: node.quasis[0].value.raw };
      }
      // Template literals WITH expressions are skipped intentionally:
      // Dynamic values like `#${hexValue}` are too complex to statically analyze.
      // These cases are rare and should be caught in code review.
      return null;
    }

    function checkObjectProperties(props, isStyleContext) {
      for (const prop of props) {
        if (prop.type !== "Property") continue;

        // Get property name (key)
        const keyName = prop.key.type === "Identifier" ? prop.key.name :
                        prop.key.type === "Literal" ? prop.key.value : null;

        // Only check color-related properties to avoid false positives
        // on objects like { theme: '#fff' } which aren't style objects
        if (!isStyleContext && keyName && !colorProperties.has(keyName)) continue;

        const extracted = extractStringValue(prop.value);
        if (extracted) {
          checkValue(extracted.node, extracted.value);
        }
      }
    }

    return {
      // Check style={{ color: '#fff' }}
      JSXAttribute(node) {
        if (node.name.name !== "style") return;
        if (node.value?.type !== "JSXExpressionContainer") return;

        const expr = node.value.expression;
        if (expr.type === "ObjectExpression") {
          checkObjectProperties(expr.properties, /* isStyleContext */ true);
        }
      },
      // Check const styles = { color: '#fff' } - only color properties
      // This avoids false positives on { theme: '#fff' } config objects
      VariableDeclarator(node) {
        if (node.init?.type !== "ObjectExpression") return;

        // Check variable name - only check if name suggests style context
        const varName = node.id.type === "Identifier" ? node.id.name.toLowerCase() : "";
        const isStyleVariable = varName.includes("style") || varName.includes("color");

        checkObjectProperties(node.init.properties, isStyleVariable);
      },
    };
  },
};
```

**Rule 2: no-arbitrary-text-sizes**
```javascript
// eslint-rules/no-arbitrary-text-sizes.js
module.exports = {
  meta: {
    type: "problem",
    docs: {
      description: "Disallow arbitrary text size values in Tailwind classes",
      category: "Design System",
    },
    messages: {
      noArbitraryTextSize: "Use Tailwind text size class instead of arbitrary '{{value}}'. Use: text-xs, text-sm, text-base, text-lg, text-xl, text-2xl, etc.",
    },
  },
  create(context) {
    // Matches text-[14px], text-[0.8rem], text-[1.5em], etc.
    const arbitraryTextSizeRegex = /\btext-\[[\d.]+(?:px|rem|em|%|vh|vw)\]/g;

    // Utility function names that accept class strings
    const classUtilities = new Set(["cn", "clsx", "classnames", "cva", "twMerge"]);

    function checkClassString(node, value) {
      if (typeof value !== "string") return;

      const matches = value.matchAll(arbitraryTextSizeRegex);
      for (const match of matches) {
        context.report({
          node,
          messageId: "noArbitraryTextSize",
          data: { value: match[0] },
        });
      }
    }

    function extractClassStrings(node) {
      if (node.type === "Literal" && typeof node.value === "string") {
        return [{ node, value: node.value }];
      }
      if (node.type === "TemplateLiteral") {
        return node.quasis.map((quasi) => ({ node, value: quasi.value.raw }));
      }
      if (node.type === "CallExpression") {
        const calleeName = node.callee.type === "Identifier" ? node.callee.name : null;
        if (calleeName && classUtilities.has(calleeName)) {
          const results = [];
          for (const arg of node.arguments) {
            results.push(...extractClassStrings(arg));
          }
          return results;
        }
      }
      if (node.type === "LogicalExpression") {
        return [...extractClassStrings(node.left), ...extractClassStrings(node.right)];
      }
      if (node.type === "ConditionalExpression") {
        return [...extractClassStrings(node.consequent), ...extractClassStrings(node.alternate)];
      }
      return [];
    }

    return {
      JSXAttribute(node) {
        if (node.name.name !== "className") return;

        if (node.value?.type === "Literal") {
          checkClassString(node, node.value.value);
        } else if (node.value?.type === "JSXExpressionContainer") {
          const extracted = extractClassStrings(node.value.expression);
          for (const { node: n, value } of extracted) {
            checkClassString(n, value);
          }
        }
      },
    };
  },
};
```

**Rule 3: prefer-design-system-fonts**
```javascript
// eslint-rules/prefer-design-system-fonts.js
module.exports = {
  meta: {
    type: "suggestion",
    docs: {
      description: "Prefer design system font classes over generic Tailwind fonts",
      category: "Design System",
    },
    messages: {
      preferFontBody: "Use 'font-body' instead of 'font-serif' for body text",
      preferFontUi: "Use 'font-ui' instead of 'font-sans' for UI elements",
    },
  },
  create(context) {
    // Utility function names that accept class strings
    const classUtilities = new Set(["cn", "clsx", "classnames", "cva", "twMerge"]);

    function checkClassString(node, value) {
      if (typeof value !== "string") return;

      if (/\bfont-serif\b/.test(value)) {
        context.report({ node, messageId: "preferFontBody" });
      }
      if (/\bfont-sans\b/.test(value)) {
        context.report({ node, messageId: "preferFontUi" });
      }
    }

    function extractClassStrings(node) {
      // Handle Literal: "string"
      if (node.type === "Literal" && typeof node.value === "string") {
        return [{ node, value: node.value }];
      }
      // Handle TemplateLiteral: `string` (only static parts)
      if (node.type === "TemplateLiteral") {
        return node.quasis.map((quasi) => ({ node, value: quasi.value.raw }));
      }
      // Handle cn()/clsx() calls: cn("font-serif", condition && "other")
      if (node.type === "CallExpression") {
        const calleeName = node.callee.type === "Identifier" ? node.callee.name : null;
        if (calleeName && classUtilities.has(calleeName)) {
          const results = [];
          for (const arg of node.arguments) {
            results.push(...extractClassStrings(arg));
          }
          return results;
        }
      }
      // Handle LogicalExpression: condition && "font-serif"
      if (node.type === "LogicalExpression") {
        return [
          ...extractClassStrings(node.left),
          ...extractClassStrings(node.right),
        ];
      }
      // Handle ConditionalExpression: condition ? "font-serif" : "font-sans"
      if (node.type === "ConditionalExpression") {
        return [
          ...extractClassStrings(node.consequent),
          ...extractClassStrings(node.alternate),
        ];
      }
      return [];
    }

    return {
      JSXAttribute(node) {
        if (node.name.name !== "className") return;

        if (node.value?.type === "Literal") {
          checkClassString(node, node.value.value);
        } else if (node.value?.type === "JSXExpressionContainer") {
          const extracted = extractClassStrings(node.value.expression);
          for (const { node: n, value } of extracted) {
            checkClassString(n, value);
          }
        }
      },
    };
  },
};
```

**Rule 4: prefer-warm-shadows**
```javascript
// eslint-rules/prefer-warm-shadows.js
module.exports = {
  meta: {
    type: "suggestion",
    docs: {
      description: "Prefer warm shadow variants over standard Tailwind shadows",
      category: "Design System",
    },
    messages: {
      preferWarmShadow: "Use 'shadow-warm-{{size}}' instead of 'shadow-{{size}}' for design system consistency",
    },
  },
  create(context) {
    // Utility function names that accept class strings
    const classUtilities = new Set(["cn", "clsx", "classnames", "cva", "twMerge"]);

    function checkClassString(node, value) {
      if (typeof value !== "string") return;

      // Use matchAll with new regex each time to avoid lastIndex bug
      const matches = value.matchAll(/\bshadow-(sm|md|lg|xl|2xl)\b/g);
      for (const match of matches) {
        // Skip if already using warm variant
        if (value.includes(`shadow-warm-${match[1]}`)) continue;

        context.report({
          node,
          messageId: "preferWarmShadow",
          data: { size: match[1] },
        });
      }
    }

    function extractClassStrings(node) {
      // Handle Literal: "string"
      if (node.type === "Literal" && typeof node.value === "string") {
        return [{ node, value: node.value }];
      }
      // Handle TemplateLiteral: `string` (only static parts)
      if (node.type === "TemplateLiteral") {
        return node.quasis.map((quasi) => ({ node, value: quasi.value.raw }));
      }
      // Handle cn()/clsx() calls
      if (node.type === "CallExpression") {
        const calleeName = node.callee.type === "Identifier" ? node.callee.name : null;
        if (calleeName && classUtilities.has(calleeName)) {
          const results = [];
          for (const arg of node.arguments) {
            results.push(...extractClassStrings(arg));
          }
          return results;
        }
      }
      // Handle LogicalExpression: condition && "shadow-xl"
      if (node.type === "LogicalExpression") {
        return [
          ...extractClassStrings(node.left),
          ...extractClassStrings(node.right),
        ];
      }
      // Handle ConditionalExpression: condition ? "shadow-xl" : "shadow-sm"
      if (node.type === "ConditionalExpression") {
        return [
          ...extractClassStrings(node.consequent),
          ...extractClassStrings(node.alternate),
        ];
      }
      return [];
    }

    return {
      JSXAttribute(node) {
        if (node.name.name !== "className") return;

        if (node.value?.type === "Literal") {
          checkClassString(node, node.value.value);
        } else if (node.value?.type === "JSXExpressionContainer") {
          const extracted = extractClassStrings(node.value.expression);
          for (const { node: n, value } of extracted) {
            checkClassString(n, value);
          }
        }
      },
    };
  },
};
```

**Create new eslint-rules/design-system.js** (separate from flakiness rules):
```javascript
// eslint-rules/design-system.js
const noHardcodedColors = require("./no-hardcoded-colors");
const noArbitraryTextSizes = require("./no-arbitrary-text-sizes");
const preferDesignSystemFonts = require("./prefer-design-system-fonts");
const preferWarmShadows = require("./prefer-warm-shadows");

module.exports = {
  rules: {
    "no-hardcoded-colors": noHardcodedColors,
    "no-arbitrary-text-sizes": noArbitraryTextSizes,
    "prefer-design-system-fonts": preferDesignSystemFonts,
    "prefer-warm-shadows": preferWarmShadows,
  },
};
```

**eslint-rules/index.js remains unchanged** - keeps only flakiness rules:
```javascript
// eslint-rules/index.js (NO CHANGES - keep existing flakiness rules)
module.exports = {
  rules: {
    "no-wait-for-timeout": noWaitForTimeout,
    "max-test-timeout": maxTestTimeout,
    "no-test-skip": noTestSkip,
    "no-silent-catch": noSilentCatch,
  },
};
```

**Two-Plugin Architecture Integration:**
The eslint.config.mjs will have TWO separate plugin registrations:
1. `flakiness` plugin (existing) - registered in test file config block
2. `design-system` plugin (new) - registered in src file config block

These don't conflict because:
- Different plugin namespaces (`flakiness/*` vs `design-system/*`)
- Different file patterns (`e2e/**` vs `src/**`)
- Each plugin block is self-contained with its own `plugins` object

**Update eslint.config.mjs to enable rules with separate namespace:**

**IMPORTANT: Module Consistency** - The existing eslint.config.mjs uses ESM imports with `createRequire` for CommonJS modules. Follow the same pattern:

```javascript
// At top of file (following existing pattern in eslint.config.mjs):
import { createRequire } from "module";
const require = createRequire(import.meta.url);

// Import design system rules using require (CommonJS module)
const designSystemRules = require("./eslint-rules/design-system.js");

// Add to eslintConfig array:
// Design system enforcement for all source files
{
  files: ["src/**/*.ts", "src/**/*.tsx"],
  plugins: {
    "design-system": designSystemRules,
  },
  rules: {
    "design-system/no-hardcoded-colors": "warn",
    "design-system/no-arbitrary-text-sizes": "warn",
    "design-system/prefer-design-system-fonts": "warn",
    "design-system/prefer-warm-shadows": "warn",
  },
},
// Exceptions for files with intentional hardcoding
{
  files: [
    "src/app/error.tsx",
    "src/app/global-error.tsx",
    "src/app/settings/SettingsContent.tsx",
    "src/app/(debug)/**/*.ts",
    "src/app/(debug)/**/*.tsx",
    "src/app/admin/costs/page.tsx",  // Chart labels need precise sizing
    "**/*.test.tsx",
  ],
  rules: {
    "design-system/no-hardcoded-colors": "off",
    "design-system/no-arbitrary-text-sizes": "off",
    "design-system/prefer-warm-shadows": "off",
  },
},
```

**Verification:**
- Run `npm run lint` - Should show warnings for existing violations
- Expected: ~53 hardcoded colors, ~50 generic fonts, ~21 non-warm shadows

---

### Phase 2: Fix high-priority violations
**Goal**: Clean up user-facing components

**Files to modify:**

#### Navigation.tsx (12 color values → CSS variables)
Create new CSS variables for dark nav theme with fallback values:
```css
/* Add to globals.css in :root section */
--nav-dark-bg: #0d1628;
--nav-dark-text: #ffffff;
--nav-dark-border: rgba(255, 255, 255, 0.12);
--nav-dark-search-bg: rgba(255, 255, 255, 0.08);
--nav-dark-search-border: rgba(255, 255, 255, 0.3);
--nav-dark-placeholder: rgba(255, 255, 255, 0.6);
--nav-dark-import-bg: #ffffff;
--nav-dark-import-text: #0d1628;
--nav-dark-import-border: rgba(255, 255, 255, 0.9);
```

Then update Navigation.tsx to use variables with inline fallbacks:
```tsx
const navColors = isNavDark ? {
  bg: 'var(--nav-dark-bg, #0d1628)',
  text: 'var(--nav-dark-text, #ffffff)',
  border: 'var(--nav-dark-border, rgba(255, 255, 255, 0.12))',
  searchBg: 'var(--nav-dark-search-bg, rgba(255, 255, 255, 0.08))',
  searchBorder: 'var(--nav-dark-search-border, rgba(255, 255, 255, 0.3))',
  placeholder: 'var(--nav-dark-placeholder, rgba(255, 255, 255, 0.6))',
  importBg: 'var(--nav-dark-import-bg, #ffffff)',
  importText: 'var(--nav-dark-import-text, #0d1628)',
  importBorder: 'var(--nav-dark-import-border, rgba(255, 255, 255, 0.9))',
} : { /* light mode uses existing theme variables */ };
```

**Note:** Fallback values ensure the UI remains functional even if CSS fails to load.

#### SearchBar.tsx (4 values → use Navigation's dark mode context)
- Use same CSS variables as Navigation
- Remove duplicate hardcoded fallbacks

#### results/page.tsx (8 scrollbar colors → CSS variables)
Create scrollbar tokens with fallbacks:
```css
/* Add to globals.css in :root section */
/* First, add RGB variant for text-secondary */
--text-secondary-rgb: 74, 74, 90; /* matches #4a4a5a */

/* Scrollbar tokens with fallbacks */
--scrollbar-thumb: rgba(var(--text-secondary-rgb, 156, 163, 175), 0.5);
--scrollbar-thumb-hover: rgba(var(--text-secondary-rgb, 156, 163, 175), 0.7);
--scrollbar-thumb-active: rgba(var(--text-secondary-rgb, 156, 163, 175), 0.9);

/* Dark mode overrides in .dark section */
.dark {
  --text-secondary-rgb: 138, 138, 151; /* matches dark mode text-secondary */
}
```

Then update results/page.tsx:
```tsx
// Replace hardcoded rgba values with CSS variables
scrollbarColor: 'var(--scrollbar-thumb) transparent'

// For webkit scrollbar styles:
'&::-webkit-scrollbar-thumb': {
  background: 'var(--scrollbar-thumb)',
}
'&::-webkit-scrollbar-thumb:hover': {
  background: 'var(--scrollbar-thumb-hover)',
}
'&::-webkit-scrollbar-thumb:active': {
  background: 'var(--scrollbar-thumb-active)',
}
```

#### Admin modals (5 shadow instances)
Replace in each file:
- `shadow-xl` → `shadow-warm-xl`

Files:
- `src/components/admin/CandidatesContent.tsx`
- `src/components/admin/ExplanationDetailModal.tsx`
- `src/components/admin/ReportsTable.tsx`
- `src/components/admin/UserDetailModal.tsx`
- `src/components/admin/WhitelistContent.tsx`

#### UI Components (shadow fixes)
- `src/components/ui/sheet.tsx` - `shadow-2xl` → `shadow-warm-xl`
- `src/components/AIEditorPanel.tsx` - `hover:shadow-md` → `hover:shadow-warm-md`
- `src/components/Navigation.tsx` - `shadow-md` → `shadow-warm-md`
- `src/components/ReportContentButton.tsx` - `shadow-xl` → `shadow-warm-xl`

---

### Phase 3: Fix typography violations
**Goal**: Replace generic fonts with design system classes

**Global change in layout.tsx:**
```tsx
// Change default body font from font-serif to font-body
<body className={`... font-body antialiased ...`}>
```

**Component-specific changes:**
Search and replace across codebase:
- `font-serif` → `font-body` (where used for body text)
- `font-sans` → `font-ui` (where used for UI elements)

**Files with most violations:**
- `src/app/results/page.tsx` - 8 instances
- `src/components/ExplanationsTablePage.tsx` - 15 instances
- `src/editorFiles/lexicalEditor/LexicalEditor.tsx` - 8 instances
- `src/components/AIEditorPanel.tsx` - 4 instances
- `src/app/login/page.tsx` - 4 instances

**Arbitrary text sizes to fix:**
- `src/components/ui/form.tsx` - `text-[0.8rem]` → `text-xs`
- `src/app/(debug)/*` - Leave as-is (debug pages exempted)
- `src/app/admin/costs/page.tsx` - `text-[8px]` → `text-[8px]` (keep - chart labels)

---

### Phase 4: Upgrade warnings to errors (Gradual)
**Goal**: Prevent future violations with safe rollout

**Step 4a: Verify zero warnings (GATE)**
```bash
# Run lint and confirm 0 warnings for design system rules
npm run lint 2>&1 | grep -E "(no-hardcoded-colors|no-arbitrary-text-sizes|prefer-design-system-fonts|prefer-warm-shadows)" | wc -l
# Expected: 0
```
**GATE CRITERIA:** Must have 0 violations before proceeding to Step 4b.

**Step 4b: Upgrade to errors in stages**
```javascript
// Stage 1: Upgrade color and text size rules
rules: {
  "design-system/no-hardcoded-colors": "error",
  "design-system/no-arbitrary-text-sizes": "error",
  "design-system/prefer-design-system-fonts": "warn",  // keep warn
  "design-system/prefer-warm-shadows": "warn",         // keep warn
},
```

**SUCCESS CRITERIA for Stage 1 → Stage 2:**
1. ✅ 5 consecutive CI runs pass (no lint failures)
2. ✅ No developer complaints or eslint-disable comments added
3. ✅ No rollbacks triggered in 48 hours

```javascript
// Stage 2: After criteria met, upgrade remaining rules
rules: {
  "design-system/no-hardcoded-colors": "error",
  "design-system/no-arbitrary-text-sizes": "error",
  "design-system/prefer-design-system-fonts": "error",
  "design-system/prefer-warm-shadows": "error",
},
```

**SUCCESS CRITERIA for Stage 2 (Final):**
1. ✅ 10 consecutive CI runs pass
2. ✅ No eslint-disable comments for design system rules in new code
3. ✅ All 7 themes render correctly in visual tests

**Step 4c: Monitor CI for failures**
- Review first 5-10 CI runs after each upgrade
- Be ready to rollback if unexpected failures occur
- Track: CI failure rate, time-to-fix for any issues

---

## Rollback Strategy

If enforcement causes unexpected issues:

### Immediate Rollback (< 5 min)
```javascript
// eslint.config.mjs - change all design-system rules to "off"
rules: {
  "design-system/no-hardcoded-colors": "off",
  "design-system/no-arbitrary-text-sizes": "off",
  "design-system/prefer-design-system-fonts": "off",
  "design-system/prefer-warm-shadows": "off",
},
```

### Partial Rollback (disable specific rule)
```javascript
// If only one rule is problematic, disable just that rule
"design-system/no-hardcoded-colors": "off",  // Keep others enabled
```

### Revert Commit
```bash
# If CSS variable changes break themes
git revert HEAD~1  # Revert most recent commit
# Or revert specific commit
git revert <commit-hash>
```

### Emergency: Bypass for PR
```javascript
// Add to specific file to bypass rule
/* eslint-disable design-system/no-hardcoded-colors */
```

---

## Testing

### Unit Tests for ESLint Rules
Create test files for each custom rule with comprehensive coverage:

**`eslint-rules/no-hardcoded-colors.test.js`:**
```javascript
const { RuleTester } = require("eslint");
const rule = require("./no-hardcoded-colors");

const ruleTester = new RuleTester({
  parserOptions: { ecmaVersion: 2020, ecmaFeatures: { jsx: true } },
});

ruleTester.run("no-hardcoded-colors", rule, {
  valid: [
    // CSS variables - should pass
    `<div style={{ color: 'var(--text-primary)' }} />`,
    `<div style={{ backgroundColor: 'var(--bg-surface)' }} />`,
    `<div style={{ borderColor: 'rgba(var(--accent-gold-rgb), 0.5)' }} />`,

    // CSS keywords - should pass
    `<div style={{ color: 'transparent' }} />`,
    `<div style={{ color: 'inherit' }} />`,
    `<div style={{ color: 'currentColor' }} />`,
    `<div style={{ color: 'initial' }} />`,

    // Non-style props - should pass
    `<div data-color="#fff" />`,
    `<input placeholder="#ffffff" />`,

    // Template literals with CSS vars - should pass
    { code: "<div style={{ color: `var(--text-primary)` }} />" },

    // Object outside JSX style prop - no false positives
    `const config = { theme: '#fff' };`,  // non-style context
  ],
  invalid: [
    // Hex colors - 3 digit
    {
      code: `<div style={{ color: '#fff' }} />`,
      errors: [{ messageId: "noHardcodedHex" }],
    },
    // Hex colors - 6 digit
    {
      code: `<div style={{ color: '#ffffff' }} />`,
      errors: [{ messageId: "noHardcodedHex" }],
    },
    // Hex colors - 8 digit (with alpha)
    {
      code: `<div style={{ color: '#ffffff80' }} />`,
      errors: [{ messageId: "noHardcodedHex" }],
    },
    // Hex in background
    {
      code: `<div style={{ backgroundColor: '#0d1628' }} />`,
      errors: [{ messageId: "noHardcodedHex" }],
    },
    // RGBA with hardcoded values
    {
      code: `<div style={{ backgroundColor: 'rgba(255,255,255,0.5)' }} />`,
      errors: [{ messageId: "noHardcodedRgba" }],
    },
    // RGBA with spaces
    {
      code: `<div style={{ backgroundColor: 'rgba( 255, 255, 255, 0.5 )' }} />`,
      errors: [{ messageId: "noHardcodedRgba" }],
    },
    // RGB (no alpha)
    {
      code: `<div style={{ color: 'rgb(255, 255, 255)' }} />`,
      errors: [{ messageId: "noHardcodedRgba" }],
    },
    // Template literal with hardcoded color
    {
      code: "<div style={{ color: `#ffffff` }} />",
      errors: [{ messageId: "noHardcodedHex" }],
    },
    // Multiple violations in one style object
    {
      code: `<div style={{ color: '#fff', backgroundColor: '#000' }} />`,
      errors: [{ messageId: "noHardcodedHex" }, { messageId: "noHardcodedHex" }],
    },
  ],
});
```

**`eslint-rules/no-arbitrary-text-sizes.test.js`:**
```javascript
const { RuleTester } = require("eslint");
const rule = require("./no-arbitrary-text-sizes");

const ruleTester = new RuleTester({
  parserOptions: { ecmaVersion: 2020, ecmaFeatures: { jsx: true } },
});

ruleTester.run("no-arbitrary-text-sizes", rule, {
  valid: [
    // Standard Tailwind text sizes - should pass
    `<div className="text-xs" />`,
    `<div className="text-sm" />`,
    `<div className="text-base" />`,
    `<div className="text-lg" />`,
    `<div className="text-xl" />`,
    `<div className="text-2xl" />`,
    `<div className="text-3xl" />`,

    // Non-text arbitrary values - should pass
    `<div className="w-[100px]" />`,
    `<div className="h-[50vh]" />`,
    `<div className="p-[10px]" />`,

    // Text color with arbitrary - should pass (not size)
    `<div className="text-[#fff]" />`,
  ],
  invalid: [
    // Arbitrary pixel sizes
    {
      code: `<div className="text-[14px]" />`,
      errors: [{ messageId: "noArbitraryTextSize" }],
    },
    {
      code: `<div className="text-[16px]" />`,
      errors: [{ messageId: "noArbitraryTextSize" }],
    },
    // Arbitrary rem sizes
    {
      code: `<div className="text-[0.8rem]" />`,
      errors: [{ messageId: "noArbitraryTextSize" }],
    },
    {
      code: `<div className="text-[1.5rem]" />`,
      errors: [{ messageId: "noArbitraryTextSize" }],
    },
    // Arbitrary em sizes
    {
      code: `<div className="text-[1.2em]" />`,
      errors: [{ messageId: "noArbitraryTextSize" }],
    },
    // Very small sizes (like chart labels)
    {
      code: `<div className="text-[8px]" />`,
      errors: [{ messageId: "noArbitraryTextSize" }],
    },
    // Multiple arbitrary sizes
    {
      code: `<div className="text-[14px] md:text-[16px]" />`,
      errors: [{ messageId: "noArbitraryTextSize" }, { messageId: "noArbitraryTextSize" }],
    },
    // With cn() utility
    {
      code: `<div className={cn("text-[14px]", condition && "text-[16px]")} />`,
      errors: [{ messageId: "noArbitraryTextSize" }, { messageId: "noArbitraryTextSize" }],
    },
  ],
});
```

**`eslint-rules/prefer-design-system-fonts.test.js`:**
```javascript
const { RuleTester } = require("eslint");
const rule = require("./prefer-design-system-fonts");

const ruleTester = new RuleTester({
  parserOptions: { ecmaVersion: 2020, ecmaFeatures: { jsx: true } },
});

ruleTester.run("prefer-design-system-fonts", rule, {
  valid: [
    // Design system font classes - should pass
    `<div className="font-body" />`,
    `<div className="font-display" />`,
    `<div className="font-ui" />`,
    `<div className="font-mono" />`,

    // Non-font classes - should pass
    `<div className="bg-white text-lg" />`,

    // Font in non-className props - should pass
    `<div data-font="font-serif" />`,

    // Empty className - should pass
    `<div className="" />`,
  ],
  invalid: [
    // Generic font-serif
    {
      code: `<div className="font-serif text-lg" />`,
      errors: [{ messageId: "preferFontBody" }],
    },
    // Generic font-sans
    {
      code: `<div className="font-sans text-sm" />`,
      errors: [{ messageId: "preferFontUi" }],
    },
    // Both generic fonts in one className
    {
      code: `<div className="font-serif font-sans" />`,
      errors: [{ messageId: "preferFontBody" }, { messageId: "preferFontUi" }],
    },
    // Font class with other Tailwind utilities
    {
      code: `<div className="bg-white font-serif text-lg p-4" />`,
      errors: [{ messageId: "preferFontBody" }],
    },
  ],
});
```

**`eslint-rules/prefer-warm-shadows.test.js`:**
```javascript
const { RuleTester } = require("eslint");
const rule = require("./prefer-warm-shadows");

const ruleTester = new RuleTester({
  parserOptions: { ecmaVersion: 2020, ecmaFeatures: { jsx: true } },
});

ruleTester.run("prefer-warm-shadows", rule, {
  valid: [
    // Warm shadow variants - should pass
    `<div className="shadow-warm-sm" />`,
    `<div className="shadow-warm-md" />`,
    `<div className="shadow-warm-lg" />`,
    `<div className="shadow-warm-xl" />`,
    `<div className="shadow-warm-2xl" />`,

    // Non-sized shadows - should pass (not enforced)
    `<div className="shadow" />`,
    `<div className="shadow-none" />`,

    // Custom shadows - should pass
    `<div className="shadow-gold-glow" />`,
    `<div className="shadow-page" />`,

    // Hover states with warm shadow
    `<div className="hover:shadow-warm-md" />`,
  ],
  invalid: [
    // Generic shadow-sm
    {
      code: `<div className="shadow-sm" />`,
      errors: [{ messageId: "preferWarmShadow", data: { size: "sm" } }],
    },
    // Generic shadow-md
    {
      code: `<div className="shadow-md" />`,
      errors: [{ messageId: "preferWarmShadow", data: { size: "md" } }],
    },
    // Generic shadow-lg
    {
      code: `<div className="shadow-lg" />`,
      errors: [{ messageId: "preferWarmShadow", data: { size: "lg" } }],
    },
    // Generic shadow-xl
    {
      code: `<div className="shadow-xl" />`,
      errors: [{ messageId: "preferWarmShadow", data: { size: "xl" } }],
    },
    // Generic shadow-2xl
    {
      code: `<div className="shadow-2xl" />`,
      errors: [{ messageId: "preferWarmShadow", data: { size: "2xl" } }],
    },
    // Multiple shadows (tests lastIndex bug fix)
    {
      code: `<div className="shadow-sm shadow-lg" />`,
      errors: [
        { messageId: "preferWarmShadow", data: { size: "sm" } },
        { messageId: "preferWarmShadow", data: { size: "lg" } },
      ],
    },
    // Shadow with other classes
    {
      code: `<div className="bg-white shadow-xl p-4 rounded-lg" />`,
      errors: [{ messageId: "preferWarmShadow", data: { size: "xl" } }],
    },
  ],
});
```

**Run tests:**
```bash
# ESLint's RuleTester is self-contained and runs with Node directly
# No need for a test framework - it throws on failure

# Add test script to package.json
"scripts": {
  "test:eslint-rules": "node eslint-rules/no-hardcoded-colors.test.js && node eslint-rules/no-arbitrary-text-sizes.test.js && node eslint-rules/prefer-design-system-fonts.test.js && node eslint-rules/prefer-warm-shadows.test.js"
}

# Run ESLint rule unit tests
npm run test:eslint-rules
# Success: no output (RuleTester exits silently on success)
# Failure: throws error with details about which test failed
```

**CI Integration for ESLint rule tests:**
Add to package.json:
```json
"scripts": {
  "test:all": "npm run test && npm run test:eslint-rules"
}
```
Update CI workflow to run `npm run test:all` instead of just `npm run test`.

### Lint Verification
```bash
# Run lint and capture output
npm run lint 2>&1 | tee lint-output.txt

# Count violations by rule
grep -c "no-arbitrary-value" lint-output.txt
grep -c "no-hardcoded-colors" lint-output.txt
grep -c "prefer-design-system-fonts" lint-output.txt
grep -c "prefer-warm-shadows" lint-output.txt
```

### Visual Regression Testing

**Approach:** Use existing E2E infrastructure with Playwright screenshots for visual verification.

**Phase-gated visual checks:**

**After Phase 2 (color fixes):**
```typescript
// e2e/visual/design-system-colors.spec.ts
import { test, expect } from "@playwright/test";

test.describe("Design System Color Verification", () => {
  const themes = ["default", "dark", "sepia", "high-contrast", "forest", "ocean", "midnight"];

  for (const theme of themes) {
    test(`Navigation renders correctly in ${theme} theme`, async ({ page }) => {
      await page.goto("/");
      await page.evaluate((t) => localStorage.setItem("theme", t), theme);
      await page.reload();

      // Screenshot navigation bar
      const nav = page.locator("nav").first();
      await expect(nav).toHaveScreenshot(`nav-${theme}.png`, { maxDiffPixels: 100 });
    });

    test(`Results page scrollbars render correctly in ${theme} theme`, async ({ page }) => {
      await page.goto("/results/test-id");
      await page.evaluate((t) => localStorage.setItem("theme", t), theme);
      await page.reload();

      // Screenshot scrollable container
      const container = page.locator("[data-testid='results-container']");
      await expect(container).toHaveScreenshot(`results-scrollbar-${theme}.png`, { maxDiffPixels: 100 });
    });
  }
});
```

**After Phase 3 (typography fixes):**
```typescript
// e2e/visual/design-system-typography.spec.ts
test.describe("Design System Typography Verification", () => {
  test("Body text uses correct font family", async ({ page }) => {
    await page.goto("/results/test-id");
    const bodyText = page.locator("article p").first();
    const fontFamily = await bodyText.evaluate((el) => getComputedStyle(el).fontFamily);
    expect(fontFamily).toContain("Merriweather"); // font-body maps to Merriweather
  });

  test("UI elements use correct font family", async ({ page }) => {
    await page.goto("/");
    const button = page.locator("button").first();
    const fontFamily = await button.evaluate((el) => getComputedStyle(el).fontFamily);
    expect(fontFamily).toContain("Inter"); // font-ui maps to Inter
  });
});
```

**Manual visual checklist (run after each phase):**
- [ ] Test all 7 theme variants in browser
- [ ] Check dark mode specifically (most hardcoded values are dark mode related)
- [ ] Verify Navigation appearance on landing page (dark nav)
- [ ] Verify scrollbars in results page
- [ ] Check admin modals for correct shadow warmth
- [ ] Verify hover states on interactive elements

**Prerequisites for visual tests:**
These visual tests require adding `data-testid` attributes to components:
- `src/app/results/page.tsx`: Add `data-testid="results-container"` to scrollable container

If test IDs don't exist, add them as part of Phase 3 fixes:
```tsx
// In results/page.tsx
<div data-testid="results-container" className="...">
```

**Baseline screenshots:**
- Generate baseline screenshots before any changes: `npm run test:e2e -- --update-snapshots`
- Store in `e2e/visual/snapshots/` directory
- Compare after changes to detect regressions

### CI Integration
Lint runs in existing CI pipeline via `npm run lint`. No additional configuration needed.

Visual regression tests run as part of E2E suite: `npm run test:e2e`.

---

## Documentation Updates

### Files to Update:
1. **`docs/docs_overall/design_style_guide.md`**
   - Add "Enforcement" section documenting ESLint rules
   - Add migration guide for common violations

2. **`CLAUDE.md`**
   - Add note about design system enforcement
   - Reference ESLint rules

3. **`eslint-rules/README.md`** (new file)
   - Document all custom rules including design system rules
   - Include examples of valid/invalid code

---

## Summary of Changes

| Phase | Files Modified | New Files | Effort |
|-------|---------------|-----------|--------|
| 1 | `eslint.config.mjs` | 5 rule files (4 rules + index) + 4 test files | Medium |
| 2 | Navigation, SearchBar, results/page, 5 admin files, 4 UI files, `globals.css` | - | Medium |
| 3 | ~15 component files, `layout.tsx` | - | Medium |
| 4 | `eslint.config.mjs` | - | Small |

**Total new ESLint rules:** 4 custom rules
**Total files to fix:** ~25 files
**Expected lint output after Phase 4:** 0 violations (clean build)
