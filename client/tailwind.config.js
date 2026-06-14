/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './src/**/*.{js,jsx,ts,tsx}',
    './src/index.html',
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // --- Themeable palettes (Appearance settings) -------------------------
        // indigo (accent) + gray (surfaces/text) read CSS variables holding
        // SPACE-SEPARATED RGB channels, wrapped so Tailwind's `<alpha-value>`
        // placeholder still works (so bg-indigo-50/40, bg-gray-200/60, etc. keep
        // their opacity). The stock Tailwind channels are the fallback, so with
        // no variables set the app looks exactly as before.
        //   - Accent: utils/theme.js sets --c-indigo-* to re-skin the accent.
        //   - Dark mode: the .dark block in index.css remaps --c-gray-*.
        // `white` is deliberately NOT themed — text-white on coloured buttons and
        // white overlays must stay white; dark surfaces are handled by explicit
        // .dark overrides in index.css instead.
        indigo: {
          50:  'rgb(var(--c-indigo-50, 238 242 255) / <alpha-value>)',
          100: 'rgb(var(--c-indigo-100, 224 231 255) / <alpha-value>)',
          200: 'rgb(var(--c-indigo-200, 199 210 254) / <alpha-value>)',
          300: 'rgb(var(--c-indigo-300, 165 180 252) / <alpha-value>)',
          400: 'rgb(var(--c-indigo-400, 129 140 248) / <alpha-value>)',
          500: 'rgb(var(--c-indigo-500, 99 102 241) / <alpha-value>)',
          600: 'rgb(var(--c-indigo-600, 79 70 229) / <alpha-value>)',
          700: 'rgb(var(--c-indigo-700, 67 56 202) / <alpha-value>)',
          800: 'rgb(var(--c-indigo-800, 55 48 163) / <alpha-value>)',
          900: 'rgb(var(--c-indigo-900, 49 46 129) / <alpha-value>)',
        },
        gray: {
          50:  'rgb(var(--c-gray-50, 249 250 251) / <alpha-value>)',
          100: 'rgb(var(--c-gray-100, 243 244 246) / <alpha-value>)',
          200: 'rgb(var(--c-gray-200, 229 231 235) / <alpha-value>)',
          300: 'rgb(var(--c-gray-300, 209 213 219) / <alpha-value>)',
          400: 'rgb(var(--c-gray-400, 156 163 175) / <alpha-value>)',
          500: 'rgb(var(--c-gray-500, 107 114 128) / <alpha-value>)',
          600: 'rgb(var(--c-gray-600, 75 85 99) / <alpha-value>)',
          700: 'rgb(var(--c-gray-700, 55 65 81) / <alpha-value>)',
          800: 'rgb(var(--c-gray-800, 31 41 55) / <alpha-value>)',
          900: 'rgb(var(--c-gray-900, 17 24 39) / <alpha-value>)',
        },

        // Light theme 3 (from reference repo)
        'light-side-bar': '#E9E9E9',
        'light-menu-bar': '#F2F2F2',
        'light-app-content': '#F6F6F6',
        'light-border': 'rgba(0, 0, 0, 0.4)',
        'light-section-separator': 'rgba(0, 0, 0, 0.1)',
        'light-app-text': '#000000',
        'light-app-text-2': 'rgba(0, 0, 0, 0.6)',
        'light-app-hover': '#EDEDF7',

        // Dark theme 3 (from reference repo)
        'dark-side-bar': '#0D1218',
        'dark-menu-bar': '#1C2A38',
        'dark-app-content': '#151C25',
        'dark-border': '#363638',
        'dark-section-separator': 'rgba(217, 217, 217, 0.1)',
        'dark-app-text': '#FFFFFF',
        'dark-app-text-2': '#D9D9D9',
        'dark-app-hover': '#263948',
        'dark-app-border-2': '#3E3E3F',
        'dark-app-bottom-hover': '#263341',
        'dark-input-field': '#131C26',

        // Accent colors
        'primary-accent-color': 'var(--primary-accent-color, #00D67F)',
        'hyper-link': '#3A95F5',
        'hyper-link-hover': '#1877F2',
        'alert-message-error': '#E94848',
        'alert-message-success': 'rgba(0, 214, 127, 0.90)',
        'alert-message-warning': '#FFD700',
        'accent-color-1': '#00D67F',
        'accent-color-2': '#D72C27',
        'accent-color-3': '#1772E7',
        'accent-color-4': '#FD9134',
        'accent-color-5': '#8E44AD',
      },
      fontFamily: {
        sans: ['Inter', 'sans-serif'],
      },
      screens: {
        sm: '640px',
        md: '768px',
        lg: '1024px',
        xl: '1280px',
        '2xl': '1536px',
      },
      animation: {
        spin: 'spin 3s linear infinite',
      },
    },
  },
  plugins: [],
};
