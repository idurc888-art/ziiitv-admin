/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        base:         '#0b0b0e',
        surface:      '#131318',
        elevated:     '#1c1c22',
        overlay:      '#24242c',
        border:       'rgba(255,255,255,0.06)',
        'border-strong': 'rgba(255,255,255,0.12)',
        'border-subtle': 'rgba(255,255,255,0.04)',

        // NEW primary: hot pink
        accent:        '#ff2d92',
        'accent-hover':'#ff4fa3',
        'accent-muted':'rgba(255,45,146,0.12)',

        // NEW data / success: aqua
        aqua:          '#2dd4bf',
        'aqua-hover':  '#45e0ce',
        'aqua-muted':  'rgba(45,212,191,0.14)',

        // NEW warning / highlight: neon orange
        neon:          '#ff8c42',
        'neon-hover':  '#ffa166',
        'neon-muted':  'rgba(255,140,66,0.14)',

        // Legacy consumer brand alias (LinkPage) — kept
        'brand-pink':  '#ff006e',

        // Semantic aliases (existing components reference these names)
        success: '#2dd4bf',
        warning: '#ff8c42',
        danger:  '#ff3b5c',

        'text-primary':   '#ffffff',
        'text-secondary': '#a0a0ab',
        'text-muted':     '#5a5a64',
      },
      fontFamily: {
        display: ['DM Sans', 'sans-serif'],
        body:    ['Inter', 'sans-serif'],
        mono:    ['JetBrains Mono', 'monospace'],
        brand:   ['Outfit', 'sans-serif'],
      },
      borderRadius: {
        'card': '18px',
      },
      letterSpacing: {
        'tightest': '-0.035em',
      },
    },
  },
  plugins: [],
}
