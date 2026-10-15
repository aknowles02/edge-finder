/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
      },
      colors: {
        ink: {
          950: '#0A0E12',
          900: '#0F1419', // page background
          850: '#141B22',
          800: '#18212A', // cards
          700: '#222D38', // borders
          600: '#2E3B48',
        },
        muted: { DEFAULT: '#8B98A5', dim: '#5F6C79' },
        win: {
          DEFAULT: '#1E6B45', // brand accent: fills, buttons
          soft: '#16402D',
          text: '#4CC98A', // legible accent for text on charcoal
        },
        loss: { DEFAULT: '#B4483F', text: '#E07A70' },
        warn: '#D9A441',
      },
      boxShadow: { card: '0 1px 0 0 rgba(255,255,255,0.03) inset, 0 8px 24px -12px rgba(0,0,0,0.5)' },
    },
  },
  plugins: [],
};
