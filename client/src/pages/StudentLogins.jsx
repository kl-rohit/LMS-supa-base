// Admin page: manage parent/student login accounts.
// Each row = one student. Shows whether they have a login yet, and provides
// actions to create one (sends invite email) or send a WhatsApp follow-up
// with the portal URL.

import { useEffect, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
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
  KeyRound,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { PageTitle } from '../components/ConsoleUI';
import api from '../utils/api';
import Loader from '../components/Loader';
import Modal from '../components/Modal';
import CredentialShare from '../components/CredentialShare';
import ConfirmDialog from '../components/ConfirmDialog';
import Pagination, { usePagination } from '../components/Pagination';
import Tooltip from '../components/Tooltip';
import { normalizeMobileForWhatsApp } from '../utils/phone';
import { maskEmail } from '../utils/mask';
import { useRevealTimer } from '../hooks/useRevealTimer';
import { useOrgBranding } from '../hooks/useOrgBranding';
import FieldError from '../components/FieldError';
import { V, validate, firstErrorField, focusField, fieldCls, clearError } from '../utils/validation';

const BASE = (process.env.PUBLIC_URL || '/').replace(/\/$/, '');
const LOGIN_URL = `${window.location.origin}${BASE}/login`;

// Build the sign-in message shared with the parent. Includes the temporary
// password when we have it (just after creating the login); otherwise tells
// them to use their existing password.
function credentialsMessage({ parentName, studentName, email, password, academyName, reset }) {
  const academy = academyName || 'our academy';
  const lines = [
    `Hi ${parentName || ''},`.trim(),
    ``,
    reset
      ? `Your ${academy} parent portal password has been reset.`
      : `Your ${academy} parent portal access${studentName ? ` for ${studentName}` : ''} is ready.`,
    ``,
    `Sign in here: ${LOGIN_URL}`,
    `Email: ${email}`,
  ];
  if (password) {
    lines.push(`Password: ${password}`, ``, `You will be asked to set your own password after signing in.`);
  } else {
    lines.push(``, `Use your existing password. If you forgot it, ask us to reset it.`);
  }
  if (studentName) lines.push(``, `From here you can see ${studentName}'s class history, recordings, and fees anytime.`);
  return lines.join('\n');
}

// WhatsApp deep link. Goes straight to the parent's number when we have it,
// otherwise opens WhatsApp to pick a contact — the message is prefilled either way.
function whatsappLink(mobile, opts) {
  const msg = credentialsMessage(opts);
  const phone = normalizeMobileForWhatsApp(mobile);
  return phone
    ? `https://wa.me/${phone}?text=${encodeURIComponent(msg)}`
    : `https://api.whatsapp.com/send?text=${encodeURIComponent(msg)}`;
}

export default function StudentLogins() {
  const navigate = useNavigate();
  const branding = useOrgBranding();
  const emailReveal = useRevealTimer(20000);
  const [students, setStudents] = useState([]);
  const [logins, setLogins] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [createFor, setCreateFor] = useState(null); // student object
  const [createEmail, setCreateEmail] = useState('');
  const [errors, setErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [created, setCreated] = useState(null); // { student, email, password, reused }
  // Login id whose row action (resend tour / enable-disable) is in flight, so we
  // can disable that row's buttons and prevent a double submit.
  const [busyId, setBusyId] = useState(null);
  // Login row pending a password-reset confirmation.
  const [resetTarget, setResetTarget] = useState(null);

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
    setErrors({});
  };

  const handleCreate = async () => {
    if (!createFor) return;
    const errs = validate({ email: createEmail }, {
      email: V.email({ required: true }),
    });
    if (Object.keys(errs).length) {
      setErrors(errs);
      focusField(firstErrorField(errs));
      toast.error('Please fix the highlighted fields');
      return;
    }
    setErrors({});
    setSubmitting(true);
    try {
      const resp = await api.post('/student-logins', {
        student_id: String(createFor.id),
        email: createEmail.trim(),
        first_name: createFor.parent_name || createFor.name,
      });
      const student = createFor;
      setCreateFor(null);
      await fetchAll();
      // Show the sign-in details to share (temp password is shown only once).
      setCreated({
        student,
        email: resp.email || createEmail.trim(),
        password: resp.temp_password || null,
        reused: !!resp.reused_existing,
      });
      toast.success(resp.reused_existing ? 'Linked to their existing account' : 'Login created');
    } catch (e) {
      toast.error('Failed: ' + e.message);
    } finally {
      setSubmitting(false);
    }
  };

  // Admin resets a parent's password to a fresh temp one. The backend re-flags
  // must_set_password, so the parent is forced to set their own on next sign-in.
  // We surface the new password in the same share modal used for new logins.
  const doResetPassword = async () => {
    const login = resetTarget;
    setResetTarget(null);
    if (!login || busyId) return;
    setBusyId(login.id);
    try {
      const resp = await api.post(`/student-logins/${login.id}/reset-password`);
      setCreated({
        student: { name: resp.student_name, parent_name: resp.parent_name, mobile_number: resp.mobile_number },
        email: resp.email,
        password: resp.temp_password || null,
        reused: false,
        reset: true,
      });
      toast.success('Password reset');
    } catch (e) {
      toast.error('Failed: ' + e.message);
    } finally {
      setBusyId(null);
    }
  };

  const resendTour = async (login) => {
    if (busyId) return;
    setBusyId(login.id);
    try {
      await api.post(`/student-logins/${login.id}/resend-tour`);
      toast.success('Welcome tour will show again on the parent\'s next visit');
    } catch (e) {
      toast.error('Failed: ' + e.message);
    } finally {
      setBusyId(null);
    }
  };

  const toggleStatus = async (login) => {
    if (busyId) return;
    setBusyId(login.id);
    const next = login.status === 'active' ? 'disabled' : 'active';
    try {
      await api.put(`/student-logins/${login.id}`, { status: next });
      toast.success(next === 'active' ? 'Login re-enabled' : 'Login disabled');
      await fetchAll();
    } catch (e) {
      toast.error('Failed: ' + e.message);
    } finally {
      setBusyId(null);
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
        <div data-tour="logins-intro">
          <PageTitle
            live={false}
            title="Parent Logins"
            subtitle="Create a portal login for each parent so they can see their child's class history and fees."
          />
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
        <div className="overflow-x-auto hidden lg:block">
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
                                disabled={busyId === login.id}
                                className="p-1.5 rounded-md hover:bg-indigo-50 text-indigo-600 disabled:opacity-40 disabled:cursor-not-allowed"
                              >
                                <Compass className="w-4 h-4" />
                              </button>
                            </Tooltip>
                            <Tooltip label="Reset password &amp; share the new one">
                              <button
                                onClick={() => setResetTarget(login)}
                                disabled={busyId === login.id}
                                className="p-1.5 rounded-md hover:bg-indigo-50 text-gray-500 hover:text-indigo-600 disabled:opacity-40 disabled:cursor-not-allowed"
                              >
                                <KeyRound className="w-4 h-4" />
                              </button>
                            </Tooltip>
                            <Tooltip label={login.status === 'active' ? 'Disable login' : 'Enable login'}>
                              <button
                                onClick={() => toggleStatus(login)}
                                disabled={busyId === login.id}
                                className="p-1.5 rounded-md hover:bg-amber-50 text-amber-600 disabled:opacity-40 disabled:cursor-not-allowed"
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
                  <td colSpan={5} className="py-8 text-center">
                    {students.length === 0 ? (
                      <div>
                        <p className="text-sm text-gray-500 mb-3">You have not added any students yet. Add a student first, then create their portal login here.</p>
                        <button onClick={() => navigate('/students')} className="btn-primary btn-sm mx-auto">
                          Add a student
                        </button>
                      </div>
                    ) : (
                      <span className="text-sm text-gray-400">No students match the search.</span>
                    )}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Mobile cards */}
        <div className="lg:hidden divide-y divide-gray-100">
          {pageRows.map(({ student, login }) => {
            const waLink = login
              ? whatsappLink(student.mobile_number, { parentName: student.parent_name, studentName: student.name, email: login.email, academyName: branding.name })
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
                        disabled={busyId === login.id}
                        className="btn-secondary btn-sm text-indigo-600 disabled:opacity-40"
                        title="Re-send the welcome tour for this parent"
                      >
                        <Compass className="w-4 h-4" /> Tour
                      </button>
                      <button
                        onClick={() => setResetTarget(login)}
                        disabled={busyId === login.id}
                        className="btn-secondary btn-sm text-indigo-600 disabled:opacity-40"
                        title="Reset password and share the new one"
                      >
                        <KeyRound className="w-4 h-4" /> Reset
                      </button>
                      <button
                        onClick={() => toggleStatus(login)}
                        disabled={busyId === login.id}
                        className="btn-secondary btn-sm text-amber-600 disabled:opacity-40"
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
            students.length === 0 ? (
              <div className="py-8 text-center">
                <p className="text-sm text-gray-500 mb-3">You have not added any students yet. Add a student first, then create their portal login here.</p>
                <button onClick={() => navigate('/students')} className="btn-primary btn-sm mx-auto">
                  Add a student
                </button>
              </div>
            ) : (
              <div className="py-8 text-center text-sm text-gray-400">No students match the search.</div>
            )
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
        onClose={() => { setCreateFor(null); setErrors({}); }}
        title={`Create login for ${createFor?.name || ''}`}
        size="md"
        onSave={handleCreate}
        saving={submitting}
        saveLabel="Create login"
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
                data-field="email"
                value={createEmail}
                onChange={(e) => { setCreateEmail(e.target.value); setErrors((x) => clearError(x, 'email')); }}
                placeholder="parent@example.com"
                className={fieldCls('input-field', errors.email)}
                autoFocus
              />
              <FieldError msg={errors.email} />
              <p className="text-xs text-gray-500 mt-1">
                We'll create the login and show you a password to share with the parent (a "Send on WhatsApp" button makes it one tap).
              </p>
            </div>
          </div>
        )}
      </Modal>

      {/* Sign-in details to share — shown once, right after creating a login */}
      <Modal
        isOpen={!!created}
        onClose={() => setCreated(null)}
        title={created?.reset ? 'Password reset' : created?.reused ? 'Login linked' : 'Share these sign-in details'}
        size="md"
      >
        {created && (
          <div className="space-y-4">
            <p className="text-sm text-gray-600">
              {created.reset
                ? `New password for ${created.student?.name || 'this student'}. Share it with the parent — they will be asked to set their own on next sign-in. Shown only once.`
                : created.reused
                ? `${created.student?.parent_name || 'This parent'} already had an account — it is now linked to ${created.student?.name || 'this student'}.`
                : `Login created for ${created.student?.name || ''}. Share the details below with the parent — the password is shown only once.`}
            </p>
            <CredentialShare
              email={created.email}
              password={created.password}
              waLink={whatsappLink(created.student?.mobile_number, {
                parentName: created.student?.parent_name,
                studentName: created.student?.name,
                email: created.email,
                password: created.password,
                academyName: branding.name,
                reset: created.reset,
              })}
              copyText={credentialsMessage({
                parentName: created.student?.parent_name,
                studentName: created.student?.name,
                email: created.email,
                password: created.password,
                academyName: branding.name,
                reset: created.reset,
              })}
              note={created.password ? 'Save or share the password now — it is shown only once.' : null}
            />
            <div className="flex justify-end pt-2 border-t border-gray-100">
              <button onClick={() => setCreated(null)} className="btn-secondary btn-sm">Done</button>
            </div>
          </div>
        )}
      </Modal>

      <ConfirmDialog
        isOpen={!!confirmDeleteId}
        onClose={() => setConfirmDeleteId(null)}
        onConfirm={handleDelete}
        title="Delete this login?"
        message="The parent will lose portal access and their login will be disabled. You can recreate the login later if needed."
        confirmText="Delete"
        danger
      />

      <ConfirmDialog
        isOpen={!!resetTarget}
        onClose={() => setResetTarget(null)}
        onConfirm={doResetPassword}
        title="Reset this parent's password?"
        message={`This sets a new temporary password for ${resetTarget?.student_name || 'this parent'} and signs out their current one. You'll get the new password to share, and they will be asked to set their own on next sign-in.`}
        confirmText="Reset password"
      />
    </div>
  );
}
