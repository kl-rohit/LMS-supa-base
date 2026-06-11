// Catalyst AdvancedIO monolith: mounts all Veena API routes.
// Express app exposed via module.exports = app.

const express = require('express');
const cors = require('cors');
const { requireAuth, requireAdmin } = require('./middleware/auth');
const { requireParent } = require('./middleware/parent');

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Health + landing
app.get('/', (_req, res) => {
  res.json({
    function: 'api',
    routes: [
      '/api/health',
      '/api/auth',
      '/api/students',
      '/api/groups',
      '/api/classes',
      '/api/attendance',
      '/api/fees',
      '/api/messages',
      '/api/reports',
      '/api/dashboard',
      '/api/import',
      '/api/camps',
      '/api/student-logins (admin)',
      '/api/courses (admin)',
      '/api/lessons (admin)',
      '/api/enrollments (admin)',
      '/api/settings (admin)',
      '/api/portal (parent)',
    ],
  });
});
app.get('/api/health', (_req, res) => res.json({ ok: true, function: 'api' }));

// /api/auth — public; /me returns 401 itself when logged out.
app.use('/api/auth', require('./routes/auth'));

// /api/portal/* — any logged-in parent; scoped to their student_id.
app.use('/api/portal', requireAuth, requireParent, require('./routes/portal'));

// Everything else requires App Administrator (teacher).
app.use('/api', requireAuth, requireAdmin);

// Resource routers (admin scope)
app.use('/api/students',       require('./routes/students'));
app.use('/api/groups',         require('./routes/groups'));
app.use('/api/classes',        require('./routes/classes'));
app.use('/api/attendance',     require('./routes/attendance'));
app.use('/api/fees',           require('./routes/fees'));
app.use('/api/messages',       require('./routes/messages'));
app.use('/api/reports',        require('./routes/reports'));
app.use('/api/dashboard',      require('./routes/dashboard'));
app.use('/api/import',         require('./routes/import'));
app.use('/api/camps',          require('./routes/camps'));
app.use('/api/student-logins', require('./routes/student-logins'));
app.use('/api/courses',        require('./routes/courses'));
app.use('/api/lessons',        require('./routes/lessons'));
app.use('/api/enrollments',    require('./routes/enrollments'));
app.use('/api/settings',       require('./routes/settings'));

module.exports = app;
