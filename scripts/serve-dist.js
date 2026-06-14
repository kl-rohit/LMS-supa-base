// Local static server that mirrors how Catalyst serves the client:
// the production build (client/dist) is mounted under /app/, with SPA
// fallback and a / -> /app/ redirect. Used to test the PWA (service
// worker + manifest) locally — localhost counts as a secure context, so
// the SW registers exactly as it will in production.
//
//   node scripts/serve-dist.js   (PORT defaults to 5180)

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 5180;
const DIST = path.join(__dirname, '..', 'client', 'dist');

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.map': 'application/json; charset=utf-8',
};

const send = (res, code, body, type) => {
  res.writeHead(code, { 'Content-Type': type || 'text/plain' });
  res.end(body);
};

http
  .createServer((req, res) => {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    let pathname = decodeURIComponent(url.pathname);

    if (pathname === '/' || pathname === '/app') {
      res.writeHead(302, { Location: '/app/' });
      return res.end();
    }
    if (!pathname.startsWith('/app/')) return send(res, 404, 'Not found');

    const rel = pathname.slice('/app/'.length) || 'index.html';
    let file = path.join(DIST, rel);

    // SPA fallback: a path with no file extension that doesn't exist on disk
    // is a client route -> serve index.html.
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      if (path.extname(rel)) return send(res, 404, 'Not found');
      file = path.join(DIST, 'index.html');
    }

    fs.readFile(file, (err, buf) => {
      if (err) return send(res, 500, 'Read error');
      send(res, 200, buf, TYPES[path.extname(file)] || 'application/octet-stream');
    });
  })
  .listen(PORT, () => console.log(`serving client/dist at http://localhost:${PORT}/app/`));
