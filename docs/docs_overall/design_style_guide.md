# Design Style Guide

## Quick Reference

### Color Tokens
```css
/* Primary */
var(--background)       /* Page background */
var(--text-primary)     /* Main text */
var(--text-secondary)   /* Muted text */

/* Surfaces */
var(--surface-primary)  /* Base surface */
var(--surface-secondary) /* Cards */
var(--surface-elevated) /* Hover states */

/* Accents */
var(--accent-gold)      /* Primary accent */
var(--accent-copper)    /* Secondary accent */

/* Borders */
var(--border-default)   /* Standard borders */
var(--border-strong)    /* Emphasized borders */
```

### Typography
| Class | Font | Use |
|-------|------|-----|
| `font-display` | Playfair Display | Headings |
| `font-body` | Source Serif 4 | Prose |
| `font-ui` | DM Sans | UI elements |
| `font-mono` | JetBrains Mono | Code |

### Essential Utilities
```css
.paper-texture     /* Grain overlay */
.gold-underline    /* Animated underline */
.text-gold         /* Gold text */
.text-copper       /* Copper text */
.shadow-warm       /* Default warm shadow */
.rounded-book      /* 8px radius */
```

---

## Design Philosophy: "Midnight Scholar"

This design system embodies a sophisticated scholarly aesthetic inspired by candlelit libraries and aged manuscripts. The visual language evokes contemplation and intellectual depth through warm, muted tones, elegant typography, and subtle paper-like textures.

**Core Principles:**
- Warmth over coldness (copper/gold accents, not blue/gray)
- Elegance through restraint
- Scholarly refinement with subtle luxury
- Respect for accessibility and reduced motion preferences

---

## Typography

Four carefully curated Google Fonts create a typographic hierarchy:

| Font | CSS Variable | Usage |
|------|--------------|-------|
| **Playfair Display** | `font-display` | Headings, titles, display text |
| **Source Serif 4** | `font-body` | Body text, prose, long-form content |
| **DM Sans** | `font-ui` | UI elements, buttons, labels, navigation |
| **JetBrains Mono** | `font-mono` | Code blocks, technical content |

**Scale:**
- H1: `2.25rem` / 700 weight
- H2: `1.75rem` / 600 weight
- H3: `1.375rem` / 600 weight
- H4: `1.125rem` / uppercase, `0.05em` letter-spacing
- Body: `1.0625rem` / 1.75 line-height

**Usage in Tailwind:**
```html
<h1 class="font-display text-4xl font-bold">Title</h1>
<p class="font-body text-base">Body text</p>
<button class="font-ui text-sm font-medium">Button</button>
<code class="font-mono text-sm">code()</code>
```

---

## Color System

Colors are defined as CSS custom properties, enabling theme switching and consistent usage. RGB variants are available for alpha compositing (e.g., `--accent-gold-rgb`).

### Light Mode (Day Study)

| Token | Value | Usage |
|-------|-------|-------|
| `--background` | `#faf7f2` | Page background (warm cream) |
| `--text-primary` | `#1a1a2e` | Primary text (deep ink) |
| `--text-secondary` | `#4a4a5a` | Secondary text (soft charcoal) |
| `--surface-primary` | `#faf7f2` | Primary surfaces |
| `--surface-secondary` | `#ffffff` | Cards, elevated surfaces |
| `--surface-elevated` | `#f5f0e6` | Hover states (aged paper) |
| `--accent-gold` | `#d4a853` | Primary accent |
| `--accent-copper` | `#b87333` | Secondary accent |
| `--border-default` | `#e8e4dc` | Default borders |

### Dark Mode (Night Study)

| Token | Value | Usage |
|-------|-------|-------|
| `--background` | `#0a1628` | Page background (midnight navy) |
| `--text-primary` | `#f5f0e6` | Primary text (candlelit cream) |
| `--surface-secondary` | `#121f36` | Cards (dark mahogany) |
| `--surface-elevated` | `#1a2a47` | Hover states |
| `--accent-gold` | `#f0c674` | Primary accent (lamplight) |
| `--accent-copper` | `#d4a853` | Secondary accent (brass) |

### Theme Variants

Six alternative themes are available (each with light + dark mode):

| Theme | Primary Accent | Secondary Accent |
|-------|----------------|------------------|
| **Venetian Archive** | Burgundy `#8b2942` | Hunter Green `#2d5a4a` |
| **Oxford Blue** | Teal `#1b4965` | Leather Brown `#774936` |
| **Sepia Chronicle** | Burnt Sienna `#8b5a2b` | Coffee `#5c4033` |
| **Monastery Green** | Moss Green `#4a6741` | Antique Gold `#8b6508` |
| **Prussian Ink** | Prussian Blue `#003153` | Cardinal Red `#c41e3a` |
| **Coral Harbor** | Coral `#fe5f55` | Carrot Orange `#f19a3e` |

**Usage:**
```css
color: var(--text-primary);
background: var(--surface-secondary);
border-color: var(--border-default);
```

---

## Component Patterns

### Button Variants

Buttons use Class Variance Authority (CVA) for variant management:

| Variant | Description |
|---------|-------------|
| `default` | Gold-to-copper gradient with warm shadow |
| `secondary` | Muted scholarly look with subtle background |
| `outline` | Bordered with gold hover accent |
| `scholar` | Animated gradient sweep on hover |
| `ghost` | Transparent with hover background |
| `destructive` | Error/delete actions |
| `link` | Text-only with underline |

**Sizes:** `sm` (h-8), `default` (h-10), `lg` (h-11), `icon` (h-10 w-10)

```tsx
<Button variant="scholar" size="lg">Scholarly Action</Button>
<Button variant="secondary">Muted Action</Button>
```

### Card Styling

Cards use the `paper-texture` class for subtle grain overlay:

```tsx
<Card className="rounded-book border border-[var(--border-default)]
                 bg-[var(--surface-secondary)] paper-texture">
```

**Enhanced Cards:** Use `.card-enhanced` for elaborate styling with pseudo-element depth:
```html
<div class="card-enhanced">...</div>
```

### Gallery Cards (Glassmorphism)

The `.gallery-card` class provides glassmorphism effects:

| Property | Light Mode | Dark Mode |
|----------|------------|-----------|
| Backdrop blur | `12px` | `12px` |
| Background opacity | `0.85` | `0.8` |
| Shadow | Warm copper with inset highlight | Enhanced glow |
| Hover | `translateY(-8px) scale(1.01)` | Same + lamplight halo |

```html
<div class="gallery-card">
  <!-- Gold accent bar appears on hover -->
</div>
```

---

## Layout

### Masonry Grid

```html
<div class="columns-1 sm:columns-2 lg:columns-3 xl:columns-4 gap-6">
```

### Spacing Convention
- Gap: `6` units (1.5rem / 24px)
- Container: `max-w-7xl` (80rem)
- Page padding: `px-4 py-8`

### Border Radius

| Token | Value | Usage |
|-------|-------|-------|
| `rounded-page` | `0.375rem` (6px) | Delicate, small elements |
| `rounded-book` | `0.5rem` (8px) | Cards, larger containers |

---

## Animations & Motion

### Core Keyframes

| Animation | Duration | Usage |
|-----------|----------|-------|
| `fade-up` | 0.5s | Entrance animations |
| `slide-gold` | 0.3s | Gold accent reveals |
| `quill-write` | 1.5s | Loading/writing indicator |
| `page-turn` | 0.6s | Page transitions |
| `bookmark-flutter` | 0.4s | Bookmark interactions |
| `ink-spread` | 0.3s | Text reveal effects |

### Extended Keyframes

| Animation | Duration | Usage |
|-----------|----------|-------|
| `cardEntrance` | 0.5s | Gallery card entrance |
| `atlasFadeUp` | 0.6s | Legacy atlas animations |
| `authEnter` | 0.4s | Auth page transitions |
| `flourishDraw` | 0.8s | Title underline draw-in |
| `candleFlicker` | 3s | Dark mode glow variation |
| `warmGlowPulse` | 2s | Pulsing gold glow |
| `skeletonPulse` | 1.5s | Loading skeleton |

### Text Reveal Animations

Four text reveal styles for dramatic entrances:

```html
<span class="text-reveal-blur">Blur to focus</span>
<span class="text-reveal-fade">Fade + slide up</span>
<span class="text-reveal-ink">Ink spread effect</span>
<span class="text-reveal-scramble">JS-driven scramble</span>
```

### Card Entrance

```css
animation: cardEntrance 0.5s cubic-bezier(0.4, 0, 0.2, 1);
animation-delay: calc(var(--card-index) * 80ms);
```

### Stagger Utilities

Pre-defined delays for sequential animations:
```html
<div class="stagger-1"><!-- 100ms delay --></div>
<div class="stagger-2"><!-- 200ms delay --></div>
<div class="stagger-3"><!-- 300ms delay --></div>
<div class="stagger-4"><!-- 400ms delay --></div>
<div class="stagger-5"><!-- 500ms delay --></div>
```

### Reduced Motion

All animations respect `prefers-reduced-motion`:
```css
@media (prefers-reduced-motion: reduce) {
  animation: none !important;
  transition: none !important;
}
```

---

## Dark Mode Enhancements

Dark mode includes atmospheric effects for the candlelit library aesthetic:

### Candlelight Flicker
```html
<div class="candlelight-flicker">
  <!-- Subtle 3s animation mimicking flame movement -->
</div>
```

### Lamplight Halo
Applied to key elements for radial glow effect:
```html
<div class="lamplight-halo">
  <!-- Radial gradient background in dark mode -->
</div>
```

### Enhanced Effects

| Class | Effect |
|-------|--------|
| `.accent-gold-glow` | Text-shadow glow on gold elements |
| `.dark .paper-texture` | Enhanced grain (0.05 vs 0.03 opacity) |
| `.dark .gallery-card` | Intensified glassmorphism |
| `.dark .shadow-warm` | Glow effect added to shadows |

### Atmospheric Shadows

Dark mode warm shadows include a subtle glow:
```css
.dark .shadow-warm {
  box-shadow: 0 4px 6px -1px rgba(240, 198, 116, 0.1),
              0 0 20px rgba(240, 198, 116, 0.05);
}
```

---

## Visual Details

### Shadows

Warm copper-tinted shadows for a cohesive feel:

| Class | Usage |
|-------|-------|
| `shadow-warm-sm` | Subtle depth |
| `shadow-warm` | Default elevation |
| `shadow-warm-md` | Moderate elevation |
| `shadow-warm-lg` | High elevation |
| `shadow-page` | Inset paper depth |
| `shadow-gold-glow` | Focus rings |

### Paper Texture

Apply subtle SVG fractal noise overlay:
```html
<div class="paper-texture">...</div>
```

### Decorative Elements

- **Gold Underline**: `class="gold-underline"` - Animated width on hover
- **Title Flourish**: `class="title-flourish"` - Double gold/copper gradient lines
- **Title Flourish Animated**: `class="title-flourish-animated"` - Draws in with animation
- **Flourish Divider**: `class="flourish-divider"` - Gradient lines with centered content

### Scrollbar

- Width: 10px
- Track: `var(--surface-elevated)`
- Thumb: `var(--border-strong)` with copper hover

---

## Utility Classes

### Scholar Classes
```css
.scholar-card         /* Card with scholar styling */
.scholar-card-hover   /* Card hover lift effect */
.scholar-nav-link     /* Navigation link styling */
.scholar-table-row    /* Table row hover */

/* Button variants */
.scholar-btn          /* Button base */
.scholar-btn-primary  /* Gold-to-copper gradient */
.scholar-btn-secondary /* Outlined variant */
.scholar-btn-ghost    /* Minimal variant */

.scholar-input        /* Input with scholar styling */
```

### Atlas Classes (legacy)
```css
.atlas-display        /* Display typography (Playfair, 3.5rem) */
.atlas-ui             /* UI typography (DM Sans) */
.atlas-body           /* Body typography (Source Serif) */
.atlas-button         /* Button styling */
.atlas-animate-fade-up /* Legacy fade animation */
```

### Color Utilities
```css
.text-gold            /* color: var(--accent-gold) */
.text-copper          /* color: var(--accent-copper) */
.border-gold          /* border-color: var(--accent-gold) */
```

### Focus & Transition Utilities
```css
.focus-gold           /* Gold focus ring (3px, 0.3 opacity) */
.transition-scholar   /* Smooth 300ms ease-out transition */
```

---

## Key Files

| File | Purpose |
|------|---------|
| `tailwind.config.ts` | Custom shadows, animations, border radius, font families |
| `src/app/globals.css` | CSS variables, themes, textures, utility classes |
| `src/app/layout.tsx` | Font definitions, theme provider setup |
| `src/components/ui/button.tsx` | Button component with CVA variants |
| `src/components/ui/card.tsx` | Card component styling |
| `src/contexts/ThemeContext.tsx` | Theme switching (palette + mode) |
