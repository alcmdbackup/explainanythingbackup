import type { Config } from 'tailwindcss'
import typographyPlugin from '@tailwindcss/typography'

console.log('Loading Tailwind config...');

const config: Config = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        'proxima': ['Proxima Nova', 'Arial', 'Helvetica', 'sans-serif'],
      },
      colors: {
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
        'link': 'var(--link)',
        'link-hover': 'var(--link-hover)',
        'accent-blue': 'var(--accent-blue)',
      },
    },
  },
  plugins: [
    typographyPlugin,
  ],
}

export default config 