// Admin "view as parent" — a read-only preview of the parent portal for any
// student, reusing the real portal page components so it shows EXACTLY what the
// family sees (respecting the academy's visibility toggles + per-child overrides).
//
// How it works: setApiPreviewStudent() tells utils/api to redirect every
// /portal/* GET to the read-only /portal-preview/:id mount for this student.
// The portal pages themselves are unchanged.

import { useState, useEffect, lazy, Suspense } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, Video, ClipboardList, FileText, CalendarDays,
  ClipboardCheck, IndianRupee, UserCircle2, X, Eye,
} from 'lucide-react';
import api, { setApiPreviewStudent } from '../utils/api';
import { useModuleFlags } from '../hooks/useModuleFlags';
import Loader from '../components/Loader';

const PortalDashboard   = lazy(() => import('./portal/Dashboard'));
const PortalCourses     = lazy(() => import('./portal/Courses'));
const PortalAssignments = lazy(() => import('./portal/Assignments'));
const PortalPapers      = lazy(() => import('./portal/QuestionPapers'));
const PortalPrograms    = lazy(() => import('./portal/Programs'));
const PortalAttendance  = lazy(() => import('./portal/Attendance'));
const PortalFees        = lazy(() => import('./portal/Fees'));
const PortalProfile     = lazy(() => import('./portal/Profile'));

// Mirrors ParentLayout's nav gating: each tab shows only when every listed flag
// is on (default-visible). Component is the portal page it renders.
const TABS = [
  { key: 'dashboard',   label: 'Overview',        icon: LayoutDashboard, flags: [], Comp: PortalDashboard },
  { key: 'lessons',     label: 'My Lessons',      icon: Video,           flags: ['portal.show_lessons'], Comp: PortalCourses },
  { key: 'assignments', label: 'Assignments',     icon: ClipboardList,   flags: ['modules.assignments', 'portal.show_assignments'], Comp: PortalAssignments },
  { key: 'papers',      label: 'Question Papers', icon: FileText,        flags: ['modules.question_papers', 'portal.show_papers'], Comp: PortalPapers },
  { key: 'programs',    label: 'Programs',        icon: CalendarDays,    flags: ['modules.programs', 'portal.show_programs'], Comp: PortalPrograms },
  { key: 'attendance',  label: 'Class History',   icon: ClipboardCheck,  flags: ['portal.show_attendance'], Comp: PortalAttendance },
  { key: 'fees',        label: 'Fees',            icon: IndianRupee,     flags: ['portal.show_fees'], Comp: PortalFees },
  { key: 'profile',     label: 'My Profile',      icon: UserCircle2,     flags: [], Comp: PortalProfile },
];

export default function PortalPreview() {
  const { studentId } = useParams();
  // Set the preview target synchronously (before useModuleFlags/portal pages fire
  // their first fetch) so every /portal/* GET is rewritten to the preview mount.
  setApiPreviewStudent(studentId);
  const navigate = useNavigate();
  const [active, setActive] = useState('dashboard');
  const [name, setName] = useState('');
  const { flags, loaded } = useModuleFlags('/portal/flags');

  // Keep it pinned while mounted; clear it on exit so normal admin calls resume.
  useEffect(() => {
    setApiPreviewStudent(studentId);
    let cancelled = false;
    api.get('/portal/me').then((d) => { if (!cancelled) setName(d?.student?.name || ''); }).catch(() => {});
    return () => { setApiPreviewStudent(null); cancelled = true; };
  }, [studentId]);

  const visible = TABS.filter((t) => (t.flags || []).every((f) => flags[f] !== false));
  const current = visible.find((t) => t.key === active) || visible[0];
  const Comp = current?.Comp;

  const exit = () => { setApiPreviewStudent(null); navigate('/student-logins'); };

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Read-only preview banner */}
      <div className="sticky top-0 z-30 bg-indigo-700 text-white px-4 py-2.5 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <Eye className="w-4 h-4 flex-shrink-0" />
          <span className="text-sm truncate">
            Previewing the parent portal{name ? ` for ${name}` : ''} — <span className="font-semibold">read-only</span>
          </span>
        </div>
        <button onClick={exit} className="flex items-center gap-1 text-sm font-medium bg-white/15 hover:bg-white/25 rounded-md px-2.5 py-1">
          <X className="w-4 h-4" /> Exit preview
        </button>
      </div>

      {/* Tab bar */}
      <div className="bg-white border-b border-gray-200 overflow-x-auto">
        <div className="flex gap-1 px-2 py-1.5 min-w-max">
          {visible.map((t) => {
            const Icon = t.icon;
            const on = current?.key === t.key;
            return (
              <button
                key={t.key}
                onClick={() => setActive(t.key)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium whitespace-nowrap transition-colors ${
                  on ? 'bg-indigo-50 text-indigo-700' : 'text-gray-600 hover:bg-gray-50'
                }`}
              >
                <Icon className="w-4 h-4" /> {t.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* The actual portal page, read-only (writes 405 on the preview mount) */}
      <div className="flex-1 p-4 lg:p-6 max-w-5xl w-full mx-auto">
        {!loaded ? (
          <Loader text="Loading preview..." />
        ) : Comp ? (
          <Suspense fallback={<Loader text="Loading..." />}>
            <Comp key={`${studentId}:${current.key}`} />
          </Suspense>
        ) : (
          <p className="text-sm text-gray-500">Nothing is visible to this parent with the current settings.</p>
        )}
      </div>
    </div>
  );
}
