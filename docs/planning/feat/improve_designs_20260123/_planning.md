# Improve Designs Plan

## Background
The ExplainAnything site uses a "Midnight Scholar" design system with warm copper/gold accents, paper textures, and book-inspired aesthetics. Exploration revealed both design system compliance issues and visual polish opportunities.

## Problem
Three categories of issues were found:
1. **Design system compliance** - Hardcoded colors, non-standard shadows, inconsistent border radius
2. **Typography consistency** - Undersized headings, wrong fonts for prose, inconsistent page header alignment
3. **Visual polish** - Missing decorative elements, animations, hover effects on some pages

---

## High Priority - Design System Compliance

### Issue 1: Admin Dashboard Hardcoded Tailwind Colors
**File:** `src/app/admin/page.tsx`

**Problem:** System Health Banner uses hardcoded Tailwind colors instead of design tokens:
```tsx
// Lines 68-95 use:
bg-green-50, border-green-200, text-green-800  // healthy
bg-yellow-50, border-yellow-200, text-yellow-800  // warning
bg-red-50, border-red-200, text-red-800  // error
```

**Fix:** Use design system status tokens:
```tsx
bg-[var(--status-success)]/10 border-[var(--status-success)]/20 text-[var(--status-success)]
bg-[var(--status-warning)]/10 border-[var(--status-warning)]/20 text-[var(--status-warning)]
bg-[var(--status-error)]/10 border-[var(--status-error)]/20 text-[var(--status-error)]
```

### Issue 2: Checkbox Component Uses Generic Primary
**File:** `src/components/ui/checkbox.tsx`

**Problem:** Uses shadcn default `primary` token instead of Midnight Scholar accents:
```tsx
// Line 14-17
"border-primary ... data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground"
```

**Fix:** Use gold accent for checked state:
```tsx
"border-[var(--border-default)] ... data-[state=checked]:bg-[var(--accent-gold)] data-[state=checked]:text-white"
```

### Issue 3: Navigation Hardcoded White Underlines
**File:** `src/app/globals.css` (lines 1797-1802)

**Problem:** Dark nav uses hardcoded `#ffffff` instead of gold:
```css
.scholar-nav.dark-nav .scholar-nav-link::after {
  background: #ffffff;
}
.scholar-nav.dark-nav .scholar-nav-link:hover {
  color: #ffffff;
}
```

**Fix:**
```css
.scholar-nav.dark-nav .scholar-nav-link::after {
  background: var(--accent-gold);
}
.scholar-nav.dark-nav .scholar-nav-link:hover {
  color: var(--accent-gold);
}
```

### Issue 4: Dialog Overlay Hardcoded Opacity
**File:** `src/components/ui/dialog.tsx` (line 24)

**Problem:** Uses `bg-black/80` hardcoded:
```tsx
className={cn("... bg-black/80 ...", className)}
```

**Fix:** Use theme-aware scrim or lighter opacity:
```tsx
className={cn("... bg-black/60 dark:bg-black/70 ...", className)}
```

---

## Medium Priority - Consistency Issues

### Issue 5: Border Radius Inconsistency (~150 instances)
**Files:** Multiple admin pages, UI components

**Problem:** Uses `rounded-md`, `rounded-lg` instead of design system tokens:
- `rounded-md` (0.375rem) → should be `rounded-page`
- `rounded-lg` (0.5rem) → should be `rounded-book`

**Key files:**
- `src/app/admin/page.tsx` - `rounded-lg`
- `src/app/admin/costs/page.tsx` - `rounded-lg`, `rounded-md`
- `src/components/ui/select.tsx` - `rounded-md`
- `src/components/ui/dialog.tsx` - `sm:rounded-lg`

### Issue 6: Non-Standard Shadows (~40 instances)
**Files:** Debug pages, some admin components

**Problem:** Uses `shadow-sm`, `shadow-md`, `shadow-lg` instead of `shadow-warm-*`:
- `src/app/(debug)/editorTest/page.tsx` - `shadow-lg`
- `src/app/(debug)/diffTest/page.tsx` - `shadow-lg`

### Issue 7: Admin Sidebar Active State
**File:** `src/components/admin/AdminSidebar.tsx` (line 66)

**Problem:** Uses `text-white` instead of design token:
```tsx
? 'bg-[var(--accent-gold)] text-white'
```

**Fix:**
```tsx
? 'bg-[var(--accent-gold)] text-[var(--surface-primary)]'
```

---

## Typography Consistency Issues

### Font Usage: ✅ Strong (Minor Issues)

**Overall:** Font classes (`font-display`, `font-body`, `font-ui`, `font-mono`) are used correctly throughout.

#### Issue 8: Empty State Uses Wrong Font
**File:** `src/app/userlibrary/page.tsx` (line 61)

**Problem:** Empty state prose uses `font-display` (heading font) instead of `font-body`:
```tsx
// CURRENT (WRONG)
<p className="text-lg font-display text-[var(--text-primary)]">Nothing saved yet</p>
```

**Fix:**
```tsx
<p className="text-lg font-body text-[var(--text-primary)]">Nothing saved yet</p>
```

#### Issue 9: Legacy Atlas Classes (Low Priority)
**Files:** `src/app/page.tsx`, `src/components/SearchBar.tsx`

**Problem:** Some files use legacy `atlas-*` classes instead of modern `font-*` system:
- `atlas-display` → `font-display`
- `atlas-ui` → `font-ui`
- `atlas-body` → `font-body`

**Note:** These work correctly but use old naming convention.

---

### Text Size: ⚠️ Inconsistencies Found

#### Issue 10: Settings Page Headers Undersized (HIGH)
**File:** `src/app/settings/SettingsContent.tsx`

**Problem:** H2 section headers use `text-lg` instead of design system's `text-2xl`:
```tsx
// Lines 32, 101, 148, 164 - CURRENT (UNDERSIZED)
<h2 className="font-display text-lg font-semibold">

// SHOULD BE
<h2 className="font-display text-2xl font-semibold">
```

**Design System Scale:**
- H1: `text-4xl` (2.25rem)
- H2: `text-2xl` (1.75rem) ← Settings uses `text-lg` instead
- H3: `text-xl` (1.375rem)

#### Issue 11: Settings Subheading Undersized (MEDIUM)
**File:** `src/app/settings/SettingsContent.tsx` (line 181)

**Problem:** H3 uses `text-base` instead of `text-lg`:
```tsx
// CURRENT
<h3 className="font-display text-base font-semibold">

// SHOULD BE
<h3 className="font-display text-lg font-semibold">
```

#### Issue 12: Card Title Hierarchy (Review Needed)
**Files:** `src/components/explore/FeedCard.tsx` (line 127), `ExplanationCard.tsx` (line 113)

**Observation:** Card titles use `text-lg` - may need `text-xl` for better visual hierarchy. Review if undersized.

---

### Text Alignment: ❌ Inconsistent

#### Issue 13: Page Headers Mixed Alignment (HIGH)
**Pattern Inconsistency:**
| Page | Alignment | Class |
|------|-----------|-------|
| Home | Centered | `text-center` ✓ |
| Login | Centered | `text-center` ✓ |
| User Library | Left | Missing alignment |
| Explore | Left | Missing alignment |
| Settings | Left | Missing alignment |

**Files needing fixes:**
- `src/app/userlibrary/page.tsx` (line 43) - Add `text-center` to header
- `src/components/explore/ExploreGalleryPage.tsx` (line 43) - Add `text-center` to header

**Decision needed:** Should section pages be centered or left-aligned? Currently inconsistent.

#### Issue 14: Responsive Alignment Missing
**Problem:** Layout changes at breakpoints but alignment doesn't adjust.

**Example:** `src/app/error/page.tsx` (line 56)
```tsx
// Changes from vertical to horizontal but no alignment adjustment
<CardFooter className="flex flex-col gap-2 sm:flex-row">
// Missing: sm:justify-end or sm:justify-between
```

---

### Alignment Patterns That ARE Consistent (Good)

| Pattern | Status | Notes |
|---------|--------|-------|
| Card content | ✅ Left-aligned | All cards consistent |
| Empty states | ✅ Centered | All use `text-center` + `mx-auto` |
| Tables | ✅ Excellent | Left data, center empty, right actions |
| Navigation | ✅ Consistent | `flex justify-between items-center` |
| Button icons | ✅ Consistent | `items-center justify-center` |
| Dialog footers | ✅ Consistent | Right-aligned with `justify-end` |

---

## Low Priority - Visual Polish

### Polish 1: User Library Missing Flourish
**File:** `src/app/userlibrary/page.tsx`

Add `title-flourish`, entrance animation, and paper texture to match Settings page.

### Polish 2: Feed Card Hover Effect
**File:** `src/app/globals.css`

Add subtle lift on hover for better interactivity feedback.

### Polish 3: Home Page Import Link
**File:** `src/app/page.tsx`

Add `gold-underline` class to "Or import from AI" link.

---

## Why ESLint Didn't Catch These Issues

### Gap 1: Tailwind Color Classes Not Detected
**Rule:** `no-hardcoded-colors`

**What it checks:**
- Inline `style={{ color: '#fff' }}` props
- Variables with "style" or "color" in the name

**What it DOESN'T check:**
- Tailwind className strings like `bg-green-50`, `text-red-700`
- This is why admin dashboard's `bg-green-50` wasn't caught

**Why:** The rule uses regex for hex (`#fff`) and rgba values only, not Tailwind color utility classes.

### Gap 2: No Border Radius Rule Exists
**Missing rule:** No enforcement of `rounded-book`/`rounded-page`

The design system defines:
- `rounded-book` (0.5rem) for cards
- `rounded-page` (0.375rem) for inputs

But there's no ESLint rule to catch `rounded-md`/`rounded-lg` usage.

### Gap 3: CSS Files Not Linted
**Rule scope:** Only `src/**/*.ts` and `src/**/*.tsx`

The `globals.css` hardcoded `#ffffff` in nav styles isn't linted because CSS files aren't in scope.

### Gap 4: Exemptions Too Broad
**Exempted files:**
- `src/app/admin/costs/page.tsx` - intentionally exempted
- `src/app/(debug)/**` - debug pages exempted

But `src/app/admin/page.tsx` (main dashboard) is NOT exempted, yet still uses Tailwind color classes that slip through Gap 1.

### Gap 5: Rule Checks Wrong Pattern for Shadows
**Rule:** `prefer-warm-shadows` checks for `shadow-sm/md/lg/xl/2xl`

This should work, but many shadow violations are in exempted files (debug pages).

### Gap 6: Typography Scale Not Enforced
**Rule:** `no-arbitrary-text-sizes` only catches `text-[14px]` patterns

**What it DOESN'T check:**
- Wrong standard sizes (e.g., `text-lg` on H2 instead of `text-2xl`)
- Heading elements missing correct size classes
- Typography scale compliance

**Example missed:** `<h2 className="text-lg">` passes lint but violates design system (should be `text-2xl`).

### Gap 7: Font Context Not Validated
**Rule:** `prefer-design-system-fonts` only catches `font-serif`/`font-sans`

**What it DOESN'T check:**
- Prose elements using `font-display` (wrong font for context)
- Headings missing `font-display`
- Whether the font matches the element's semantic purpose

**Example missed:** `<p className="font-display">Body text</p>` passes lint but uses heading font on prose.

### Gap 8: Inline Typography Not Checked
**Existing rules:** Only check `className` attribute

**What they MISS:**
- `style={{ fontSize: '14px' }}` - bypasses all className rules
- `style={{ fontFamily: 'Arial' }}` - bypasses font rules

**Impact:** Developers can circumvent design system by using inline styles.

---

## Phased Execution Plan

### Phase 1: High Priority Compliance (4 issues)
1. Fix admin dashboard status colors
2. Fix checkbox component
3. Fix nav underline colors in CSS
4. Fix dialog overlay

### Phase 2: Typography Consistency (5 issues)
1. Fix Settings page H2 headers - `text-lg` → `text-2xl` (lines 32, 101, 148, 164)
2. Fix Settings page H3 subheading - `text-base` → `text-lg` (line 181)
3. Fix User Library empty state font - `font-display` → `font-body` (line 61)
4. Standardize page header alignment - decide centered vs left, apply consistently
5. Add responsive alignment to flex layouts that change direction

### Phase 3: Medium Priority Consistency
1. Audit and fix border radius in key UI components
2. Fix admin sidebar active state

### Phase 4: Visual Polish
1. User Library page flourish/animation
2. Feed card hover effect
3. Home page import link

### Phase 5: New ESLint Rules to Prevent Future Violations

#### Rule 1: `no-tailwind-color-classes`
**File:** `eslint-rules/no-tailwind-color-classes.js`

**Purpose:** Detect non-design-system Tailwind color classes in className attributes.

**Pattern to detect:**
```regex
\b(bg|text|border|ring|outline|shadow|from|via|to)-(red|green|blue|yellow|orange|purple|pink|gray|slate|zinc|neutral|stone|amber|lime|emerald|teal|cyan|sky|indigo|violet|fuchsia|rose)-\d{2,3}\b
```

**Allowed exceptions:**
- Classes using CSS variables: `bg-[var(--status-success)]`
- Semantic Tailwind colors: `bg-transparent`, `bg-current`, `bg-inherit`

**Implementation:**
```js
module.exports = {
  meta: {
    type: 'problem',
    docs: { description: 'Disallow Tailwind color classes; use design system tokens' },
    messages: {
      noTailwindColor: "Use design system token instead of '{{class}}'. Example: bg-[var(--status-success)]",
    },
  },
  create(context) {
    const colorPattern = /\b(bg|text|border|ring|outline|shadow|from|via|to)-(red|green|blue|yellow|orange|purple|pink|gray|slate|zinc|neutral|stone|amber|lime|emerald|teal|cyan|sky|indigo|violet|fuchsia|rose)-\d{2,3}\b/g;

    function checkClassString(node, value) {
      if (typeof value !== 'string') return;
      const matches = value.matchAll(colorPattern);
      for (const match of matches) {
        context.report({
          node,
          messageId: 'noTailwindColor',
          data: { class: match[0] },
        });
      }
    }
    // ... className extraction logic (same as prefer-warm-shadows)
  },
};
```

#### Rule 2: `prefer-design-radius`
**File:** `eslint-rules/prefer-design-radius.js`

**Purpose:** Enforce `rounded-book`/`rounded-page` over `rounded-md`/`rounded-lg`.

**Mapping:**
| Tailwind | Design System | Usage |
|----------|---------------|-------|
| `rounded-md` | `rounded-page` | Inputs, small elements |
| `rounded-lg` | `rounded-book` | Cards, containers |

**Implementation:**
```js
module.exports = {
  meta: {
    type: 'suggestion',
    docs: { description: 'Prefer design system radius tokens' },
    messages: {
      preferPageRadius: "Use 'rounded-page' instead of 'rounded-md'",
      preferBookRadius: "Use 'rounded-book' instead of 'rounded-lg'",
    },
  },
  create(context) {
    function checkClassString(node, value) {
      if (typeof value !== 'string') return;
      if (/\brounded-md\b/.test(value) && !value.includes('rounded-page')) {
        context.report({ node, messageId: 'preferPageRadius' });
      }
      if (/\brounded-lg\b/.test(value) && !value.includes('rounded-book')) {
        context.report({ node, messageId: 'preferBookRadius' });
      }
    }
    // ... className extraction logic
  },
};
```

#### Rule 3: `enforce-heading-typography`
**File:** `eslint-rules/enforce-heading-typography.js`

**Purpose:** Ensure heading elements use correct font and size per design system scale.

**Design System Scale:**
| Element | Required Font | Required Size | Common Violations |
|---------|---------------|---------------|-------------------|
| `h1` | `font-display` | `text-4xl` | Missing font, wrong size |
| `h2` | `font-display` | `text-2xl` | Using `text-lg` instead |
| `h3` | `font-display` | `text-xl` | Using `text-base` instead |
| `h4` | `font-display` | `text-lg` | Missing font class |

**Checks both:**
- Tailwind className: `<h2 className="text-lg">` → Error
- Inline styles: `<h2 style={{ fontSize: '14px' }}>` → Error

**Implementation:**
```js
module.exports = {
  meta: {
    type: 'problem',
    docs: { description: 'Enforce design system typography on heading elements' },
    messages: {
      wrongHeadingSize: "{{element}} should use '{{expected}}' instead of '{{actual}}' per design system",
      missingHeadingFont: "{{element}} should include 'font-display' class",
      noInlineFontSize: "Use Tailwind class instead of inline fontSize on {{element}}",
    },
  },
  create(context) {
    const headingSizes = {
      h1: { expected: 'text-4xl', wrong: ['text-3xl', 'text-2xl', 'text-xl', 'text-lg', 'text-base'] },
      h2: { expected: 'text-2xl', wrong: ['text-xl', 'text-lg', 'text-base', 'text-sm'] },
      h3: { expected: 'text-xl', wrong: ['text-lg', 'text-base', 'text-sm'] },
      h4: { expected: 'text-lg', wrong: ['text-base', 'text-sm'] },
    };

    return {
      JSXOpeningElement(node) {
        const tagName = node.name.name;
        if (!headingSizes[tagName]) return;

        // Check className for wrong sizes
        const classAttr = node.attributes.find(
          a => a.type === 'JSXAttribute' && a.name.name === 'className'
        );
        if (classAttr) {
          const classValue = extractClassValue(classAttr);

          // Check for wrong size
          for (const wrongSize of headingSizes[tagName].wrong) {
            if (classValue.includes(wrongSize)) {
              context.report({
                node,
                messageId: 'wrongHeadingSize',
                data: { element: tagName, expected: headingSizes[tagName].expected, actual: wrongSize },
              });
            }
          }

          // Check for missing font-display
          if (!classValue.includes('font-display') && !classValue.includes('atlas-display')) {
            context.report({ node, messageId: 'missingHeadingFont', data: { element: tagName } });
          }
        }

        // Check inline style for fontSize
        const styleAttr = node.attributes.find(
          a => a.type === 'JSXAttribute' && a.name.name === 'style'
        );
        if (styleAttr && hasInlineFontSize(styleAttr)) {
          context.report({ node, messageId: 'noInlineFontSize', data: { element: tagName } });
        }
      },
    };
  },
};
```

#### Rule 4: `enforce-prose-font`
**File:** `eslint-rules/enforce-prose-font.js`

**Purpose:** Ensure prose/body elements use `font-body`, not `font-display`.

**Pattern:** Detect `<p>` tags with `font-display` that aren't in heading contexts.

**Checks both:**
- Tailwind className: `<p className="font-display">` → Warning (should be `font-body`)
- Inline styles: `<p style={{ fontFamily: 'Playfair' }}>` → Error

**Implementation:**
```js
module.exports = {
  meta: {
    type: 'suggestion',
    docs: { description: 'Enforce font-body on prose elements, not font-display' },
    messages: {
      useBodyFont: "Prose element <{{element}}> should use 'font-body' instead of 'font-display'",
      noInlineFontFamily: "Use 'font-body' or 'font-ui' class instead of inline fontFamily",
    },
  },
  create(context) {
    const proseElements = ['p', 'span', 'div', 'li', 'td', 'blockquote'];

    return {
      JSXOpeningElement(node) {
        const tagName = node.name.name;
        if (!proseElements.includes(tagName)) return;

        const classAttr = node.attributes.find(
          a => a.type === 'JSXAttribute' && a.name.name === 'className'
        );

        if (classAttr) {
          const classValue = extractClassValue(classAttr);
          // Warn if using font-display on prose (likely a mistake)
          if (classValue.includes('font-display') && !isIntentionalDisplayUsage(classValue)) {
            context.report({
              node,
              messageId: 'useBodyFont',
              data: { element: tagName },
            });
          }
        }

        // Check inline style for fontFamily
        const styleAttr = node.attributes.find(
          a => a.type === 'JSXAttribute' && a.name.name === 'style'
        );
        if (styleAttr && hasInlineFontFamily(styleAttr)) {
          context.report({ node, messageId: 'noInlineFontFamily' });
        }
      },
    };
  },
};

function isIntentionalDisplayUsage(classValue) {
  // Allow font-display on elements that are styled as headings (e.g., text-2xl)
  return /text-(2xl|3xl|4xl|5xl)/.test(classValue);
}
```

#### Rule 5: `no-inline-typography`
**File:** `eslint-rules/no-inline-typography.js`

**Purpose:** Catch ALL inline `fontSize` and `fontFamily` in style props.

**Catches:**
```tsx
// All of these should error:
<div style={{ fontSize: '14px' }}>
<span style={{ fontSize: '1.2rem' }}>
<p style={{ fontFamily: 'Arial' }}>
<h1 style={{ fontFamily: 'serif' }}>
```

**Implementation:**
```js
module.exports = {
  meta: {
    type: 'problem',
    docs: { description: 'Disallow inline fontSize and fontFamily in style props' },
    messages: {
      noInlineFontSize: "Use Tailwind text-* class instead of inline fontSize '{{value}}'",
      noInlineFontFamily: "Use font-display/font-body/font-ui/font-mono instead of inline fontFamily '{{value}}'",
    },
  },
  create(context) {
    return {
      JSXAttribute(node) {
        if (node.name.name !== 'style') return;
        if (node.value?.type !== 'JSXExpressionContainer') return;

        const expr = node.value.expression;
        if (expr.type !== 'ObjectExpression') return;

        for (const prop of expr.properties) {
          if (prop.type !== 'Property') continue;

          const keyName = prop.key.type === 'Identifier' ? prop.key.name : null;

          if (keyName === 'fontSize') {
            const value = prop.value.type === 'Literal' ? prop.value.value : '[dynamic]';
            context.report({
              node: prop,
              messageId: 'noInlineFontSize',
              data: { value },
            });
          }

          if (keyName === 'fontFamily') {
            const value = prop.value.type === 'Literal' ? prop.value.value : '[dynamic]';
            context.report({
              node: prop,
              messageId: 'noInlineFontFamily',
              data: { value },
            });
          }
        }
      },
    };
  },
};
```

#### Update ESLint Config
**File:** `eslint.config.mjs`

```diff
 const designSystemRules = require("./eslint-rules/design-system.js");

 // In design system enforcement section:
 rules: {
   "design-system/no-hardcoded-colors": "error",
   "design-system/no-arbitrary-text-sizes": "error",
   "design-system/prefer-design-system-fonts": "error",
   "design-system/prefer-warm-shadows": "error",
+  // New rules for colors and radius
+  "design-system/no-tailwind-color-classes": "error",
+  "design-system/prefer-design-radius": "warn",
+  // New rules for typography consistency
+  "design-system/enforce-heading-typography": "error",
+  "design-system/enforce-prose-font": "warn",
+  "design-system/no-inline-typography": "error",
 },
```

#### Update design-system.js Plugin
**File:** `eslint-rules/design-system.js`

```diff
 module.exports = {
   rules: {
     'no-hardcoded-colors': require('./no-hardcoded-colors'),
     'no-arbitrary-text-sizes': require('./no-arbitrary-text-sizes'),
     'prefer-design-system-fonts': require('./prefer-design-system-fonts'),
     'prefer-warm-shadows': require('./prefer-warm-shadows'),
+    'no-tailwind-color-classes': require('./no-tailwind-color-classes'),
+    'prefer-design-radius': require('./prefer-design-radius'),
+    'enforce-heading-typography': require('./enforce-heading-typography'),
+    'enforce-prose-font': require('./enforce-prose-font'),
+    'no-inline-typography': require('./no-inline-typography'),
   },
 };
```

#### Add Unit Tests
**Files:**
- `eslint-rules/no-tailwind-color-classes.test.js`
- `eslint-rules/prefer-design-radius.test.js`
- `eslint-rules/enforce-heading-typography.test.js`
- `eslint-rules/enforce-prose-font.test.js`
- `eslint-rules/no-inline-typography.test.js`

#### Summary of New ESLint Rules

| Rule | Purpose | Severity | Catches |
|------|---------|----------|---------|
| `no-tailwind-color-classes` | Block Tailwind color classes | error | `bg-green-50`, `text-red-700` |
| `prefer-design-radius` | Enforce radius tokens | warn | `rounded-md` → `rounded-page` |
| `enforce-heading-typography` | Validate heading sizes | error | H2 with `text-lg` instead of `text-2xl` |
| `enforce-prose-font` | Validate prose fonts | warn | `<p>` with `font-display` |
| `no-inline-typography` | Block inline font styles | error | `style={{ fontSize: '14px' }}` |

#### What Each Rule Catches

**`enforce-heading-typography`** (Tailwind + Inline):
```tsx
// ERROR: Wrong size
<h2 className="text-lg font-display">Title</h2>  // Should be text-2xl

// ERROR: Missing font
<h2 className="text-2xl">Title</h2>  // Should include font-display

// ERROR: Inline fontSize
<h1 style={{ fontSize: '24px' }}>Title</h1>  // Use text-4xl instead
```

**`enforce-prose-font`** (Tailwind + Inline):
```tsx
// WARN: Wrong font on prose
<p className="font-display">Body text</p>  // Should be font-body

// ERROR: Inline fontFamily
<p style={{ fontFamily: 'Arial' }}>Text</p>  // Use font-body instead
```

**`no-inline-typography`** (Inline only):
```tsx
// ERROR: Any inline fontSize
<div style={{ fontSize: '16px' }}>Content</div>

// ERROR: Any inline fontFamily
<span style={{ fontFamily: 'Georgia' }}>Text</span>
```

---

## Testing

### Automated
```bash
npm run lint
npm run tsc
npm run test:unit
npm run test:eslint-rules  # Verify new rules work
```

### Manual Verification
1. Admin dashboard - verify status badges use correct colors in light/dark mode
2. Checkbox - verify gold accent when checked
3. Navigation - verify gold underlines on hover
4. Dialog - verify overlay opacity in both themes
5. Settings page - verify H2 headers are now larger (`text-2xl`)
6. User Library - verify empty state uses body font, header alignment matches other pages
7. Page header alignment - verify consistent centered or left alignment across pages
8. Run `npm run lint` - verify new rules catch violations in admin pages

### New Rules Verification
```bash
# Test color and radius rules
npm run lint -- --rule 'design-system/no-tailwind-color-classes: error' src/app/admin/page.tsx
npm run lint -- --rule 'design-system/prefer-design-radius: warn' src/components/ui/select.tsx

# Test typography rules
npm run lint -- --rule 'design-system/enforce-heading-typography: error' src/app/settings/SettingsContent.tsx
npm run lint -- --rule 'design-system/enforce-prose-font: warn' src/app/userlibrary/page.tsx
npm run lint -- --rule 'design-system/no-inline-typography: error' src/

# Expected violations for typography rules:
# - SettingsContent.tsx: H2 elements using text-lg instead of text-2xl
# - userlibrary/page.tsx: Empty state <p> using font-display instead of font-body
```

## Documentation Updates
- `docs/docs_overall/design_style_guide.md` - Add new ESLint rules to enforcement section
- Update rule descriptions in ESLint rules table
