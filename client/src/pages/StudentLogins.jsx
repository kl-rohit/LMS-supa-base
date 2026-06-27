// Admin page: manage parent/student login accounts.
// Each row = one student. Shows whether they have a login yet, and provides
// actions to create one (sends invite email) or send a WhatsApp follow-up
// with the portal URL.

import { useEffect, useState, useMemo } from 'react';
import {
  KeyRound,
  Mail,
  MessageSquare,
  Check,
  X,
  Trash2,
  Search,
  Power,
  Loader2,
  Eye,
  EyeOff,
  Compass,
} from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../utils/api';
import Loader from '../components/Loader';
import Modal from '../components/Modal';
import ConfirmDialog from '../components/ConfirmDialog';
import Pagination, { usePagination } from '../components/Pagination';
import Tooltip from '../components/Tooltip';
import { normalizeMobileForWhatsApp } from '../utils/phone';
import { maskEmail } from '../utils/mask';
import { useRevealTimer } from '../hooks/useRevealTimer';
import { useOrgBranding } from '../hooks/useOrgBranding';

const PORTAL_URL = `${window.location.origin}/app/portal`;

function whatsappLink(mobile, parentName, studentName, email, academyName) {
  const phone = normalizeMobileForWhatsApp(mobile);
  if (!phone) return null;
  const academy = academyName || 'our academy';
  const msg = [
    `Hi ${parentName || ''},`,
    ``,
    `Your ${academy} parent portal access for ${studentName} is ready!`,
    ``,
    `Step 1: Check your email (${email}) for the activation link from Zoho — click it and set your password.`,
    `Step 2: Log in here: ${PORTAL_URL}`,
    ``,
    `From here you can see ${studentName}'s class history, recordings, and fees anytime.`,
  ].join('\n');
  return `https://wa.me/${phone}?text=${encodeURIComponent(msg)}`;
}

export default function StudentLogins() {
  const branding = useOrgBranding();
  const emailReveal = useRevealTimer(20000);
  const [students, setStudents] = useState([]);
  const [logins, setLogins] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [createFor, setCreateFor] = useState(null); // student object
  const [createEmail, setCreateEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);

  const fetchAll = async () => {
    setLoading(true);
    try {
      const [s, l] = await Promise.all([
        api.get('/students'),
        api.get('/student-logins'),
      ]);
      setStudents((s.students || []).filter((st) => st.status === 'active'));
      setLogins(l.logins || []);
    } catch (e) {
      toast.error('Failed to load: ' + e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchAll(); }, []);

  // Map student_id → login row for quick lookup
  const loginByStudent = useMemo(() => {
    const m = new Map();
    logins.forEach((l) => m.set(String(l.student_id), l));
    return m;
  }, [logins]);

  const rows = useMemo(() => {
    let list = students.map((s) => ({
      student: s,
      login: loginByStudent.get(String(s.id)) || null,
    }));
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        ({ student, login }) =>
          student.name?.toLowerCase().includes(q) ||
          student.parent_name?.toLowerCase().includes(q) ||
          login?.email?.toLowerCase().includes(q)
      );
    }
    list.sort((a, b) => String(a.student.name || '').localeCompare(String(b.student.name || '')));
    return list;
  }, [students, loginByStudent, search]);

  const { page, setPage, pageCount, pageItems: pageRows, total, from, to } = usePagination(rows, 25);

  const openCreate = (student) => {
    setCreateFor(student);
    setCreateEmail('');
  };

  const handleCreate = async () => {
    if (!createFor || !createEmail.trim()) {
      toast.error('Email is required');
      return;
    }
    setSubmitting(true);
    try {
      await api.post('/student-logins', {
        student_id: String(createFor.id),
        email: createEmail.trim(),
        first_name: createFor.parent_name || createFor.name,
      });
      toast.success('Login created — invitation email sent');
      setCreateFor(null);
      await fetchAll();
    } catch (e) {
      toast.error('Failed: ' + e.message);
    } finally {
      setSubmitting(false);
    }
  };

  const resendTour = async (login) => {
    try {
      await api.post(`/student-logins/${login.id}/resend-tour`);
      toast.success('Welcome tour will show again on the parent\'s next visit');
    } catch (e) {
      toast.error('Failed: ' + e.message);
    }
  };

  const toggleStatus = async (login) => {
    const next = login.status === 'active' ? 'disabled' : 'active';
    try {
      await api.put(`/student-logins/${login.id}`, { status: next });
      toast.success(next === 'active' ? 'Login re-enabled' : 'Login disabled');
      await fetchAll();
    } catch (e) {
      toast.error('Failed: ' + e.message);
    }
  };

  const handleDelete = async () => {
    if (!confirmDeleteId) return;
    try {
      await api.delete(`/student-logins/${confirmDeleteId}`);
      toast.success('Login removed');
      setConfirmDeleteId(null);
      await fetchAll();
    } catch (e) {
      toast.error('Failed: ' + e.message);
    }
  };

  if (loading) return <Loader text="Loading logins..." />;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 data-tour="logins-intro" className="text-xl font-semibold text-gray-900 flex items-center gap-2">
            <KeyRound className="w-5 h-5 text-indigo-600" />
            Parent Logins
          </h2>
          <p className="text-sm text-gray-500 mt-1">
            Create a portal login for each parent. They'll get an email to set their password, then can see their child's class history and fees.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={emailReveal.toggle}
            className="btn-secondary btn-sm"
            title={emailReveal.revealed ? 'Hide emails (auto-hides in 20s)' : 'Show emails (auto-hides 20s later)'}
          >
            {emailReveal.revealed ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            {emailReveal.revealed ? 'Hide' : 'Show'} emails
          </button>
          <div className="relative">
            <Search className="w-4 h-4 text-gray-400 absolute left-2 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name or email..."
              className="input-field text-sm pl-8 w-64"
            />
          </div>
        </div>
      </div>

      <div className="card overflow-hidden">
        <div className="overflow-x-auto hidden md:block">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="table-header">Student</th>
                <th className="table-header">Parent</th>
                <th className="table-header">Login email</th>
                <th className="table-header text-center">Status</th>
                <th className="table-header text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {pageRows.map(({ student, login }) => {
                const waLink = login
                  ? whatsappLink(student.mobile_number, student.parent_name, student.name, login.email, branding.name)
                  : null;
                return (
                  <tr key={student.id}>
                    <td className="table-cell font-medium text-gray-900">{student.name}</td>
                    <td className="table-cell text-gray-600">{student.parent_name || '—'}</td>
                    <td className="table-cell text-gray-700">
                      {login
                        ? (emailReveal.revealed ? login.email : maskEmail(login.email))
                        : <span className="text-gray-400">No login yet</span>}
                    </td>
                    <td className="table-cell text-center">
                      {!login ? (
                        <span className="text-xs text-gray-400">—</span>
                      ) : login.status === 'active' ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-green-100 text-green-700 text-xs font-medium">
                          <Check className="w-3 h-3" /> Active
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 text-xs font-medium">
                          <X className="w-3 h-3" /> Disabled
                        </span>
                      )}
                    </td>
                    <td className="table-cell text-right">
                      <div className="inline-flex items-center gap-1">
                        {!login ? (
                          <button
                            onClick={() => openCreate(student)}
                            className="btn-primary btn-sm"
                            title="Create login"
                          >
                            <Mail className="w-4 h-4" /> Create login
                          </button>
                        ) : (
                          <>
                            {waLink && (
                              <Tooltip label="Send portal link via WhatsApp">
                                <a
                                  href={waLink}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="p-1.5 rounded-md hover:bg-green-50 text-green-600"
                                >
                                  <MessageSquare className="w-4 h-4" />
                                </a>
                              </Tooltip>
                            )}
                            <Tooltip label="Re-send the welcome tour for this parent">
                              <button
                                onClick={() => resendTour(login)}
                                className="p-1.5 rounded-md hover:bg-indigo-50 text-indigo-600"
                              >
                                <Compass className="w-4 h-4" />
                              </button>
                            </Tooltip>
                            <Tooltip label={login.status === 'active' ? 'Disable login' : 'Enable login'}>
                              <button
                                onClick={() => toggleStatus(login)}
                                className="p-1.5 rounded-md hover:bg-amber-50 text-amber-600"
                              >
                                <Power className="w-4 h-4" />
                              </button>
                            </Tooltip>
                            <Tooltip label="Delete login">
                              <button
                                onClick={() => setConfirmDeleteId(login.id)}
                                className="p-1.5 rounded-md hover:bg-red-50 text-red-600"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </Tooltip>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-8 text-center text-sm text-gray-400">
                    No students match the search.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Mobile cards */}
        <div className="md:hidden divide-y divide-gray-100">
          {pageRows.map(({ student, login }) => {
            const waLink = login
              ? whatsappLink(student.mobile_number, student.parent_name, student.name, login.email, branding.name)
              : null;
            return (
              <div key={student.id} className="p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-medium text-gray-900 truncate">{student.name}</div>
                    <div className="text-xs text-gray-500">{student.parent_name || '—'}</div>
                  </div>
                  {!login ? (
                    <span className="text-xs text-gray-400 shrink-0">No login</span>
                  ) : login.status === 'active' ? (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-green-100 text-green-700 text-xs font-medium shrink-0">
                      <Check className="w-3 h-3" /> Active
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 text-xs font-medium shrink-0">
                      <X className="w-3 h-3" /> Disabled
                    </span>
                  )}
                </div>
                <div className="mt-1.5 text-sm text-gray-700 break-all">
                  {login
                    ? (emailReveal.revealed ? login.email : maskEmail(login.email))
                    : <span className="text-gray-400">No login yet</span>}
                </div>
                <div className="mt-3 flex items-center gap-2">
                  {!login ? (
                    <button
                      onClick={() => openCreate(student)}
                      className="btn-primary btn-sm"
                      title="Create login"
                    >
                      <Mail className="w-4 h-4" /> Create login
                    </button>
                  ) : (
                    <>
                      {waLink && (
                        <a
                          href={waLink}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="btn-secondary btn-sm text-green-600"
                          title="Send portal link via WhatsApp"
                        >
                          <MessageSquare className="w-4 h-4" /> WhatsApp
                        </a>
                      )}
                      <button
                        onClick={() => resendTour(login)}
                        className="btn-secondary btn-sm text-indigo-600"
                        title="Re-send the welcome tour for this parent"
                      >
                        <Compass className="w-4 h-4" /> Tour
                      </button>
                      <button
                        onClick={() => toggleStatus(login)}
                        className="btn-secondary btn-sm text-amber-600"
                        title={login.status === 'active' ? 'Disable login' : 'Enable login'}
                      >
                        <Power className="w-4 h-4" /> {login.status === 'active' ? 'Disable' : 'Enable'}
                      </button>
                      <button
                        onClick={() => setConfirmDeleteId(login.id)}
                        className="btn-secondary btn-sm text-red-600"
                        title="Delete login"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
          {rows.length === 0 && (
            <div className="py-8 text-center text-sm text-gray-400">No students match the search.</div>
          )}
        </div>

        {rows.length > 0 && (
          <Pagination
            page={page}
            pageCount={pageCount}
            setPage={setPage}
            from={from}
            to={to}
            total={total}
            label="students"
          />
        )}
      </div>

      {/* Create login modal */}
      <Modal
        isOpen={!!createFor}
        onClose={() => setCreateFor(null)}
        title={`Create login for ${createFor?.name || ''}`}
        size="md"
        onSave={handleCreate}
        saving={submitting}
        saveLabel="Create & send invite"
      >
        {createFor && (
          <div className="space-y-4">
            <div className="bg-gray-50 rounded-lg px-3 py-2 text-sm text-gray-600">
              <div>Parent: <span className="font-medium text-gray-700">{createFor.parent_name || '—'}</span></div>
              <div>Mobile: <span className="font-medium text-gray-700">{createFor.mobile_number || '—'}</span></div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Parent email *</label>
              <input
                type="email"
                value={createEmail}
                onChange={(e) => setCreateEmail(e.target.value)}
                placeholder="parent@example.com"
                className="input-field"
                autoFocus
              />
              <p className="text-xs text-gray-500 mt-1">
                Zoho will send an activation email here. The parent clicks the link, sets their own password, then can log in.
              </p>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-gray-100">
              <button onClick={() => setCreateFor(null)} className="btn-secondary btn-sm" disabled={submitting}>
                Cancel
              </button>
              <button onClick={handleCreate} className="btn-primary btn-sm" disabled={submitting}>
                {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
                {submitting ? 'Creating...' : 'Create & send invite'}
              </button>
            </div>
          </div>
        )}
      </Modal>

      <ConfirmDialog
        isOpen={!!confirmDeleteId}
        onClose={() => setConfirmDeleteId(null)}
        onConfirm={handleDelete}
        title="Delete this login?"
        message="The parent will lose portal access. Their Catalyst account will be disabled. You can recreate the login later if needed."
        confirmText="Delete"
        danger
      />
    </div>
  );
}
