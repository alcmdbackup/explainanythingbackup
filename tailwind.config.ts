import type { Config } from 'tailwindcss'
import typographyPlugin from '@tailwindcss/typography'

console.log('Loading Tailwind config...');

const config: Config = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './src/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        // Midnight Scholar Typography
        'display': ['var(--font-playfair)', 'Playfair Display', 'Georgia', 'serif'],
        'body': ['var(--font-source-serif)', 'Source Serif 4', 'Georgia', 'serif'],
        'ui': ['var(--font-dm-sans)', 'DM Sans', 'system-ui', 'sans-serif'],
        'mono': ['var(--font-jetbrains)', 'JetBrains Mono', 'monospace'],
        // Legacy support
        'proxima': ['Proxima Nova', 'Arial', 'Helvetica', 'sans-serif'],
      },
      colors: {
        // Midnight Scholar Semantic Colors
        'scholar': {
          // Light mode (Day Study)
          'cream': '#faf7f2',
          'paper': '#f5f0e6',
          'ink': '#1a1a2e',
          'charcoal': '#4a4a5a',
          'pencil': '#8a8a9a',
          'gold': '#d4a853',
          'copper': '#b87333',
          'parchment': '#e8e4dc',
          'shadow': '#d4cfc4',
          // Dark mode (Night Study)
          'midnight': '#0a1628',
          'mahogany': '#121f36',
          'wood': '#1a2a47',
          'candlelit': '#f5f0e6',
          'aged': '#c9c4b8',
          'dusty': '#8a8577',
          'lamplight': '#f0c674',
          'brass': '#d4a853',
          'shelf': '#2a3a57',
          'panel': '#3a4a67',
        },
        // CSS Variable-based colors (for dynamic theming)
        'text-primary': 'var(--text-primary)',
        'text-secondary': 'var(--text-secondary)',
        'text-muted': 'var(--text-muted)',
        'text-on-primary': 'var(--text-on-primary)',
        'surface-primary': 'var(--surface-primary)',
        'surface-secondary': 'var(--surface-secondary)',
        'surface-elevated': 'var(--surface-elevated)',
        'surface-code': 'var(--surface-code)',
        'border-default': 'var(--border-default)',
        'border-strong': 'var(--border-strong)',
        'accent-gold': 'var(--accent-gold)',
        'accent-copper': 'var(--accent-copper)',
        'link': 'var(--link)',
        'link-hover': 'var(--link-hover)',
        // Legacy (keeping for compatibility during transition)
        'accent-blue': 'var(--accent-gold)',
      },
      boxShadow: {
        // Warm-tinted shadows for book-like depth
        'warm-sm': '0 1px 2px 0 rgba(180, 115, 51, 0.05)',
        'warm': '0 1px 3px 0 rgba(180, 115, 51, 0.1), 0 1px 2px -1px rgba(180, 115, 51, 0.1)',
        'warm-md': '0 4px 6px -1px rgba(180, 115, 51, 0.1), 0 2px 4px -2px rgba(180, 115, 51, 0.1)',
        'warm-lg': '0 10px 15px -3px rgba(180, 115, 51, 0.1), 0 4px 6px -4px rgba(180, 115, 51, 0.1)',
        'warm-xl': '0 20px 25px -5px rgba(180, 115, 51, 0.1), 0 8px 10px -6px rgba(180, 115, 51, 0.1)',
        // Inner shadow for book pages
        'page': 'inset 0 2px 4px 0 rgba(180, 115, 51, 0.06)',
        'page-deep': 'inset 0 4px 8px 0 rgba(180, 115, 51, 0.1)',
        // Gold glow for focus states
        'gold-glow': '0 0 0 3px rgba(212, 168, 83, 0.3)',
        'gold-glow-lg': '0 0 0 4px rgba(212, 168, 83, 0.4)',
      },
      borderRadius: {
        'book': '0.5rem',
        'page': '0.375rem',
      },
      backgroundImage: {
        // Paper texture gradient
        'paper-texture': 'url("data:image/svg+xml,%3Csvg viewBox=\'0 0 200 200\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cfilter id=\'noise\'%3E%3CfeTurbulence type=\'fractalNoise\' baseFrequency=\'0.65\' numOctaves=\'3\' stitchTiles=\'stitch\'/%3E%3C/filter%3E%3Crect width=\'100%25\' height=\'100%25\' filter=\'url(%23noise)\' opacity=\'0.03\'/%3E%3C/svg%3E")',
        // Gold gradient for accents
        'gold-gradient': 'linear-gradient(135deg, #d4a853 0%, #f0c674 50%, #d4a853 100%)',
        'gold-underline': 'linear-gradient(90deg, transparent 0%, #d4a853 10%, #d4a853 90%, transparent 100%)',
      },
      animation: {
        // Book-inspired animations
        'fade-up': 'fadeUp 0.5s ease-out',
        'slide-gold': 'slideGold 0.3s ease-out forwards',
        'quill-write': 'quillWrite 1.5s ease-in-out infinite',
        'page-turn': 'pageTurn 0.6s ease-in-out',
        'bookmark-flutter': 'bookmarkFlutter 0.4s ease-out',
        'ink-spread': 'inkSpread 0.3s ease-out',
      },
      keyframes: {
        fadeUp: {
          '0%': { opacity: '0', transform: 'translateY(10px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        slideGold: {
          '0%': { width: '0%', opacity: '0' },
          '100%': { width: '100%', opacity: '1' },
        },
        quillWrite: {
          '0%, 100%': { transform: 'rotate(-5deg) translateX(0)' },
          '50%': { transform: 'rotate(5deg) translateX(4px)' },
        },
        pageTurn: {
          '0%': { transform: 'rotateY(0deg)', opacity: '1' },
          '50%': { transform: 'rotateY(-90deg)', opacity: '0.5' },
          '100%': { transform: 'rotateY(0deg)', opacity: '1' },
        },
        bookmarkFlutter: {
          '0%': { transform: 'translateY(0) rotate(0deg)' },
          '25%': { transform: 'translateY(-2px) rotate(-2deg)' },
          '75%': { transform: 'translateY(-1px) rotate(1deg)' },
          '100%': { transform: 'translateY(0) rotate(0deg)' },
        },
        inkSpread: {
          '0%': { opacity: '0', transform: 'scale(0.95)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        },
      },
      typography: {
        // Custom prose styling for Midnight Scholar
        scholar: {
          css: {
            '--tw-prose-body': 'var(--text-secondary)',
            '--tw-prose-headings': 'var(--text-primary)',
            '--tw-prose-lead': 'var(--text-secondary)',
            '--tw-prose-links': 'var(--accent-gold)',
            '--tw-prose-bold': 'var(--text-primary)',
            '--tw-prose-counters': 'var(--accent-copper)',
            '--tw-prose-bullets': 'var(--accent-gold)',
            '--tw-prose-hr': 'var(--border-default)',
            '--tw-prose-quotes': 'var(--text-primary)',
            '--tw-prose-quote-borders': 'var(--accent-gold)',
            '--tw-prose-captions': 'var(--text-muted)',
            '--tw-prose-code': 'var(--text-primary)',
            '--tw-prose-pre-code': 'var(--text-primary)',
            '--tw-prose-pre-bg': 'var(--surface-elevated)',
            '--tw-prose-th-borders': 'var(--border-strong)',
            '--tw-prose-td-borders': 'var(--border-default)',
          },
        },
      },
    },
  },
  plugins: [
    typographyPlugin,
  ],
}

export default config
