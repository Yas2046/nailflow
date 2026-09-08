/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        display: ['"Playfair Display"', 'Georgia', 'serif'],
      },
      colors: {
        cream: '#FBF6F1',
        ink: '#2B2320',
        wine: {
          50: '#FAF1F3',
          100: '#EBD9DE',
          500: '#8C4A5E',
          600: '#733A4C',
          700: '#5A2C3A',
        },
        gold: {
          400: '#D9B26A',
          500: '#C79A45',
        },
        sage: {
          500: '#6E8F73',
        },
      },
    },
  },
  plugins: [],
};
