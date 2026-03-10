/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        surface: '#080705',
        panel: '#0f0d09',
        border: '#2e2416',
        accent: '#c8922a',
        'accent-dim': '#6b4e15',
        copper: '#a0622a',
        rune: '#4a8a6a',
        parchment: '#e8d5a3',
      },
      fontFamily: {
        serif: ['Georgia', 'Palatino Linotype', 'Book Antiqua', 'serif'],
        mono: ['Courier New', 'Courier', 'monospace'],
      },
      boxShadow: {
        'glow-amber': '0 0 12px rgba(200, 146, 42, 0.4)',
        'glow-amber-lg': '0 0 24px rgba(200, 146, 42, 0.3)',
        'glow-rune': '0 0 10px rgba(74, 138, 106, 0.5)',
      },
      keyframes: {
        'flicker': {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.85' },
        },
        'gear-spin': {
          from: { transform: 'rotate(0deg)' },
          to: { transform: 'rotate(360deg)' },
        },
        'pulse-amber': {
          '0%, 100%': { boxShadow: '0 0 6px rgba(200,146,42,0.6)' },
          '50%': { boxShadow: '0 0 18px rgba(200,146,42,0.9)' },
        },
      },
      animation: {
        'flicker': 'flicker 3s ease-in-out infinite',
        'gear-spin': 'gear-spin 8s linear infinite',
        'pulse-amber': 'pulse-amber 2s ease-in-out infinite',
      },
    }
  },
  plugins: []
}
