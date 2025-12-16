# CSS Styling Architecture Research

## Overview
This document details how CSS styling works in the ExplainAnything codebase, with focus on text color patterns relevant to gray text fixes.

---

## 1. CSS Framework: Tailwind CSS v4.15

**Approach**: Pure utility-class CSS (no CSS modules, styled-components, or Emotion)

| File | Purpose |
|------|---------|
| `tailwind.config.ts` | Tailwind configuration |
| `postcss.config.mjs` | PostCSS with `@tailwindcss/postcss` |
| `src/app/globals.css` | Global styles (481 lines) |

---

## 2. Global Styles (`src/app/globals.css`)

### Structure
- **Lines 1-50**: Tailwind directives, plugin imports, CSS variables
- **Lines 52-167**: Lexical Editor markdown styling
- **Lines 169-403**: Diff tag node styling
- **Lines 404+**: Dark mode overrides

### CSS Variables (OKLch Color Space)
```css
:root {
  --background: oklch(1 0 0);
  --foreground: oklch(0.145 0 0);
  --primary: oklch(0.205 0 0);
  --secondary: oklch(0.97 0 0);
  --muted: oklch(0.97 0 0);
  --accent: oklch(0.97 0 0);
  --destructive: oklch(0.577 0.245 27.325);
  /* ... more variables */
}
```

---

## 3. Gray Text Color Definitions

### Tailwind Classes (245+ occurrences)

| Class | Usage | Components |
|-------|-------|------------|
| `text-gray-900 dark:text-white` | Primary text/headings | ExplanationsTable, cards |
| `text-gray-700 dark:text-gray-300` | Body text | LexicalEditor paragraphs |
| `text-gray-600 dark:text-gray-400` | Secondary/muted text | Descriptions, quotes |
| `text-gray-500` | Tertiary/subtle text | Dates, timestamps |
| `text-gray-800 dark:text-gray-200` | Code text | Inline code blocks |
| `placeholder-gray-500 dark:placeholder-gray-400` | Input placeholders | SearchBar, forms |

### Hardcoded RGB Values in globals.css

| Line | RGB Value | Tailwind Equivalent | Element |
|------|-----------|---------------------|---------|
| 115 | `rgb(55 65 81)` | gray-700 | Paragraph text |
| 125 | `rgb(75 85 99)` | gray-600 | Blockquote text |
| 134 | `rgb(55 65 81)` | gray-700 | Ordered list text |
| 141 | `rgb(55 65 81)` | gray-700 | Unordered list text |
| 285 | `rgb(209 213 219)` | gray-300 | Dark mode paragraph |
| 297 | `rgb(156 163 175)` | gray-400 | Dark mode blockquote |

---

## 4. Lexical Editor Theme

**File**: `src/components/LexicalEditor/LexicalEditor.tsx` (lines 54-78)

```typescript
const theme = {
  paragraph: 'mt-1 mb-4 text-gray-700 dark:text-gray-300 leading-relaxed',
  heading: {
    h1: 'text-3xl font-bold text-gray-900 dark:text-white mb-6 mt-8',
    h2: 'text-2xl font-bold text-gray-900 dark:text-white mb-4 mt-6',
    h3: 'text-xl font-semibold text-gray-900 dark:text-white mb-3 mt-5',
  },
  code: 'bg-gray-100 dark:bg-gray-700 px-1.5 py-0.5 rounded text-sm font-mono text-gray-800 dark:text-gray-200',
  quote: 'border-l-4 border-blue-500 pl-4 my-4 italic text-gray-600 dark:text-gray-400',
  list: {
    listitem: 'ml-6 my-1 text-gray-700 dark:text-gray-300',
    ol: 'list-decimal ml-6 my-4 text-gray-700 dark:text-gray-300',
    ul: 'list-disc ml-6 my-4 text-gray-700 dark:text-gray-300',
  },
  link: 'text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 underline',
};
```

---

## 5. Component Examples

### ExplanationsTablePage
- Title: `text-gray-900 dark:text-white`
- Content preview: `text-gray-600 dark:text-gray-400`
- Dates: `text-gray-500`
- Row alternation: `odd:bg-gray-50 even:bg-white dark:odd:bg-gray-800 dark:even:bg-gray-900`

### SearchBar
- Placeholder: `placeholder-gray-500 dark:placeholder-gray-400`
- Border: `border-gray-300 dark:border-gray-600`
- Text: `dark:text-white`

---

## 6. Dark Mode Implementation

### Three Mechanisms
1. **CSS Custom Properties**: OKLch colors in `:root` and `.dark`
2. **Media Queries**: `@media (prefers-color-scheme: dark)` for system preference
3. **Class-based**: `.dark` class for manual toggle

### Pattern
```css
/* Light mode base */
.element { color: rgb(55 65 81); }  /* gray-700 */

/* Dark mode override */
@media (prefers-color-scheme: dark) {
  .element { color: rgb(209 213 219); }  /* gray-300 */
}
```

---

## 7. Utility Functions

**File**: `src/lib/utils.ts`

```typescript
import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
```

Used for:
- Conditional class application
- Merging conflicting Tailwind classes
- Component prop composition

---

## 8. UI Component Library

**Location**: `src/components/ui/`

| Component | Styling Approach |
|-----------|------------------|
| `button.tsx` | CVA (class-variance-authority) for variants |
| `card.tsx` | Tailwind utility classes |
| `checkbox.tsx` | Radix UI + Tailwind |
| `form.tsx` | React Hook Form + Tailwind |
| `input.tsx` | Tailwind utilities |
| `spinner.tsx` | Tailwind animations |

---

## 9. CSS Dependencies

```json
{
  "tailwindcss": "^4.0.15",
  "@tailwindcss/postcss": "^4.0.15",
  "@tailwindcss/typography": "^0.5.16",
  "tailwindcss-animate": "^1.0.7",
  "tailwind-merge": "^3.4.0",
  "clsx": "^2.1.1",
  "class-variance-authority": "^0.7.1"
}
```

---

## 10. Key Files for Gray Text Fixes

| Priority | File | What to Check |
|----------|------|---------------|
| 1 | `src/app/globals.css` | Hardcoded RGB values (lines 115-141, 285-297) |
| 2 | `src/components/LexicalEditor/LexicalEditor.tsx` | Theme object gray classes |
| 3 | `src/components/ui/*.tsx` | Component-specific text colors |
| 4 | Any component using `text-gray-*` classes | Search with grep |

---

## Summary

- **Framework**: Tailwind CSS v4.15 (utility-first, no CSS-in-JS)
- **Gray text locations**: globals.css hardcoded RGB + component Tailwind classes
- **Dark mode**: Dual approach (media query + `.dark` class)
- **Key fix areas**: Lexical Editor theme + globals.css markdown styles
