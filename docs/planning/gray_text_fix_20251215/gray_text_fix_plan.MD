# CSS Simplification Plan

## Current Problems

### 1. Inconsistent Gray Shades (Critical)
Same semantic purpose uses different shades across components:

| Purpose | Files Using gray-600 | Files Using gray-700 |
|---------|---------------------|---------------------|
| Secondary text | `globals.css:125`, `results/page.tsx` | `SearchBar.tsx`, `Navigation.tsx`, `LexicalEditor.tsx` |
| Dark mode secondary | `globals.css:297` (gray-400) | `LexicalEditor.tsx` (gray-300) |

**Impact**: Inconsistent UI, harder maintenance

---

### 2. 90+ Hardcoded RGB Values (High Priority)
`src/app/globals.css` contains hardcoded colors:

| Line | Value | Should Be |
|------|-------|-----------|
| 63 | `rgb(17 24 39)` | `var(--text-primary)` |
| 115 | `rgb(55 65 81)` | `var(--text-secondary)` |
| 125 | `rgb(75 85 99)` | `var(--text-muted)` |
| 150 | `rgb(243 244 246)` | `var(--surface-secondary)` |
| 159 | `rgb(37 99 235)` | `var(--link)` |
| 285 | `rgb(209 213 219)` | `var(--text-secondary)` |
| 297 | `rgb(156 163 175)` | `var(--text-muted)` |

**Impact**: Can't change colors in one place, dark mode requires duplicate values

---

### 3. Duplicate Dark Mode Implementation (High Priority)
Two separate approaches coexist:

**Approach 1**: Media query (lines 270-403)
```css
@media (prefers-color-scheme: dark) {
  .lexical-editor p { color: rgb(209 213 219); }
}
```

**Approach 2**: Class-based (lines 440-472)
```css
.dark {
  --foreground: oklch(0.985 0 0);
}
```

**Impact**: Maintenance burden, potential conflicts, unclear which takes precedence

---

### 4. 41 `!important` Overrides (Medium Priority)
Lines 58-262 in globals.css abuse `!important`:

```css
.lexical-editor h1 { font-size: 1.875rem !important; }
.lexical-editor p { color: rgb(55 65 81) !important; }
```

**Impact**: Indicates CSS specificity problems, makes future overrides difficult

---

### 5. No Semantic Color Names (High Priority)
286 occurrences of `dark:` utilities with no central meaning:

```tsx
// What does this mean semantically?
className="text-gray-700 dark:text-gray-300"
className="bg-gray-50 dark:bg-gray-900"
className="border-gray-300 dark:border-gray-600"
```

**Impact**: No single source of truth, inconsistent usage

---

## Recommended Simplification

### Step 1: Add Semantic CSS Variables
Add to `src/app/globals.css`:

```css
:root {
  /* Text colors */
  --text-primary: rgb(17 24 39);      /* gray-900 - headings, important text */
  --text-secondary: rgb(55 65 81);    /* gray-700 - body text */
  --text-muted: rgb(107 114 128);     /* gray-500 - timestamps, hints */
  --text-on-primary: rgb(255 255 255);

  /* Surface colors */
  --surface-primary: rgb(255 255 255);
  --surface-secondary: rgb(249 250 251); /* gray-50 */
  --surface-elevated: rgb(255 255 255);

  /* Border colors */
  --border-default: rgb(229 231 235); /* gray-200 */
  --border-strong: rgb(209 213 219);  /* gray-300 */

  /* Interactive colors */
  --link: rgb(37 99 235);             /* blue-600 */
  --link-hover: rgb(29 78 216);       /* blue-700 */
}

.dark {
  --text-primary: rgb(255 255 255);
  --text-secondary: rgb(209 213 219); /* gray-300 */
  --text-muted: rgb(156 163 175);     /* gray-400 */
  --text-on-primary: rgb(17 24 39);

  --surface-primary: rgb(17 24 39);   /* gray-900 */
  --surface-secondary: rgb(31 41 55); /* gray-800 */
  --surface-elevated: rgb(55 65 81);  /* gray-700 */

  --border-default: rgb(75 85 99);    /* gray-600 */
  --border-strong: rgb(107 114 128);  /* gray-500 */

  --link: rgb(96 165 250);            /* blue-400 */
  --link-hover: rgb(147 197 253);     /* blue-300 */
}
```

---

### Step 2: Extend Tailwind Theme
Update `tailwind.config.ts`:

```ts
import type { Config } from 'tailwindcss';

const config: Config = {
  theme: {
    extend: {
      colors: {
        'text-primary': 'var(--text-primary)',
        'text-secondary': 'var(--text-secondary)',
        'text-muted': 'var(--text-muted)',
        'surface-primary': 'var(--surface-primary)',
        'surface-secondary': 'var(--surface-secondary)',
        'border-default': 'var(--border-default)',
      },
    },
  },
};
```

---

### Step 3: Consolidate globals.css
1. **Remove media query dark mode** (lines 270-403) → keep only `.dark` class
2. **Replace hardcoded RGB** with `var(--variable-name)`
3. **Remove `!important`** by using proper specificity:
   ```css
   /* Before */
   .lexical-editor p { color: rgb(55 65 81) !important; }

   /* After */
   .lexical-editor p { color: var(--text-secondary); }
   ```

---

### Step 4: Migrate Components Incrementally

**Before:**
```tsx
<p className="text-gray-700 dark:text-gray-300">Content</p>
<div className="bg-gray-50 dark:bg-gray-900">Surface</div>
```

**After:**
```tsx
<p className="text-text-secondary">Content</p>
<div className="bg-surface-secondary">Surface</div>
```

---

## Implementation Order

| # | Task | Files | Priority |
|---|------|-------|----------|
| 1 | Add semantic CSS variables | `globals.css` | High |
| 2 | Extend Tailwind theme | `tailwind.config.ts` | High |
| 3 | Replace RGB in globals.css | `globals.css` | High |
| 4 | Remove `@media dark` block | `globals.css` | Medium |
| 5 | Remove `!important` flags | `globals.css` | Medium |
| 6 | Update Lexical Editor theme | `LexicalEditor.tsx` | Medium |
| 7 | Update remaining components | 20+ files | Low |

---

## Benefits After Simplification

| Before | After |
|--------|-------|
| 90+ hardcoded RGB values | ~10 CSS variables |
| 2 dark mode approaches | 1 unified approach |
| 41 `!important` overrides | 0 overrides needed |
| 6+ gray shades inconsistent | 3 semantic text levels |
| 286 `dark:` utilities | Auto dark mode via variables |
| ~480 lines globals.css | ~200 lines estimated |

---

## Quick Win: Standardize Gray Usage

If full refactor isn't feasible, at minimum standardize:

| Semantic Purpose | Light Mode | Dark Mode |
|-----------------|------------|-----------|
| Primary text (headings) | `text-gray-900` | `dark:text-white` |
| Secondary text (body) | `text-gray-700` | `dark:text-gray-300` |
| Muted text (hints) | `text-gray-500` | `dark:text-gray-400` |
| Placeholder | `placeholder-gray-500` | `dark:placeholder-gray-400` |

Then search/replace inconsistent usages.
