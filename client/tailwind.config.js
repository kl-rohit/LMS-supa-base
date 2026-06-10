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
