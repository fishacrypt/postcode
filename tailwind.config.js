/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#0E1A2F',
        canvas: '#F7F5F0',
        paper: '#FFFFFF',
        line: '#E4E0D6',
        mute: '#5B6678',
        brand: '#14213D',
        accent: '#3B6FB6',
        soft: '#EAF0F8',
        ok: '#1F7A4D',
        warn: '#9A5B00',
        bad: '#B3261E',
      },
      fontFamily: {
        display: ['"Space Grotesk"', 'ui-sans-serif', 'sans-serif'],
        sans: ['"DM Sans"', 'ui-sans-serif', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
      boxShadow: { card: '0 1px 2px rgba(14,26,47,0.04), 0 8px 24px -12px rgba(14,26,47,0.10)' },
    },
  },
  plugins: [],
}
