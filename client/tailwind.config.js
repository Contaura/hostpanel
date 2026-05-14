/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        sans: [
          'Inter', 'ui-sans-serif', 'system-ui', '-apple-system',
          'BlinkMacSystemFont', 'Segoe UI', 'sans-serif',
        ],
      },
      colors: {
        // Semantic surface tokens so we write less dark: variants
        surface: {
          DEFAULT: 'white',
          raised: '#f8fafc',
        },
      },
      keyframes: {
        'slide-in-from-right': {
          from: { transform: 'translateX(1.25rem)', opacity: '0' },
          to:   { transform: 'translateX(0)',       opacity: '1' },
        },
        'fade-in': {
          from: { opacity: '0' },
          to:   { opacity: '1' },
        },
      },
      animation: {
        in: 'slide-in-from-right 0.2s ease-out, fade-in 0.2s ease-out',
      },
    },
  },
  plugins: [],
};
