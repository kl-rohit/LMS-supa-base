// Netlify build helper. The static marketing pages (landing*.html, pricing.html)
// hardcode "/app/" asset + link paths because they were authored for Catalyst,
// where the app is served under /app/. On Netlify the app is at the root, so
// rewrite "/app/" -> "/" in the copied dist files (CSS, logo, /login links, etc).
// The Catalyst build (npm run build) does NOT run this, so it keeps /app/.

const fs = require('fs');
const path = require('path');

const dist = path.join(__dirname, '..', 'dist');
const files = ['landing.html', 'landing-2.html', 'landing-3.html', 'landing-4.html', 'pricing.html', 'pricing-3.html', 'pricing-4.html', 'landing-demo.html', 'landing-demo-3.html', 'landing-demo-4.html'];

for (const f of files) {
  const p = path.join(dist, f);
  if (!fs.existsSync(p)) continue;
  const before = fs.readFileSync(p, 'utf8');
  const after = before.split('/app/').join('/');
  if (after !== before) {
    fs.writeFileSync(p, after);
    console.log('fixed /app/ -> / in', f);
  }
}
