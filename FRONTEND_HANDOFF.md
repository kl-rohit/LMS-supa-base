# Veena — Frontend Handoff

Build the React UI for the Veena student-attendance app. Single user (the music teacher). No auth. Single-page app deployed to Catalyst Web Client Hosting.

---

## 1. Tech stack

| Concern | Choice | Version |
|---------|--------|---------|
| Framework | React | 18.3 |
| Bundler | webpack | 5 |
| Transpiler | babel (`@babel/preset-env`, `@babel/preset-react`) | latest |
| Styling | Tailwind CSS | 3.4 |
| PostCSS plugins | tailwindcss, autoprefixer | latest |
| Routing | `react-router-dom` | 6.28 (BrowserRouter) |
| Icons | `lucide-react` | 0.460 |
| Toasts | `react-hot-toast` | 2.4 |
| CSV parsing | `papaparse` | 5.4 |
| HTTP | native `fetch` (wrapped in `utils/api.js`) | — |
| Dev server | webpack-dev-server | 5 (port 5173) |

No state management library (component state + prop drilling). No CSS-in-JS. No testing framework.

---

## 2. Folder structure

```
client/
├── package.json
├── webpack.config.js
├── tailwind.config.js
├── postcss.config.js
├── public/
│   └── client-package.json        # { "name": "veena-client", "spa": true }
└── src/
    ├── index.html                  # shell, just <div id="root">
    ├── index.js                    # entry — mounts BrowserRouter + App
    ├── index.css                   # @tailwind directives + custom utility classes
    ├── App.jsx                     # sidebar layout + Routes
    ├── pages/                      # one file per route
    │   ├── Dashboard.jsx
    │   ├── Students.jsx
    │   ├── Groups.jsx
    │   ├── Classes.jsx
    │   ├── Attendance.jsx
    │   ├── Fees.jsx
    │   ├── Messages.jsx
    │   ├── Reports.jsx
    │   └── Settings.jsx
    ├── components/                 # reusable
    │   ├── Modal.jsx
    │   ├── ConfirmDialog.jsx
    │   ├── Loader.jsx
    │   ├── EmptyState.jsx
    │   └── StatsCard.jsx
    └── utils/
        └── api.js                  # fetch wrapper
```

---

## 3. Build config

### `package.json` scripts
```json
"start": "webpack serve --mode development",
"build": "webpack --mode production && cp public/client-package.json dist/",
"build:catalyst": "PUBLIC_URL=/app/ API_BASE=/server/api/api webpack --mode production && cp public/client-package.json dist/"
```

### `webpack.config.js` essentials
- Entry: `./src/index.js`
- Output: `dist/[name].[contenthash].js`, `clean: true`
- `publicPath: process.env.PUBLIC_URL || '/'` (controls asset URL prefix)
- Loaders: `babel-loader` for `.jsx`/`.js`, `style-loader` + `css-loader` + `postcss-loader` for `.css`, `@svgr/webpack` for `.svg`, asset modules for images
- `DefinePlugin`: inject `process.env.API_BASE` and `process.env.PUBLIC_URL` into the bundle
- `HtmlWebpackPlugin` with template `./src/index.html`
- Dev server: port `5173`, `historyApiFallback: true`, `/api` proxied to `http://localhost:3001`
- Production: `TerserPlugin` + `CssMinimizerPlugin`

### `tailwind.config.js` — design tokens

```js
module.exports = {
  content: ['./src/**/*.{js,jsx}', './src/index.html'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // Light theme
        'light-side-bar': '#E9E9E9',
        'light-menu-bar': '#F2F2F2',
        'light-app-content': '#F6F6F6',
        'light-app-text': '#000000',
        'light-app-text-2': 'rgba(0, 0, 0, 0.6)',
        'light-app-hover': '#EDEDF7',
        // Dark theme
        'dark-side-bar': '#0D1218',
        'dark-menu-bar': '#1C2A38',
        'dark-app-content': '#151C25',
        'dark-app-text': '#FFFFFF',
        'dark-app-text-2': '#D9D9D9',
        'dark-app-hover': '#263948',
        'dark-input-field': '#131C26',
        // Accents
        'primary-accent-color': 'var(--primary-accent-color, #00D67F)',
        'hyper-link': '#3A95F5',
        'alert-message-error': '#E94848',
        'alert-message-success': 'rgba(0, 214, 127, 0.90)',
      },
      fontFamily: { sans: ['Inter', 'sans-serif'] },
    },
  },
};
```

### `postcss.config.js`
```js
module.exports = {
  plugins: [require('tailwindcss'), require('autoprefixer')],
};
```

### `client-package.json` (in `public/`)
```json
{ "name": "veena-client", "spa": true }
```
The `spa: true` makes Catalyst Web Client Hosting fall back to `index.html` for unmatched routes (so React Router works on reload).

---

## 4. Entry point

### `src/index.html`
```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Veena - Student Tracker</title>
  </head>
  <body class="bg-gray-50">
    <div id="root"></div>
  </body>
</html>
```

### `src/index.js`
```js
import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.jsx';
import './index.css';

const basename = process.env.PUBLIC_URL || '/';
const root = createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <BrowserRouter basename={basename}>
      <App />
    </BrowserRouter>
  </React.StrictMode>
);
```

### `src/index.css`
```css
@tailwind base;
@tailwind components;
@tailwind utilities;
@import url("https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap");

@layer base {
  body { @apply font-sans antialiased text-gray-800; }
}

@layer components {
  .btn-primary { @apply bg-indigo-600 hover:bg-indigo-700 text-white font-medium py-2 px-4 rounded-lg transition-colors inline-flex items-center gap-2 disabled:opacity-50; }
  .btn-secondary { @apply bg-white hover:bg-gray-50 text-gray-700 font-medium py-2 px-4 rounded-lg border border-gray-300 inline-flex items-center gap-2; }
  .btn-danger { @apply bg-red-600 hover:bg-red-700 text-white font-medium py-2 px-4 rounded-lg inline-flex items-center gap-2; }
  .btn-sm { @apply py-1.5 px-3 text-sm; }
  .input-field, .select-field { @apply w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none bg-white; }
  .card { @apply bg-white rounded-xl shadow-sm border border-gray-100 p-6; }
  .page-header { @apply text-2xl font-bold text-gray-900 mb-6; }
  .table-header { @apply px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider; }
  .table-cell { @apply px-4 py-3 text-sm text-gray-700; }
  .badge { @apply inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium; }
  .badge-online { @apply badge bg-blue-100 text-blue-800; }
  .badge-offline { @apply badge bg-emerald-100 text-emerald-800; }
  .badge-offline-group { @apply badge bg-purple-100 text-purple-800; }
}
```

---

## 5. App shell (`src/App.jsx`)

- Sidebar (`w-64`, white background, collapsible on mobile via state + overlay).
- Top bar (`h-16`, sticky, current route name capitalized).
- Main content (`flex-1 p-4 lg:p-6 overflow-auto`).
- 9 nav items with `lucide-react` icons:

```js
const navItems = [
  { to: '/dashboard',  label: 'Dashboard',  icon: LayoutDashboard },
  { to: '/students',   label: 'Students',   icon: Users },
  { to: '/groups',     label: 'Groups',     icon: UsersRound },
  { to: '/classes',    label: 'Classes',    icon: Calendar },
  { to: '/attendance', label: 'Attendance', icon: ClipboardCheck },
  { to: '/fees',       label: 'Fees',       icon: IndianRupee },
  { to: '/messages',   label: 'Messages',   icon: MessageSquare },
  { to: '/reports',    label: 'Reports',    icon: BarChart3 },
  { to: '/settings',   label: 'Settings',   icon: Settings },
];
```

- Brand mark in sidebar header: indigo square + `Music2` icon + "Veena" wordmark.
- `<Toaster position="top-right" />` from react-hot-toast in the root.
- `<Route path="/" element={<Navigate to="/dashboard" replace />} />` so the root redirects.

---

## 6. API utility (`src/utils/api.js`)

```js
const BASE_URL = process.env.API_BASE || '/api';

async function request(url, options = {}) {
  const config = { headers: { 'Content-Type': 'application/json' }, ...options };
  if (config.body && typeof config.body === 'object') {
    config.body = JSON.stringify(config.body);
  }
  const res = await fetch(`${BASE_URL}${url}`, config);
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try { const e = await res.json(); msg = e.error || e.message || msg; } catch {}
    throw new Error(msg);
  }
  if (res.status === 204) return null;
  return res.json();
}

export default {
  get:    (url) => request(url, { method: 'GET' }),
  post:   (url, data) => request(url, { method: 'POST',   body: data }),
  put:    (url, data) => request(url, { method: 'PUT',    body: data }),
  delete: (url) => request(url, { method: 'DELETE' }),
};
```

`BASE_URL` is injected at **build time** by `webpack.DefinePlugin`:
- Local dev → `/api` (proxied to Express on :3001)
- Catalyst → `/server/api/api`

---

## 7. Design system at a glance

### Color roles
| Role | Class |
|------|-------|
| Primary | `indigo-600` (buttons, active nav, accents) |
| Background | `gray-50` |
| Card | `white` with `border-gray-100`, `rounded-xl`, `shadow-sm` |
| Text primary | `gray-900` |
| Text secondary | `gray-500` |
| Success | `emerald-500` / `green-500` |
| Danger | `red-500` / `red-600` |

### Class-type color coding (Classes / Attendance / Dashboard / Fees)
| Type | Border | Background | Icon |
|------|--------|-----------|------|
| `online` | `blue-500` | `blue-50` | `Monitor` |
| `offline` | `emerald-500` | `emerald-50` | `MapPin` |
| `offline_group` | `purple-500` | `purple-50` | `UsersRound` |
| `online_group` | `cyan-500` | `cyan-50` | `Wifi` |

### Typography
- Font: **Inter** (loaded from Google Fonts in `index.css`)
- Page header: `text-2xl font-bold text-gray-900 mb-6` → `.page-header`
- Table header: `text-xs font-semibold text-gray-500 uppercase tracking-wider` → `.table-header`

### Reusable components
| Component | Props | Behavior |
|-----------|-------|----------|
| `Modal` | `isOpen, onClose, title, size: 'sm'\|'md'\|'lg', children` | Centered overlay, backdrop click closes, ESC key closes |
| `ConfirmDialog` | `isOpen, onClose, onConfirm, title, message, confirmText` | Two-button modal for destructive actions |
| `Loader` | `text?` | Centered spinner with optional text below |
| `EmptyState` | `icon (Lucide), title, message` | Icon + heading + sub-text for empty data |
| `StatsCard` | `icon, label, value, color` | Dashboard metric card |

---

## 8. Pages — what each does

### 8.1 Dashboard (`/dashboard`)
- 4 `StatsCard`s in a 4-col grid: Total Students, Today's Classes, Attendance Rate, Fees Collected.
- "Today's Classes" panel with cards (clickable → `/attendance`).
- "Recent Attendance" panel — last 5 attendance records.
- "Absence Alerts" widget if any students have ≥3 consecutive absences.
- Single fetch: `GET /api/dashboard`.

### 8.2 Students (`/students`)
- Search + status filter (All/Active/Inactive).
- Sortable table: Name, Parent, Mobile, Online ₹/hr, Offline ₹/hr, Group ₹/hr, Status, Actions.
- **Add Student** modal: name, parent_name, mobile_number, 3 fee fields, status, notes.
- **Edit** (pencil icon per row).
- **Delete** (trash icon) — soft-delete by default (sets `status='inactive'`), hard-delete with `?force=true`.
- **Import CSV** — uses `papaparse`; expected headers: `name, parent_name, mobile_number, fee_online, fee_offline, fee_offline_group, notes`.
- **Delete all inactive** bulk action.

### 8.3 Groups (`/groups`)
- List of groups with name, description, member count.
- **Add Group** modal: name, description.
- Expand row → see/add/remove members.

### 8.4 Classes (`/classes`)
- Weekly calendar view — 7 cards (Sun–Sat). Today highlighted with `ring-2 ring-indigo-300`.
- Filter chips: All / Online / Offline / Offline Group / Online Group.
- **Add Class** modal:
  - Inputs: name, class_type, day_of_week, start_time, end_time. Duration computed live.
  - Individual types (online/offline): **multi-select students** with checkboxes, search, Select All, Clear. One class created per student (or use ClassStudents join — backend's call).
  - Group types (offline_group/online_group): single Group dropdown.

### 8.5 Attendance (`/attendance`)
- Date picker (defaults to today) with ← → arrows.
- Red banner at top: students with ≥3 consecutive absences.
- List of classes scheduled for that day-of-week.
- Click a class → renders a table:
  - Student name (with red badge if absent_streak ≥ 3)
  - Status toggle: Present / Absent
  - Topic input
  - Fee column (editable when Present, hidden when Absent)
  - Trash icon to delete a single saved record
- Running totals at top right: `Present | Absent | ₹fee_total`.
- **Save Attendance** button → `POST /api/attendance/bulk`.
- **Delete All** button when existing records exist for class+date.

### 8.6 Fees (`/fees`)
- Month selector (← → + dropdowns).
- Per-student row: classes_taken, class_fees_total, additional_fees_total, grand_total.
- Click row to expand → class-by-class breakdown for that month + additional fees list.
- **Add Additional Fee** modal: multi-select students + description + amount + date → one row per student.

### 8.7 Messages (`/messages`)
- 5 templates: Fee Reminder, Absence Alert, General Reminder, Class Schedule, Custom.
- **New Message** modal: pick student → pick template → edit body → save.
- WhatsApp button per row: opens `https://wa.me/<mobile>?text=<encoded>`.
- Mark sent toggle, delete (single + bulk).
- "Generate Absence Alerts" — creates draft messages for students with ≥3 absences.
- "Generate Fee Reminders" — creates draft messages for students with outstanding fees this month.

### 8.8 Reports (`/reports`)
- 3 tabs: **Student** (per-student summary), **Monthly** (all students × months grid), **Overall** (totals + breakdown by class type).
- Date range picker.
- CSV export buttons.

### 8.9 Settings (`/settings`)
- Zoho Sheets integration:
  - Expandable setup guide (3 steps).
  - Form: Client ID, Secret, Refresh Token, Region (`com` / `in` / `eu` / `au`).
  - **Test Connection** → verifies OAuth.
  - **Create Spreadsheet** → creates workbook with 6 tabs + headers.
  - **Sync All Data** → wipes & re-pushes all DB data.
  - Auto-sync toggle.

---

## 9. API contract (what the frontend expects)

All routes return JSON. Errors return `{ error: string, detail?: string }`.

### Students
```
GET    /api/students                    → { students: [...] }
GET    /api/students?search=X&status=active&page=1&limit=20 → { students, pagination }
GET    /api/students/:id                → { student, groups, classes }
POST   /api/students                    body: { name, parent_name, mobile_number, fee_online, fee_offline, fee_offline_group, status, notes } → { student }
PUT    /api/students/:id                → { student }
DELETE /api/students/:id?force=true     → { message }
DELETE /api/students/inactive           → { message, count }
```

### Groups
```
GET    /api/groups                            → { groups }
GET    /api/groups/:id                        → { group, students }
GET    /api/groups/:id/students               → { students }
POST   /api/groups                            → { group }
POST   /api/groups/:id/students               body: { student_ids: [] } → { added }
PUT    /api/groups/:id                        → { group }
DELETE /api/groups/:id                        → { message }
DELETE /api/groups/:id/students/:studentId    → { message }
```

### Classes
```
GET    /api/classes                          → { classes }
GET    /api/classes/today                    → { classes, day_of_week }
GET    /api/classes/:id                      → { class }  (with group_members[] if group class)
POST   /api/classes                          body: { name, class_type, day_of_week, start_time, end_time, student_ids|student_id, group_id } → { class | classes }
PUT    /api/classes/:id                      → { class }
DELETE /api/classes/:id                      → { message }
```

### Attendance
```
GET    /api/attendance?class_id&student_id&from&to&date  → { attendance: [...] }
GET    /api/attendance/by-date/:date         → { attendance }
GET    /api/attendance/by-student/:studentId → { attendance }
GET    /api/attendance/absent-streaks/all    → { alerts: [{ student_id, student_name, consecutive_absences }] }
POST   /api/attendance                       → { attendance }
POST   /api/attendance/bulk                  body: { class_id, date, records: [{student_id, status, topic, fee_charged}] } → { results }
PUT    /api/attendance/:id                   → { attendance }
DELETE /api/attendance/:id                   → { message }
```

### Fees
```
GET    /api/fees/monthly/:year/:month       → { students: [{ student_id, student_name, class_fees, additional_fees, grand_total }] }
GET    /api/fees/student/:id?from&to        → ...
GET    /api/fees/overall                    → ...
GET    /api/fees/additional?month&year&student_id → { additional_fees }
POST   /api/fees/additional                 body: { student_ids|student_id, description, amount, fee_date, month, year } → { additional_fee | additional_fees }
PUT    /api/fees/additional/:id             → { additional_fee }
DELETE /api/fees/additional/:id             → { message }
```

### Messages
```
GET    /api/messages                            → { messages }
POST   /api/messages                            → { message }
POST   /api/messages/generate-absence-alert     → { created }
POST   /api/messages/generate-fee-reminder      → { created }
PUT    /api/messages/:id                        → { message }
DELETE /api/messages/:id                        → { message }
```

### Reports
```
GET    /api/reports/student/:id?from&to       → student report
GET    /api/reports/monthly/:year/:month      → monthly report
GET    /api/reports/overall                   → overall report
```

### Import
```
POST   /api/import/students       body: { rows: [...] } → { imported }
POST   /api/import/attendance     body: { rows: [...] } → { imported }
```

### Dashboard
```
GET    /api/dashboard             → { stats, today_classes, alerts }
```

### Settings
```
GET    /api/settings/zoho                          → { client_id, region, has_credentials, ... (masked) }
PUT    /api/settings/zoho                          → { ok }
POST   /api/settings/zoho/test                     → { ok }
POST   /api/settings/zoho/create-spreadsheet       → { spreadsheet_id, url }
POST   /api/settings/zoho/sync-all                 → { results }
GET    /api/settings/zoho/status                   → { enabled, spreadsheet_id, last_sync }
```

---

## 10. Step-by-step build plan

1. **Scaffold** — `npm init -y`, install deps, copy the 3 config files (webpack, tailwind, postcss).
2. **Entry point** — write `src/index.html`, `index.js`, `index.css`. Build with `npm start` and confirm a blank-but-styled page.
3. **App shell** — implement `App.jsx` with the sidebar + top bar + empty `<Routes>`. All pages can return placeholder `<div>Page</div>` for now.
4. **Reusable components** — build `Modal`, `ConfirmDialog`, `Loader`, `EmptyState`, `StatsCard`.
5. **API utility** — build `utils/api.js` (15 lines, copy from §6).
6. **Page-by-page** — build in this order (easiest → hardest):
   1. Students (simplest CRUD, good for getting the pattern right)
   2. Groups (M2M relationship)
   3. Classes (multi-student, group support)
   4. Attendance (most complex UI — date picker, class selection, table with inline edits)
   5. Fees (monthly aggregation, expand-on-click breakdown)
   6. Messages (templates, WhatsApp deep-link)
   7. Reports (3 tabs, CSV export)
   8. Dashboard (read-only, mostly just stats)
   9. Settings (Zoho Sheets integration UI)
7. **Build for Catalyst** — `npm run build:catalyst`. Verify `dist/` contains `client-package.json` + hashed bundle.

---

## 11. Local dev workflow

```bash
cd client
npm install
npm start                    # webpack-dev-server on :5173
```

Webpack proxies `/api` to `http://localhost:3001`. Run your Express/Catalyst backend on that port.

For Catalyst-style URLs locally:
```bash
PUBLIC_URL=/app/ API_BASE=/server/api/api npm start
```

For prod build:
```bash
npm run build:catalyst       # creates dist/ ready for `catalyst deploy --client`
```

---

## 12. Gotchas

| Issue | Fix |
|-------|-----|
| Blank screen at `/app/` after deploy | `BrowserRouter basename={process.env.PUBLIC_URL}` and `webpack.publicPath: process.env.PUBLIC_URL` must both be set |
| 404 on direct URL reload (e.g. `/app/students`) | `client-package.json` must include `"spa": true` |
| `process.env.API_BASE` is undefined in the browser | webpack's `DefinePlugin` must be configured to inject it. Without it, you'll get `BASE_URL = undefined + url` → silently broken URLs |
| `client-package.json` missing from `dist/` after build | Vite copies `public/` automatically; webpack doesn't. Your build script must `cp public/client-package.json dist/` |
| Tailwind classes not applying in production | Check `tailwind.config.js` `content` paths — must include `./src/**/*.{js,jsx}` |
| Inter font not loading | Make sure the `@import url(...)` is at the **top** of `index.css`, before `@tailwind` directives |
