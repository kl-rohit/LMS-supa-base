// Slide-in detail panel for the Students page. Renders all info for the
// currently-selected student in a right-side drawer (mobile: full-screen).
//
// Props:
//   student      — the row to display (or null to close)
//   onClose      — () => void
//   onEdit       — opens the existing edit modal
//   onDelete     — deactivate / hard-delete
//   onReactivate — flips status back to active
//   formatMobile — formatter for the masked phone (kept consistent with the list)
//   phoneRevealed — bool, whether the bank-style reveal is currently on
//
// Style: fixed-position overlay. Backdrop dims the list; click outside / ESC
// dismisses. On mobile (< 768px) it's a full-screen drawer.

import { useEffect } from 'react';
import {
  X,
  User,
  Phone,
  Mail,
  MapPin,
  Cake,
  Users as UsersIcon,
  IndianRupee,
  Calendar,
  ClipboardList,
  Edit2,
  Trash2,
  RotateCcw,
  Send,
  CalendarClock,
} from 'lucide-react';
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
  // Esc to close.
  useEffect(() => {
    if (!student) return;
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [student, onClose]);

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

  return (
    <>
      {/* Backdrop (visible only on smaller screens for visual cue) */}
      <div
        className="fixed inset-0 bg-black/30 z-40 lg:bg-transparent lg:pointer-events-none"
        onClick={onClose}
      />

      {/* Panel */}
      <aside
        className="fixed top-0 right-0 h-full w-full sm:w-[28rem] lg:w-[30rem] bg-white border-l border-gray-200 shadow-xl z-50 flex flex-col"
        role="dialog"
        aria-label="Student details"
      >
        {/* Header */}
        <div className="flex items-start justify-between px-5 py-4 border-b border-gray-200 bg-gradient-to-b from-indigo-50/50 to-white">
          <div className="flex items-center gap-3 min-w-0">
            {student.photo_url ? (
              <img
                src={student.photo_url}
                alt=""
                className="w-14 h-14 rounded-full object-cover border-2 border-white shadow-sm flex-shrink-0"
                onError={(e) => { e.currentTarget.style.display = 'none'; }}
              />
            ) : (
              <div className="w-14 h-14 rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center text-xl font-semibold flex-shrink-0">
                {(student.name || '?').slice(0, 1).toUpperCase()}
              </div>
            )}
            <div className="min-w-0">
              <h2 className="text-lg font-semibold text-gray-900 truncate">{student.name}</h2>
              <div className="flex items-center gap-2 mt-0.5">
                <span className={student.status === 'active' ? 'badge-active' : 'badge-inactive'}>
                  {student.status || 'active'}
                </span>
                {ageNow !== null && (
                  <span className="text-xs text-gray-500">{ageNow} y/o</span>
                )}
              </div>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-md hover:bg-gray-100 transition-colors flex-shrink-0"
            title="Close (Esc)"
          >
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        {/* Body — scrollable */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          <Section title="Contact">
            <Row icon={Phone} label="Mobile" value={
              student.mobile_number
                ? (phoneRevealed ? formatMobile(student.mobile_number) : maskMobile(student.mobile_number))
                : null
            } />
            <Row icon={Mail} label="Email" value={student.email} />
            <Row icon={MapPin} label="Address" value={student.address} multiline />
          </Section>

          <Section title="Parent">
            <Row icon={UsersIcon} label="Parent name" value={student.parent_name} />
            <Row icon={UsersIcon} label="Father" value={student.father_name} />
            <Row icon={UsersIcon} label="Mother" value={student.mother_name} />
          </Section>

          <Section title="Personal">
            <Row icon={Cake} label="Date of birth" value={dobPretty} />
          </Section>

          <Section title="Fees">
            <Row icon={IndianRupee} label="Online ₹/hr" value={student.fee_online ? `₹${student.fee_online}` : null} />
            <Row icon={IndianRupee} label="Offline ₹/hr" value={student.fee_offline ? `₹${student.fee_offline}` : null} />
            <Row icon={IndianRupee} label="Group ₹/hr" value={student.fee_offline_group ? `₹${student.fee_offline_group}` : null} />
            <Row
              icon={CalendarClock}
              label="Min classes / month"
              value={Number(student.min_classes_per_month) > 0 ? student.min_classes_per_month : null}
            />
          </Section>

          {student.notes && (
            <Section title="Notes">
              <p className="text-sm text-gray-700 whitespace-pre-line">{student.notes}</p>
            </Section>
          )}
        </div>

        {/* Footer actions */}
        <div className="px-5 py-3 border-t border-gray-200 bg-gray-50 flex flex-wrap items-center gap-2">
          <button
            onClick={() => onEdit(student)}
            className="btn-primary btn-sm"
          >
            <Edit2 className="w-4 h-4" /> Edit
          </button>
          {waHref && (
            <a
              href={waHref}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-sm rounded-lg bg-green-600 hover:bg-green-700 text-white flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium"
            >
              <Send className="w-4 h-4" /> WhatsApp
            </a>
          )}
          <div className="flex-1" />
          {student.status === 'inactive' ? (
            <button
              onClick={() => onReactivate(student)}
              className="btn-sm rounded-lg bg-green-50 text-green-700 border border-green-200 hover:bg-green-100 flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium"
            >
              <RotateCcw className="w-4 h-4" /> Reactivate
            </button>
          ) : null}
          <button
            onClick={() => onDelete(student)}
            className="btn-sm rounded-lg bg-red-50 text-red-600 border border-red-200 hover:bg-red-100 flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium"
            title={student.status === 'inactive' ? 'Delete permanently' : 'Deactivate'}
          >
            <Trash2 className="w-4 h-4" />
            {student.status === 'inactive' ? 'Delete permanently' : 'Deactivate'}
          </button>
        </div>
      </aside>
    </>
  );
}

function Section({ title, children }) {
  return (
    <div>
      <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-2">{title}</h3>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function Row({ icon: Icon, label, value, multiline = false }) {
  if (!value) {
    return (
      <div className="flex items-start gap-2 text-sm">
        <Icon className="w-4 h-4 text-gray-300 mt-0.5 flex-shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="text-xs text-gray-400">{label}</div>
          <div className="text-gray-300 italic">—</div>
        </div>
      </div>
    );
  }
  return (
    <div className="flex items-start gap-2 text-sm">
      <Icon className="w-4 h-4 text-gray-400 mt-0.5 flex-shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="text-xs text-gray-400">{label}</div>
        <div className={`text-gray-800 ${multiline ? 'whitespace-pre-line' : 'truncate'}`}>{value}</div>
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
