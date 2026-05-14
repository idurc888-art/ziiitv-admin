/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        base: '#0a0a0f',
        surface: '#111118',
        elevated: '#1a1a24',
        overlay: '#22222e',
        border: '#2a2a3a',
        'border-subtle': '#1e1e2a',
        accent: '#6c5ce7',
        'accent-hover': '#7d6ff0',
        'accent-muted': 'rgba(108, 92, 231, 0.15)',
        success: '#00b894',
        warning: '#fdcb6e',
        danger: '#e17055',
        'text-primary': '#f0f0f8',
        'text-secondary': '#8888aa',
        'text-muted': '#555568',
      },
      fontFamily: {
        display: ['DM Sans', 'sans-serif'],
        body: ['Inter', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
    },
  },
  plugins: [],
}
