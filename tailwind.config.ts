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
    },
  },
  plugins: [
    typographyPlugin,
  ],
}

export default config 