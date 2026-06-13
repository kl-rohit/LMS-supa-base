import { useState, lazy, Suspense } from 'react';
import { Routes, Route, NavLink, Navigate, useLocation } from 'react-router-dom';
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
  Music2,
  Settings as SettingsIcon,
  LogOut,
  KeyRound,
  Video,
  Shield,
} from 'lucide-react';

// Eagerly load only Login (everyone needs it immediately) and ParentLayout
// (it has its own lazy routes underneath). All other top-level routes are
// code-split via React.lazy → webpack emits a separate chunk per page, so
// first-load JS is the small shell + the destination route.
import Login from './pages/Login';
import Signup from './pages/Signup';
import ParentLayout from './layouts/ParentLayout';

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
const Platform       = lazy(() => import('./pages/Platform'));

import Loader from './components/Loader';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { ConfirmProvider } from './contexts/ConfirmContext';
import RequireAuth from './components/RequireAuth';
import { useModuleFlags } from './hooks/useModuleFlags';

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
  { to: '/student-logins', label: 'Parent Logins', icon: KeyRound,        flag: null },
  { to: '/settings',       label: 'Settings',      icon: SettingsIcon,    flag: null },
];
const PLATFORM_NAV = { to: '/platform', label: 'Platform Admin', icon: Shield, flag: null };

function navItemsFor(user, flags) {
  const base = BASE_NAV.filter((item) => !item.flag || flags[item.flag] !== false);
  // Camps is also a module — but we don't have a top-level Camps nav item,
  // so no filtering needed here. (Camps live inside Attendance flows today.)
  if (user?.role === 'App Administrator') return [...base, PLATFORM_NAV];
  return base;
}

// Teacher app shell: sidebar + main content.
function TeacherLayout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const location = useLocation();
  const { user, signOut } = useAuth();
  const { flags } = useModuleFlags();

  return (
    <div className="min-h-screen bg-gray-50 flex">
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
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center">
              <Music2 className="w-5 h-5 text-white" />
            </div>
            <span className="text-xl font-bold text-gray-900">Veena</span>
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
                onClick={() => setSidebarOpen(false)}
                className={({ isActive }) =>
                  `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors duration-150 ${
                    isActive
                      ? 'bg-indigo-50 text-indigo-700'
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
              <p className="text-xs text-indigo-500 font-medium truncate">
                {user.first_name || user.email}
              </p>
              <p className="text-xs text-indigo-400 truncate">{user.email}</p>
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

      <div className="flex-1 flex flex-col min-h-screen min-w-0">
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
        </header>

        <main className="flex-1 p-4 lg:p-6 overflow-auto">
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
              <Route path="/student-logins" element={<StudentLogins />} />
              <Route path="/settings" element={<Settings />} />
              <Route path="/platform" element={<Platform />} />
            </Routes>
          </Suspense>
        </main>
      </div>
    </div>
  );
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
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/signup" element={<Signup />} />
        <Route
          path="/portal/*"
          element={
            <RequireAuth>
              <ParentLayout />
            </RequireAuth>
          }
        />
        <Route
          path="/*"
          element={
            <RequireAuth role="App Administrator">
              <TeacherLayout />
            </RequireAuth>
          }
        />
      </Routes>
      </ConfirmProvider>
    </AuthProvider>
  );
}
