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
        'live-ping': {
          '0%':   { transform: 'scale(1)', opacity: '0.55' },
          '80%, 100%': { transform: 'scale(2.6)', opacity: '0' },
        },
      },
      animation: {
        'fade-in-up': 'fade-in-up 0.18s ease-out',
        'live-ping': 'live-ping 2.2s cubic-bezier(0, 0, 0.2, 1) infinite',
      },
      fontFamily: {
        // A área admin troca estas duas famílias em index.css (.admin-ui); fora dela nada muda.
        display: ['"Playfair Display"', "Georgia", 'serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      colors: {
        // cream, ink, gold e sage também são variáveis: a área admin (.admin-ui) usa outra paleta,
        // a área da profissional continua com os valores originais definidos em :root.
        cream: 'rgb(var(--cream) / <alpha-value>)',
        ink: 'rgb(var(--ink) / <alpha-value>)',
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
          300: 'rgb(var(--gold-300) / <alpha-value>)',
          400: 'rgb(var(--gold-400) / <alpha-value>)',
          500: 'rgb(var(--gold-500) / <alpha-value>)',
          600: 'rgb(var(--gold-600) / <alpha-value>)',
          700: 'rgb(var(--gold-700) / <alpha-value>)',
        },
        sage: {
          100: 'rgb(var(--sage-100) / <alpha-value>)',
          200: 'rgb(var(--sage-200) / <alpha-value>)',
          500: 'rgb(var(--sage-500) / <alpha-value>)',
          700: 'rgb(var(--sage-700) / <alpha-value>)',
        },
        // vermelho de erro: variável, para a área admin usar um vermelho próprio
        rose: {
          50:  'rgb(var(--rose-50) / <alpha-value>)',
          100: 'rgb(var(--rose-100) / <alpha-value>)',
          200: 'rgb(var(--rose-200) / <alpha-value>)',
          300: 'rgb(var(--rose-300) / <alpha-value>)',
          400: 'rgb(var(--rose-400) / <alpha-value>)',
          500: 'rgb(var(--rose-500) / <alpha-value>)',
          600: 'rgb(var(--rose-600) / <alpha-value>)',
          700: 'rgb(var(--rose-700) / <alpha-value>)',
          800: 'rgb(var(--rose-800) / <alpha-value>)',
        },
        // superfícies escuras da área admin: carvão de subtom quente (fixas)
        night: {
          950: '#141110',
          900: '#1C1816',
          800: '#26201E',
          700: '#342C29',
        },
        signal: '#7FCFA0',     // "ao vivo / ok" sobre superfícies escuras (verde suave, sem neon)
      },
    },
  },
  plugins: [],
};
