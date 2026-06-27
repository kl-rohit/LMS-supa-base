// Slide-in detail panel for the Students page.
// Layout philosophy:
//   - Sticky top toolbar with all actions (close + Edit + WhatsApp + ⋮ menu)
//   - Body shows ONLY fields that have a value (sections collapse when empty)
//   - 2-column grid for sections on wider panels to avoid scroll for the
//     common "mostly empty" student
//   - Photo is prominent at the top
//
// Props:
//   student      — the row to display (or null to close)
//   onClose      — () => void
//   onEdit       — opens the existing edit modal
//   onDelete     — deactivate / hard-delete
//   onReactivate — flips status back to active
//   formatMobile — formatter for the masked phone (kept consistent with the list)
//   phoneRevealed — bool, whether the bank-style reveal is currently on

import { useEffect, useRef, useState } from 'react';
import {
  X,
  Phone,
  Mail,
  MapPin,
  Cake,
  Users as UsersIcon,
  IndianRupee,
  CalendarClock,
  Edit2,
  Trash2,
  RotateCcw,
  Send,
  MoreHorizontal,
  GraduationCap,
  ChevronDown,
  Plus,
  Loader2,
} from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../utils/api';
import { normalizeMobileForWhatsApp } from '../utils/phone';

export default function StudentDetailPanel({
  student,
  onClose,
  onEdit,
  onDelete,
  onReactivate,
  formatMobile,
  phoneRevealed,
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);
  // Swipe-down-to-dismiss (mobile). Tracked on the top toolbar / grab handle so
  // it never fights with scrolling inside the body. A mostly-vertical downward
  // drag past the threshold closes the panel.
  const touchStart = useRef(null);
  const onTouchStart = (e) => {
    const t = e.touches[0];
    touchStart.current = { x: t.clientX, y: t.clientY };
  };
  const onTouchEnd = (e) => {
    if (!touchStart.current) return;
    const t = e.changedTouches[0];
    const dy = t.clientY - touchStart.current.y;
    const dx = t.clientX - touchStart.current.x;
    touchStart.current = null;
    if (dy > 70 && Math.abs(dy) > Math.abs(dx)) onClose();
  };

  // Esc → close
  useEffect(() => {
    if (!student) return;
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [student, onClose]);

  // Close menu on outside click
  useEffect(() => {
    if (!menuOpen) return;
    const onClick = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false);
    };
    window.addEventListener('mousedown', onClick);
    return () => window.removeEventListener('mousedown', onClick);
  }, [menuOpen]);

  // Reset state on student change
  useEffect(() => { setMenuOpen(false); }, [student?.id]);

  if (!student) return null;

  const whatsappNum = normalizeMobileForWhatsApp(student.mobile_number);
  const waHref = whatsappNum
    ? `https://wa.me/${whatsappNum}?text=${encodeURIComponent(
        `Dear ${student.parent_name || student.father_name || 'Parent'}, `
      )}`
    : null;

  // Display helpers
  const dob = student.date_of_birth ? String(student.date_of_birth).slice(0, 10) : '';
  const dobPretty = dob
    ? new Date(dob + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })
    : null;
  const ageNow = dob ? Math.floor((Date.now() - new Date(dob).getTime()) / (1000 * 60 * 60 * 24 * 365.25)) : null;

  // Build sections — only include rows with actual values so empty profiles
  // collapse cleanly instead of showing a wall of "—".
  const contactRows = compact([
    student.mobile_number && {
      icon: Phone, label: 'Mobile',
      value: phoneRevealed ? formatMobile(student.mobile_number) : maskMobile(student.mobile_number),
      mono: true,
    },
    student.email && { icon: Mail, label: 'Email', value: student.email },
    student.address && { icon: MapPin, label: 'Address', value: student.address, multiline: true },
  ]);

  const parentRows = compact([
    student.parent_name && { icon: UsersIcon, label: 'Parent', value: student.parent_name },
    student.father_name && { icon: UsersIcon, label: 'Father', value: student.father_name },
    student.mother_name && { icon: UsersIcon, label: 'Mother', value: student.mother_name },
  ]);

  const personalRows = compact([
    dobPretty && { icon: Cake, label: 'Date of birth', value: dobPretty },
  ]);

  const feeRows = compact([
    student.fee_online        && { icon: IndianRupee, label: 'Online ₹/hr',  value: `₹${student.fee_online}` },
    student.fee_offline       && { icon: IndianRupee, label: 'Offline ₹/hr', value: `₹${student.fee_offline}` },
    student.fee_offline_group && { icon: IndianRupee, label: 'Group ₹/hr',   value: `₹${student.fee_offline_group}` },
    Number(student.min_classes_per_month) > 0 && {
      icon: CalendarClock, label: 'Min classes / month',
      value: student.min_classes_per_month,
    },
  ]);

  return (
    <>
      {/* Backdrop (visible only on smaller screens) */}
      <div
        className="fixed inset-0 bg-black/30 z-40 lg:bg-transparent lg:pointer-events-none"
        onClick={onClose}
      />

      <aside
        className="fixed top-0 right-0 h-full w-full sm:w-[28rem] lg:w-[30rem] bg-white border-l border-gray-200 shadow-xl z-50 flex flex-col"
        role="dialog"
        aria-label="Student details"
      >
        {/* Top toolbar — sticky. Identity + actions live here so the user
            never has to scroll for Edit/WhatsApp. Swiping down anywhere on this
            toolbar dismisses the panel on touch devices (the body scrolls, so
            the gesture lives up here where it won't conflict). The gradient
            color-stops aren't theme-remapped by index.css, so add explicit dark
            stops — otherwise the bar stays light in dark mode and the gray
            action icons become invisible against it. */}
        <div
          className="border-b border-gray-200 bg-gradient-to-b from-indigo-50/60 to-white dark:from-[#2b2f36] dark:to-[#2b2f36]"
          onTouchStart={onTouchStart}
          onTouchEnd={onTouchEnd}
        >
          {/* Grab handle — mobile affordance hinting swipe-down-to-close */}
          <div className="flex justify-center pt-2 lg:hidden">
            <div className="h-1 w-10 rounded-full bg-gray-300" />
          </div>
          {/* Action bar */}
          <div className="flex items-center justify-between px-4 pt-3">
            <button
              onClick={onClose}
              className="p-1.5 rounded-md hover:bg-gray-200/60 transition-colors text-gray-500"
              title="Close (Esc)"
            >
              <X className="w-5 h-5" />
            </button>
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => onEdit(student)}
                className="btn-primary btn-sm"
              >
                <Edit2 className="w-3.5 h-3.5" /> Edit
              </button>
              {waHref && (
                <a
                  href={waHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn-sm rounded-lg bg-green-600 hover:bg-green-700 text-white flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium"
                  title="WhatsApp parent"
                >
                  <Send className="w-3.5 h-3.5" /> WhatsApp
                </a>
              )}
              <div className="relative" ref={menuRef}>
                <button
                  onClick={() => setMenuOpen((v) => !v)}
                  className="p-1.5 rounded-md hover:bg-gray-200/60 transition-colors text-gray-500"
                  title="More actions"
                >
                  <MoreHorizontal className="w-5 h-5" />
                </button>
                {menuOpen && (
                  <div className="absolute right-0 top-full mt-1 w-48 bg-white border border-gray-200 rounded-lg shadow-lg z-10 py-1">
                    {student.status === 'inactive' ? (
                      <button
                        onClick={() => { setMenuOpen(false); onReactivate(student); }}
                        className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
                      >
                        <RotateCcw className="w-4 h-4 text-green-600" /> Reactivate
                      </button>
                    ) : (
                      <button
                        onClick={() => { setMenuOpen(false); onDelete(student); }}
                        className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-600 hover:bg-red-50"
                      >
                        <Trash2 className="w-4 h-4" /> Deactivate
                      </button>
                    )}
                    {student.status === 'inactive' && (
                      <button
                        onClick={() => { setMenuOpen(false); onDelete(student); }}
                        className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-600 hover:bg-red-50 border-t border-gray-100"
                      >
                        <Trash2 className="w-4 h-4" /> Delete permanently
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Identity row */}
          <div className="flex items-center gap-3 px-4 pt-3 pb-4">
            {student.photo_url ? (
              <img
                src={student.photo_url}
                alt=""
                className="w-16 h-16 rounded-full object-cover border-2 border-white shadow-sm flex-shrink-0"
                onError={(e) => { e.currentTarget.style.display = 'none'; }}
              />
            ) : (
              <div className="w-16 h-16 rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center text-2xl font-semibold flex-shrink-0">
                {(student.name || '?').slice(0, 1).toUpperCase()}
              </div>
            )}
            <div className="min-w-0 flex-1">
              <h2 className="text-xl font-semibold text-gray-900 truncate">{student.name}</h2>
              <div className="flex items-center gap-2 mt-1 flex-wrap">
                <span className={student.status === 'active' ? 'badge-active' : 'badge-inactive'}>
                  {student.status || 'active'}
                </span>
                {ageNow !== null && (
                  <span className="text-xs text-gray-500">{ageNow} y/o</span>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Body — scrollable, dense */}
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-5">
          {/* Quick-fill prompt if EVERYTHING is empty — gentle nudge to parent */}
          {contactRows.length === 0 && parentRows.length === 0 && personalRows.length === 0 && feeRows.length === 0 && (
            <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-3 text-sm text-amber-800">
              <p className="font-medium">No profile details yet</p>
              <p className="text-amber-700 mt-0.5">
                Share the parent portal link so they can fill in mobile, address,
                father/mother name, DOB, and photo.
              </p>
            </div>
          )}

          {contactRows.length > 0 && <Section title="Contact" rows={contactRows} />}
          {parentRows.length > 0 && <Section title="Parent" rows={parentRows} />}
          {personalRows.length > 0 && <Section title="Personal" rows={personalRows} />}
          {feeRows.length > 0 && <Section title="Fees" rows={feeRows} />}

          {/* One-click course enrollment. Courses load lazily on first open, so
              this adds no reads unless the admin actually uses it. */}
          <EnrollSection key={student.id} studentId={student.id} studentName={student.name} />

          {student.notes && (
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-2">Notes</h3>
              <p className="text-sm text-gray-700 whitespace-pre-line bg-gray-50 border border-gray-100 rounded-lg p-3">
                {student.notes}
              </p>
            </div>
          )}
        </div>
      </aside>
    </>
  );
}

// One-click enrollment from the student panel. Courses are fetched LAZILY on
// first expand (one /courses read, not on every panel open), and the enroll
// POST dedupes server-side, so re-picking a course the student already has is a
// no-op. Mounted with key={studentId} so state resets per student.
function EnrollSection({ studentId, studentName }) {
  const [open, setOpen] = useState(false);
  const [courses, setCourses] = useState(null); // null = not loaded yet
  const [loading, setLoading] = useState(false);
  const [enrolling, setEnrolling] = useState(null);

  const loadCourses = async () => {
    if (courses !== null || loading) return;
    setLoading(true);
    try {
      const r = await api.get('/courses');
      setCourses(r.courses || []);
    } catch {
      setCourses([]);
      toast.error('Could not load courses');
    } finally {
      setLoading(false);
    }
  };

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next) loadCourses();
  };

  const enroll = async (course) => {
    setEnrolling(course.id);
    try {
      const r = await api.post('/enrollments', { course_id: course.id, student_id: studentId });
      if (r.count > 0) toast.success(`Enrolled in ${course.name}`);
      else toast(`${studentName || 'Student'} is already in ${course.name}`);
      setOpen(false);
    } catch (e) {
      toast.error(e.message || 'Failed to enroll');
    } finally {
      setEnrolling(null);
    }
  };

  return (
    <div>
      <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-2">Courses</h3>
      <button
        type="button"
        onClick={toggle}
        className="w-full flex items-center justify-between gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
      >
        <span className="flex items-center gap-2">
          <GraduationCap className="w-4 h-4 text-indigo-600" /> Enroll in a course
        </span>
        <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="mt-2 rounded-lg border border-gray-200 divide-y divide-gray-100 overflow-hidden">
          {loading ? (
            <div className="px-3 py-3 text-sm text-gray-500 flex items-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading courses…
            </div>
          ) : courses && courses.length > 0 ? (
            courses.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => enroll(c)}
                disabled={enrolling === c.id}
                className="w-full flex items-center justify-between gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-indigo-50 disabled:opacity-50"
              >
                <span className="truncate">{c.name}</span>
                {enrolling === c.id
                  ? <Loader2 className="w-4 h-4 animate-spin text-indigo-600 flex-shrink-0" />
                  : <Plus className="w-4 h-4 text-indigo-600 flex-shrink-0" />}
              </button>
            ))
          ) : (
            <div className="px-3 py-3 text-sm text-gray-500">No courses to enroll in yet.</div>
          )}
        </div>
      )}
    </div>
  );
}

function compact(arr) { return arr.filter(Boolean); }

function Section({ title, rows }) {
  return (
    <div>
      <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-2">{title}</h3>
      <div className="space-y-2.5">
        {rows.map((r, i) => <Row key={i} {...r} />)}
      </div>
    </div>
  );
}

function Row({ icon: Icon, label, value, mono = false, multiline = false }) {
  return (
    <div className="flex items-start gap-2.5 text-sm">
      <Icon className="w-4 h-4 text-gray-400 mt-0.5 flex-shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="text-[11px] text-gray-400 uppercase tracking-wide">{label}</div>
        <div className={`text-gray-800 mt-0.5 ${mono ? 'font-mono' : ''} ${multiline ? 'whitespace-pre-line' : 'truncate'}`}>
          {value}
        </div>
      </div>
    </div>
  );
}

// Reuse the same masking pattern as the list — last 4 digits visible.
function maskMobile(raw) {
  const s = String(raw || '');
  if (s.length <= 4) return s;
  return '•••• •••• ' + s.slice(-4);
}
