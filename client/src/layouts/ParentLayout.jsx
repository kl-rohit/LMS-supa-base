// Parent portal shell — simpler nav than the teacher app, read-only everywhere.
// Shows the linked student's name in the header.

import { useState, useEffect } from 'react';
import { Routes, Route, NavLink, Navigate, useLocation } from 'react-router-dom';
import {
  LayoutDashboard,
  ClipboardCheck,
  IndianRupee,
  Video,
  Menu,
  X,
  Music2,
  LogOut,
  UserCircle2,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import api from '../utils/api';

import PortalDashboard from '../pages/portal/Dashboard';
import PortalAttendance from '../pages/portal/Attendance';
import PortalFees from '../pages/portal/Fees';
import PortalCourses from '../pages/portal/Courses';
import PortalProfile from '../pages/portal/Profile';
import CoursePlayer from '../pages/portal/CoursePlayer';

const navItems = [
  { to: '/portal/dashboard',  label: 'Overview',      icon: LayoutDashboard },
  { to: '/portal/lessons',    label: 'My Lessons',    icon: Video },
  { to: '/portal/attendance', label: 'Class History', icon: ClipboardCheck },
  { to: '/portal/fees',       label: 'Fees',          icon: IndianRupee },
  { to: '/portal/profile',    label: 'My Profile',    icon: UserCircle2 },
];

export default function ParentLayout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const location = useLocation();
  const { user, signOut } = useAuth();
  const [studentName, setStudentName] = useState('');
  const isAdmin = user?.role === 'App Administrator';

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
          <h1 className="text-lg font-semibold text-gray-800">{currentLabel}</h1>
        </header>

        <main className="flex-1 p-4 lg:p-6 overflow-auto">
          <Routes>
            <Route path="/" element={<Navigate to="/portal/dashboard" replace />} />
            <Route path="dashboard" element={<PortalDashboard />} />
            <Route path="lessons" element={<PortalCourses />} />
            <Route path="lessons/:courseId" element={<CoursePlayer />} />
            <Route path="attendance" element={<PortalAttendance />} />
            <Route path="fees" element={<PortalFees />} />
            <Route path="profile" element={<PortalProfile />} />
          </Routes>
        </main>
      </div>
    </div>
  );
}
