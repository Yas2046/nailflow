/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      keyframes: {
        'fade-in-up': {
          '0%':   { opacity: '0', transform: 'translateY(8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: {
        'fade-in-up': 'fade-in-up 0.18s ease-out',
      },
      fontFamily: {
        display: ['"Playfair Display"', "Georgia", 'serif'],
      },
      colors: {
        cream: '#FBF6F1',
        ink: '#2B2320',
        // wine.* usa CSS variables para suportar temas
        wine: {
          50:  'rgb(var(--wine-50) / <alpha-value>)',
          100: 'rgb(var(--wine-100) / <alpha-value>)',
          200: 'rgb(var(--wine-200) / <alpha-value>)',
          300: 'rgb(var(--wine-300) / <alpha-value>)',
          400: 'rgb(var(--wine-400) / <alpha-value>)',
          500: 'rgb(var(--wine-500) / <alpha-value>)',
          600: 'rgb(var(--wine-600) / <alpha-value>)',
          700: 'rgb(var(--wine-700) / <alpha-value>)',
          800: 'rgb(var(--wine-800) / <alpha-value>)',
        },
        gold: {
          300: '#EDD9A0',
          400: '#D9B26A',
          500: '#C79A45',
          600: '#A67D35',
        },
        sage: {
          100: '#ECF0ED',
          200: '#D4DEDB',
          500: '#6E8F73',
        },
      },
    },
  },
  plugins: [],
};
