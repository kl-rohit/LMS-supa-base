import { useState, useEffect, lazy, Suspense } from 'react';
import { Routes, Route, NavLink, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import {
  LayoutDashboard,
  Users,
  UsersRound,
  Calendar,
  ClipboardCheck,
  IndianRupee,
  MessageSquare,
  BarChart3,
  Menu,
  X,
  Settings as SettingsIcon,
  LogOut,
  KeyRound,
  Video,
  ClipboardList,
  FileText,
  HelpCircle,
} from 'lucide-react';

// Eagerly load only Login (everyone needs it immediately) and ParentLayout
// (it has its own lazy routes underneath). All other top-level routes are
// code-split via React.lazy → webpack emits a separate chunk per page, so
// first-load JS is the small shell + the destination route.
import Login from './pages/Login';
import ParentLayout from './layouts/ParentLayout';
import PlatformLayout from './layouts/PlatformLayout';
import NotificationBell from './components/NotificationBell';
import OrgSwitcher from './components/OrgSwitcher';
import OfflineGame from './components/OfflineGame';
import UpdatePrompt from './components/UpdatePrompt';

const Dashboard      = lazy(() => import('./pages/Dashboard'));
const Students       = lazy(() => import('./pages/Students'));
const Groups         = lazy(() => import('./pages/Groups'));
const Classes        = lazy(() => import('./pages/Classes'));
const Attendance     = lazy(() => import('./pages/Attendance'));
const Fees           = lazy(() => import('./pages/Fees'));
const Messages       = lazy(() => import('./pages/Messages'));
const Reports        = lazy(() => import('./pages/Reports'));
const Settings       = lazy(() => import('./pages/Settings'));
const StudentLogins  = lazy(() => import('./pages/StudentLogins'));
const Lessons        = lazy(() => import('./pages/Lessons'));
const Assignments    = lazy(() => import('./pages/Assignments'));
const QuestionPapers = lazy(() => import('./pages/QuestionPapers'));
const Help           = lazy(() => import('./pages/Help'));
const VerifyCertificate = lazy(() => import('./pages/VerifyCertificate'));

import Loader from './components/Loader';
import OnboardingTour from './components/OnboardingTour';
import SetupWizard from './components/SetupWizard';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { ConfirmProvider } from './contexts/ConfirmContext';
import RequireAuth, { roleHome } from './components/RequireAuth';
import { useModuleFlags } from './hooks/useModuleFlags';
import { useOrgBranding } from './hooks/useOrgBranding';
import { BRAND_NAME } from './config';

// Every nav item gets a `flag` key — the name of the AppSettings toggle
// that gates it. Items with flag: null are always visible (foundational).
const BASE_NAV = [
  { to: '/dashboard',      label: 'Dashboard',     icon: LayoutDashboard, flag: null },
  { to: '/students',       label: 'Students',      icon: Users,           flag: null },
  { to: '/groups',         label: 'Groups',        icon: UsersRound,      flag: 'modules.groups' },
  { to: '/classes',        label: 'Classes',       icon: Calendar,        flag: null },
  { to: '/attendance',     label: 'Attendance',    icon: ClipboardCheck,  flag: null },
  { to: '/fees',           label: 'Fees',          icon: IndianRupee,     flag: 'modules.fees' },
  { to: '/messages',       label: 'Messages',      icon: MessageSquare,   flag: 'modules.messages' },
  { to: '/reports',        label: 'Reports',       icon: BarChart3,       flag: 'modules.reports' },
  { to: '/lessons',        label: 'Lessons',       icon: Video,           flag: 'modules.lessons' },
  { to: '/assignments',    label: 'Assignments',   icon: ClipboardList,   flag: 'modules.assignments' },
  { to: '/question-papers',label: 'Question Papers',icon: FileText,       flag: 'modules.question_papers' },
  { to: '/student-logins', label: 'Parent Logins', icon: KeyRound,        flag: null },
];
// Maps the first URL segment to the Help article slug that documents it, so the
// header Help icon opens context-aware help (e.g. on /students it opens the
// Students article). Segments without a dedicated article fall back to the
// help index ('welcome').
const HELP_SLUG_BY_PATH = {
  dashboard: 'dashboard',
  students: 'students',
  groups: 'students',
  classes: 'classes',
  attendance: 'attendance',
  fees: 'fees',
  messages: 'notifications',
  reports: 'reports',
  lessons: 'lessons',
  assignments: 'assignments',
  'question-papers': 'question-papers',
  'student-logins': 'parent-logins',
  settings: 'settings',
};

function navItemsFor(user, flags) {
  // Platform Admin is intentionally NOT a sidebar item. It lives on its own
  // path (/platform) behind its own guard so it is invisible to academy users
  // and never mixes with tenant data. The platform owner reaches it directly.
  return BASE_NAV.filter((item) => !item.flag || flags[item.flag] !== false);
}

// Teacher app shell: sidebar + main content.
function TeacherLayout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const { user, signOut } = useAuth();
  const { flags } = useModuleFlags();
  const branding = useOrgBranding();
  const displayName = branding.name || BRAND_NAME;

  // Reflect the academy name in the browser tab title.
  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.title = `${displayName} — Student Tracker`;
    }
  }, [displayName]);

  return (
    <div className="h-screen overflow-hidden bg-gray-50 flex">
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-30 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-40 w-64 bg-white border-r border-gray-200 transform transition-transform duration-300 ease-in-out lg:translate-x-0 lg:static lg:z-auto ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex items-center justify-between h-16 px-6 border-b border-gray-200">
          <div className="flex items-center gap-2 min-w-0">
            {branding.logoUrl ? (
              <img
                src={branding.logoUrl}
                alt=""
                className="w-8 h-8 rounded-lg object-cover flex-shrink-0"
                onError={(e) => { e.currentTarget.style.display = 'none'; }}
              />
            ) : (
              <img
                src={`${process.env.PUBLIC_URL || '/'}logo.png`}
                alt=""
                className="w-8 h-8 rounded-lg object-cover flex-shrink-0"
              />
            )}
            <span className="text-xl font-bold text-gray-900 truncate">{displayName}</span>
          </div>
          <button
            className="lg:hidden p-1 rounded-md hover:bg-gray-100"
            onClick={() => setSidebarOpen(false)}
          >
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        <nav className="mt-4 px-3 space-y-1 overflow-y-auto" style={{ maxHeight: 'calc(100vh - 220px)' }}>
          {navItemsFor(user, flags).map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                data-tour={`nav-${item.to.replace(/^\//, '')}`}
                onClick={() => setSidebarOpen(false)}
                className={({ isActive }) =>
                  `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors duration-150 ${
                    isActive
                      ? 'bg-indigo-50 text-gray-900 dark:bg-indigo-600 dark:text-white'
                      : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                  }`
                }
              >
                <Icon className="w-5 h-5 flex-shrink-0" />
                {item.label}
              </NavLink>
            );
          })}
        </nav>

        {/* User card + logout, pinned to bottom */}
        <div className="absolute bottom-4 left-3 right-3 space-y-2">
          {user && (
            <div className="bg-indigo-50 rounded-lg p-3">
              <p className="text-xs text-gray-900 font-medium truncate">
                {user.first_name || user.email}
              </p>
              <p className="text-xs text-gray-500 truncate">{user.email}</p>
            </div>
          )}
          <button
            onClick={signOut}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-50 hover:text-gray-900 transition-colors"
          >
            <LogOut className="w-4 h-4" />
            Sign out
          </button>
        </div>
      </aside>

      <div className="flex-1 flex flex-col min-h-0 min-w-0">
        <header className="h-16 bg-white border-b border-gray-200 flex items-center px-4 lg:px-6 sticky top-0 z-20">
          <button
            className="lg:hidden p-2 rounded-md hover:bg-gray-100 mr-3"
            onClick={() => setSidebarOpen(true)}
          >
            <Menu className="w-5 h-5 text-gray-600" />
          </button>
          <h1 className="text-lg font-semibold text-gray-800 capitalize">
            {location.pathname.split('/')[1]?.replace(/-/g, ' ') || 'Dashboard'}
          </h1>
          <div className="ml-auto flex items-center gap-1">
            <OrgSwitcher />
            <NotificationBell
              listUrl="/notifications"
              readUrl={(id) => `/notifications/${id}/read`}
              readAllUrl="/notifications/read-all"
              pushBase="/notifications"
            />
            {/* Context-aware Help — opens the article for the page you're on. */}
            <button
              type="button"
              title="Help for this page"
              aria-label="Help for this page"
              data-tour="header-help"
              onClick={() => {
                const seg = location.pathname.split('/')[1] || 'dashboard';
                navigate(`/help/${HELP_SLUG_BY_PATH[seg] || 'welcome'}`);
              }}
              className={`p-2 rounded-md transition-colors ${
                location.pathname.startsWith('/help')
                  ? 'bg-indigo-50 text-indigo-700'
                  : 'text-gray-600 hover:bg-gray-100'
              }`}
            >
              <HelpCircle className="w-5 h-5" />
            </button>
            {/* Settings — opens the full-screen settings overlay. */}
            <button
              type="button"
              title="Settings"
              aria-label="Settings"
              data-tour="header-settings"
              onClick={() => navigate('/settings')}
              className={`p-2 rounded-md transition-colors ${
                location.pathname.startsWith('/settings')
                  ? 'bg-indigo-50 text-indigo-700'
                  : 'text-gray-600 hover:bg-gray-100'
              }`}
            >
              <SettingsIcon className="w-5 h-5" />
            </button>
          </div>
        </header>

        <main className="flex-1 min-h-0 p-4 lg:p-6 overflow-auto">
          {/* Suspense boundary catches each lazy route's loading state.
              Loader has a short delay so the spinner doesn't flash on a
              fast network — feels instant when the chunk is small. */}
          <Suspense fallback={<Loader text="Loading..." />}>
            <Routes>
              <Route path="/" element={<Navigate to="/dashboard" replace />} />
              <Route path="/dashboard" element={<Dashboard />} />
              <Route path="/students" element={<Students />} />
              <Route path="/groups" element={<Groups />} />
              <Route path="/classes" element={<Classes />} />
              <Route path="/attendance" element={<Attendance />} />
              <Route path="/fees" element={<Fees />} />
              <Route path="/messages" element={<Messages />} />
              <Route path="/reports" element={<Reports />} />
              <Route path="/lessons" element={<Lessons />} />
              <Route path="/assignments" element={<Assignments />} />
              <Route path="/question-papers" element={<QuestionPapers />} />
              <Route path="/student-logins" element={<StudentLogins />} />
              <Route path="/settings" element={<Settings />} />
              <Route path="/help" element={<Help />} />
              <Route path="/help/:slug" element={<Help />} />
            </Routes>
          </Suspense>
        </main>
      </div>

      {/* First-run setup wizard (new orgs only) — collects core org config.
          Shows ahead of the welcome tour; both are gated on server flags. */}
      <SetupWizard />

      {/* First-login welcome tour (admin). Dismissal persisted per device. */}
      <OnboardingTour variant="admin" helpPath="/help" />
    </div>
  );
}

// Guard for the Platform Admin area. Unlike RequireAuth's app_role check, this
// keys off the Catalyst account role: ONLY the platform owner (Catalyst "App
// Administrator") may enter. An academy owner has app_role 'admin' too, so we
// must not use that here — we check the real account role. Anyone else is sent
// to their own home. The server independently enforces this on /api/platform/*,
// so this guard is purely about not rendering the page.
function RequirePlatform({ children }) {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader />
      </div>
    );
  }
  if (!user) {
    const base = (process.env.PUBLIC_URL || '/').replace(/\/$/, '');
    window.location.replace(`${base}/landing.html`);
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader />
      </div>
    );
  }
  if (user.role !== 'App Administrator') {
    return <Navigate to={roleHome(user.app_role)} replace />;
  }
  return children;
}

export default function App() {
  return (
    <AuthProvider>
      <ConfirmProvider>
      <Toaster
        position="top-right"
        toastOptions={{
          duration: 3000,
          style: { borderRadius: '10px', background: '#333', color: '#fff' },
        }}
      />
      {/* Pops up a quick game when the device goes offline; closes itself once
          the connection returns. Self-contained, no network or auth needed. */}
      <OfflineGame />
      {/* Offers a refresh when a new build is downloaded and waiting. */}
      <UpdatePrompt />
      <Routes>
        <Route path="/login" element={<Login />} />
        {/* Academy creation is invite-only (platform admin creates them from
            the Platform Admin page). The public signup form is retired — any
            stale /signup link just bounces to sign-in. */}
        <Route path="/signup" element={<Navigate to="/login" replace />} />
        {/* PUBLIC certificate verification — no login. Mounted before the
            RequireAuth routes so anyone with a certificate QR / link can
            confirm it is genuine. Backed by the no-auth /api/verify route. */}
        <Route
          path="/verify/:id"
          element={
            <Suspense fallback={<Loader />}>
              <VerifyCertificate />
            </Suspense>
          }
        />
        <Route
          path="/portal/*"
          element={
            <RequireAuth>
              <ParentLayout />
            </RequireAuth>
          }
        />
        {/* Platform Admin — its own path + guard, outside the academy shell.
            Only the Catalyst App Administrator (platform owner) can enter; it
            is intentionally absent from the academy sidebar. */}
        <Route
          path="/platform/*"
          element={
            <RequirePlatform>
              <PlatformLayout />
            </RequirePlatform>
          }
        />
        <Route
          path="/*"
          element={
            <RequireAuth role="admin">
              <TeacherLayout />
            </RequireAuth>
          }
        />
      </Routes>
      </ConfirmProvider>
    </AuthProvider>
  );
}
