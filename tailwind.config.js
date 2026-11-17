/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      // Mirrors the CSS custom properties in src/index.css. Ink steps are AA
      // at 11px; the ornament colours are decorative only.
      colors: {
        surface: 'var(--surface)',
        panel: 'var(--panel)',
        border: 'var(--line)',
        accent: 'var(--accent)',
        'accent-dim': 'var(--accent-dim)',
        copper: 'var(--copper)',
        rune: 'var(--rune)',
        parchment: 'var(--ink)',
      },
      fontFamily: {
        serif: ['Crimson Text', 'Georgia', 'Palatino Linotype', 'Book Antiqua', 'serif'],
        mono: ['IBM Plex Mono', 'ui-monospace', 'Courier New', 'monospace'],
      },
    },
  },
  plugins: [],
}
