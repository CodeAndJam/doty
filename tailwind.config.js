/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        surface: '#0f0f13',
        panel: '#1a1a24',
        border: '#2a2a3a',
        accent: '#7c6af7',
        'accent-dim': '#4a3fa0',
      }
    }
  },
  plugins: []
}
