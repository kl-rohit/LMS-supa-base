/** @type {import('tailwindcss').Config} */
// Dedicated Tailwind build for the STATIC landing page (public/landing.html).
// The landing page has its own brand/gold palette and is independent of the
// React app's CSS-variable theme (see ./tailwind.config.js). Compiling it to a
// small purged stylesheet replaces the runtime Tailwind Play CDN, which was the
// landing page's biggest render-blocking cost (FCP/LCP).
//
// Build:  npx tailwindcss -c landing.tailwind.config.js -i src/landing.css -o dist/landing.css --minify
module.exports = {
  content: ['./public/landing.html'],
  theme: {
    extend: {
      colors: {
        // VidyaSetu brand — deep navy (from the swan + book mark)
        brand: {
          50: '#eef1f8', 100: '#d8def0', 200: '#b3c0e0', 300: '#8497c7', 400: '#5570a7',
          500: '#34508a', 600: '#243a6e', 700: '#1b2c54', 800: '#14224e', 900: '#0e1733',
        },
        // VidyaSetu accent — warm gold
        gold: {
          50: '#fbf6e9', 100: '#f5e9c6', 200: '#ecd591', 300: '#e0bd5c', 400: '#d4a73c',
          500: '#caa14b', 600: '#a9842f', 700: '#866626', 800: '#6b5120', 900: '#5a441d',
        },
      },
      fontFamily: {
        sans: ['ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'Helvetica Neue', 'Arial', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
