// Parent portal shell — simpler nav than the teacher app, read-only everywhere.
// Shows the linked student's name in the header.

import { useState, useEffect, lazy, Suspense } from 'react';
import { Routes, Route, NavLink, Navigate, useLocation } from 'react-router-dom';
import {
  LayoutDashboard,
  ClipboardCheck,
  IndianRupee,
  Video,
  ClipboardList,
  FileText,
  Menu,
  X,
  LogOut,
  UserCircle2,
  HelpCircle,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useModuleFlags } from '../hooks/useModuleFlags';
import { useOrgBranding } from '../hooks/useOrgBranding';
import api from '../utils/api';
import { BRAND_NAME } from '../config';
import { applyPortalMode } from '../utils/theme';
import Loader from '../components/Loader';
import NotificationBell from '../components/NotificationBell';
import OnboardingTour from '../components/OnboardingTour';
import OrgSwitcher from '../components/OrgSwitcher';

// Lazy-load each portal route so parents only download what they visit.
const PortalDashboard  = lazy(() => import('../pages/portal/Dashboard'));
const PortalAttendance = lazy(() => import('../pages/portal/Attendance'));
const PortalFees       = lazy(() => import('../pages/portal/Fees'));
const PortalCourses    = lazy(() => import('../pages/portal/Courses'));
const PortalProfile    = lazy(() => import('../pages/portal/Profile'));
const CoursePlayer     = lazy(() => import('../pages/portal/CoursePlayer'));
const PortalAssignments = lazy(() => import('../pages/portal/Assignments'));
const PortalPapers      = lazy(() => import('../pages/portal/QuestionPapers'));
const PortalHelp        = lazy(() => import('../pages/portal/Help'));

// Each nav item has a `flag` — the AppSettings toggle that gates it. The
// portal nav respects the academy's per-org visibility choices.
const ALL_NAV = [
  { to: '/portal/dashboard',  label: 'Overview',      icon: LayoutDashboard, flag: null },
  { to: '/portal/lessons',    label: 'My Lessons',    icon: Video,           flag: 'portal.show_lessons' },
  { to: '/portal/assignments',label: 'Assignments',   icon: ClipboardList,   flag: 'modules.assignments' },
  { to: '/portal/papers',     label: 'Question Papers',icon: FileText,       flag: 'modules.question_papers' },
  { to: '/portal/attendance', label: 'Class History', icon: ClipboardCheck,  flag: 'portal.show_attendance' },
  { to: '/portal/fees',       label: 'Fees',          icon: IndianRupee,     flag: 'portal.show_fees' },
  { to: '/portal/profile',    label: 'My Profile',    icon: UserCircle2,     flag: null },
  { to: '/portal/help',       label: 'Help & Guide',  icon: HelpCircle,      flag: null },
];

function visibleNav(flags) {
  return ALL_NAV.filter((item) => !item.flag || flags[item.flag] !== false);
}

export default function ParentLayout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const location = useLocation();
  const { user, signOut } = useAuth();
  const { flags, featureOn } = useModuleFlags('/portal/flags');
  const navItems = visibleNav(flags);
  const branding = useOrgBranding();
  const displayName = branding.name || BRAND_NAME;
  const [studentName, setStudentName] = useState('');
  // Reflect the academy name in the browser tab title.
  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.title = `${displayName} — Parent Portal`;
    }
  }, [displayName]);
  const isAdmin = user?.role === 'App Administrator';

  // The parent portal always follows the device's OS light/dark preference
  // (web + PWA), independent of any admin theme saved on this browser. Restore
  // the device preference when leaving the portal (shared-device safety).
  useEffect(() => {
    const restore = applyPortalMode();
    return restore;
  }, []);

  // Fetch the linked student's name once. Skipped for admin (they'll be redirected).
  useEffect(() => {
    if (isAdmin) return;
    let cancelled = false;
    api.get('/portal/me')
      .then((d) => { if (!cancelled) setStudentName(d?.student?.name || ''); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [isAdmin]);

  // Admin shouldn't be in the parent portal — bounce them home.
  if (isAdmin) return <Navigate to="/dashboard" replace />;

  const currentLabel = navItems.find((i) => location.pathname.startsWith(i.to))?.label || 'Overview';

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

        {studentName && (
          <div className="px-6 py-3 border-b border-gray-100">
            <p className="text-xs text-gray-400 uppercase tracking-wide">Viewing</p>
            <p className="text-sm font-semibold text-gray-800 mt-0.5 truncate">{studentName}</p>
          </div>
        )}

        <nav className="mt-4 px-3 space-y-1">
          {navItems.map((item) => {
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
          <h1 className="text-lg font-semibold text-gray-800">{currentLabel}</h1>
          <div className="ml-auto flex items-center gap-1">
            <OrgSwitcher />
            {featureOn('notify.bell') && <NotificationBell />}
          </div>
        </header>

        <main className="flex-1 min-h-0 p-4 lg:p-6 overflow-auto">
          <Suspense fallback={<Loader text="Loading..." />}>
            <Routes>
              <Route path="/" element={<Navigate to="/portal/dashboard" replace />} />
              <Route path="dashboard" element={<PortalDashboard />} />
              <Route path="lessons" element={<PortalCourses />} />
              <Route path="lessons/:courseId" element={<CoursePlayer />} />
              <Route path="assignments" element={<PortalAssignments />} />
              <Route path="papers" element={<PortalPapers />} />
              <Route path="attendance" element={<PortalAttendance />} />
              <Route path="fees" element={<PortalFees />} />
              <Route path="profile" element={<PortalProfile />} />
              <Route path="help" element={<PortalHelp />} />
              <Route path="help/:slug" element={<PortalHelp />} />
            </Routes>
          </Suspense>
        </main>
      </div>

      {/* First-login welcome tour (parent). Dismissal persisted per device. */}
      <OnboardingTour variant="parent" helpPath="/portal/help" />
    </div>
  );
}
