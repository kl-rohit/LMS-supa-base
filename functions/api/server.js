// Cloud Run entry point.
//
// On Zoho Catalyst the platform hosted the exported Express app; on Cloud Run
// we start our own HTTP server on the platform-provided PORT. The app itself
// (routes, middleware, CORS) lives in ./index.js unchanged.

const app = require('./index');

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`Veena API listening on ${PORT}`);
});
