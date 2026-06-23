import { useState, useEffect, useMemo } from 'react';
import {
  MessageSquare,
  AlertTriangle,
  IndianRupee,
  PenLine,
  Copy,
  CopyCheck,
  CheckCircle,
  Filter,
  Send,
  RefreshCw,
  Phone,
  User,
  Trash2,
  BellRing,
} from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../utils/api';
import { useConfirm } from '../contexts/ConfirmContext';
import { normalizeMobileForWhatsApp, formatMobileDisplay } from '../utils/phone';
import Loader from '../components/Loader';
import EmptyState from '../components/EmptyState';
import Pagination, { usePagination } from '../components/Pagination';
// Templates editor lives at /settings → Templates tab. We just READ
// templates here for the compose dropdown + quick-template chips, and use
// the same DEFAULT_TEMPLATES from the shared component as the fallback.
import { DEFAULT_TEMPLATES } from '../components/TemplatesEditor';

// Substitute {placeholder} tokens with ctx[key]. Unknown placeholders stay
// literal so the teacher can fill them manually (e.g. ____ amounts in
// manually-composed fee reminders).
function substituteTemplate(text, ctx) {
  if (!text || typeof text !== 'string') return '';
  return text.replace(/\{(\w+)\}/g, (match, key) => {
    if (ctx && Object.prototype.hasOwnProperty.call(ctx, key) && ctx[key] !== undefined && ctx[key] !== null) {
      return String(ctx[key]);
    }
    return match;
  });
}

export default function Messages() {
  const confirm = useConfirm();
  const [messages, setMessages] = useState([]);
  const [students, setStudents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const [generating, setGenerating] = useState(false);
  const [copiedId, setCopiedId] = useState(null);
  const [sendingInAppId, setSendingInAppId] = useState(null);

  // Customizable templates (admin-editable in Settings → Templates).
  // We only READ them here for the compose dropdown + quick-template chips.
  const [templates, setTemplates] = useState(DEFAULT_TEMPLATES);
  // School identity from /api/settings/app — used to substitute {school}
  // + {signature} in compose so the textarea doesn't show literal tokens.
  const [schoolCtx, setSchoolCtx] = useState({ school: '', signature: '' });

  // Bulk WhatsApp send progress state
  const [bulkSending, setBulkSending] = useState(false);

  // Month/year picker for the "Generate Fee Reminders" action.
  // Defaults to current month.
  const _now = new Date();
  const [reminderMonth, setReminderMonth] = useState(_now.getMonth() + 1);
  const [reminderYear, setReminderYear] = useState(_now.getFullYear());

  // Compose form
  const [composeOpen, setComposeOpen] = useState(false);
  const [composeForm, setComposeForm] = useState({
    student_id: '',
    message_type: 'custom',
    message_text: '',
  });
  const [sending, setSending] = useState(false);

  // Resolve a template by type + substitute {name}/{parent}. Other placeholders
  // ({amount}, {month}, {year}, {count}) stay literal in the manual-compose
  // flow so the teacher can fill them in before sending. Returns '' for
  // 'custom' or unknown types.
  const getTemplate = (type, studentName, parentName) => {
    if (!type || type === 'custom') return '';
    const text = (templates && templates[type]) || DEFAULT_TEMPLATES[type] || '';
    return substituteTemplate(text, {
      name:   studentName || '[Student Name]',
      parent: parentName  || '[Parent Name]',
      // Pulled from /api/settings/app on mount. Falls back to a friendly
      // placeholder when Settings hasn't been filled in yet, instead of
      // leaving a literal {school} / {signature} in the user-visible text.
      school:    schoolCtx.school    || 'your academy',
      signature: schoolCtx.signature || schoolCtx.school || 'your academy',
      // {count}, {amount}, {month}, {year} stay literal in compose so the
      // teacher knows they still need to fill them in. Auto-generate paths
      // pass real values.
    });
  };

  // Quick template chips configuration
  const quickTemplates = [
    { key: 'absence_alert', label: 'Absence Alert' },
    { key: 'fee_reminder', label: 'Fee Reminder' },
    { key: 'class_update', label: 'Class Update' },
    { key: 'thank_you', label: 'Thank You' },
    { key: 'holiday_notice', label: 'Holiday Notice' },
  ];

  const handleTypeChange = (type) => {
    const student = students.find((s) => String(s.id) === String(composeForm.student_id));
    const template = getTemplate(type, student?.name, student?.parent_name);
    setComposeForm({
      ...composeForm,
      message_type: type,
      message_text: type !== 'custom' ? template : composeForm.message_text,
    });
  };

  const handleStudentChange = (studentId) => {
    const student = students.find((s) => String(s.id) === String(studentId));
    const template = composeForm.message_type !== 'custom'
      ? getTemplate(composeForm.message_type, student?.name, student?.parent_name)
      : composeForm.message_text;
    setComposeForm({
      ...composeForm,
      student_id: studentId,
      message_text: template,
    });
  };

  const applyQuickTemplate = (templateKey) => {
    const student = students.find((s) => String(s.id) === String(composeForm.student_id));
    const template = getTemplate(templateKey, student?.name, student?.parent_name);
    setComposeForm({
      ...composeForm,
      message_type: templateKey,
      message_text: template,
    });
  };

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      setLoading(true);
      const [messagesData, studentsData, templatesData, settingsData] = await Promise.all([
        api.get('/messages'),
        api.get('/students'),
        // Templates fetch must not break the page — fall back to defaults
        // if the Settings table doesn't exist yet or the call fails.
        api.get('/settings/templates').catch(() => ({ templates: DEFAULT_TEMPLATES })),
        // School identity for compose-time substitution of {school}/{signature}.
        api.get('/settings/app').catch(() => ({ settings: {} })),
      ]);
      setMessages(messagesData.messages || []);
      setStudents((studentsData.students || []).filter((s) => s.status === 'active'));
      const t = { ...DEFAULT_TEMPLATES, ...(templatesData?.templates || {}) };
      setTemplates(t);
      const s = settingsData?.settings || {};
      setSchoolCtx({
        school:    s['school.name']      || '',
        signature: s['school.signature'] || s['school.name'] || '',
      });
    } catch (err) {
      toast.error('Failed to load data: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  // ----- Bulk "Send All Pending" (in-app) -----
  // Delivers every pending message to its parent's in-app inbox (+ push) in
  // one go. No popups/tabs — a single API call per message, fired
  // sequentially. Only messages linked to a student can be delivered in-app.
  const pendingSendable = useMemo(() =>
    messages.filter((m) =>
      !(m.is_sent === 1 || m.is_sent === true) && m.student_id
    ), [messages]);

  const sendAllPending = async () => {
    const list = pendingSendable;
    if (list.length === 0) return;
    const ok = await confirm({
      title: `Send ${list.length} message${list.length === 1 ? '' : 's'} in-app?`,
      message:
        `This will deliver ${list.length} pending message${list.length === 1 ? '' : 's'} to each parent's in-app inbox ` +
        `and push to their device. The messages will be marked as sent.`,
      confirmText: `Send ${list.length}`,
    });
    if (!ok) return;
    try {
      setBulkSending(true);
      let sent = 0, failed = 0;
      for (const m of list) {
        try {
          await api.post(`/messages/${m.id}/send-in-app`);
          setMessages((prev) => prev.map((x) => (x.id === m.id ? { ...x, is_sent: 1 } : x)));
          sent++;
        } catch {
          failed++;
        }
      }
      if (failed === 0) {
        toast.success(`Sent ${sent} message${sent === 1 ? '' : 's'} in-app`);
      } else if (sent > 0) {
        toast(`Sent ${sent}, ${failed} failed — check those have a linked parent.`, { icon: 'ℹ️' });
      } else {
        toast.error('Could not send any messages in-app.');
      }
    } finally {
      setBulkSending(false);
    }
  };

  const generateAbsenceAlerts = async () => {
    try {
      setGenerating(true);
      const result = await api.post('/messages/generate-absence-alert');
      const count = result.created ?? result.alerts?.length ?? 0;
      if (count > 0) {
        toast.success(`Generated ${count} absence alert(s)`);
      } else {
        toast.success('No students with 2+ consecutive absences');
      }
      fetchData();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setGenerating(false);
    }
  };

  const generateFeeReminders = async () => {
    try {
      setGenerating(true);
      const result = await api.post('/messages/generate-fee-reminder', {
        year: reminderYear,
        month: reminderMonth,
      });
      const count = result.created ?? result.reminders?.length ?? 0;
      if (count > 0) {
        toast.success(`Generated ${count} fee reminder(s) for ${result.month_name || reminderMonth}/${reminderYear}`);
      } else {
        toast.success(`No pending fees for ${result.month_name || reminderMonth}/${reminderYear}`);
      }
      fetchData();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setGenerating(false);
    }
  };

  const handleCompose = async (e) => {
    e.preventDefault();
    if (!composeForm.student_id || !composeForm.message_text.trim()) {
      toast.error('Student and message are required');
      return;
    }
    // Don't let unfilled {placeholder} tokens leak into a created message.
    // {name}/{parent}/{school}/{signature} are already substituted on template
    // load; anything left ({count}, {amount}, {month}, {year}, …) is data the
    // teacher must fill in manually before the message is usable.
    const leftover = [...new Set(composeForm.message_text.match(/\{\w+\}/g) || [])];
    if (leftover.length) {
      toast.error(`Fill in or remove these placeholders first: ${leftover.join(', ')}`);
      return;
    }
    try {
      setSending(true);
      await api.post('/messages', {
        student_id: String(composeForm.student_id),
        message_type: composeForm.message_type,
        message: composeForm.message_text,
      });
      toast.success('Message created');
      setComposeOpen(false);
      setComposeForm({ student_id: '', message_type: 'custom', message_text: '' });
      fetchData();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSending(false);
    }
  };

  // Copy the raw message text directly (already formatted by backend)
  const copyMessage = async (message) => {
    const text = message.message || '';
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(message.id);
      toast.success('Copied to clipboard');
      setTimeout(() => setCopiedId(null), 2000);
    } catch {
      toast.error('Failed to copy');
    }
  };

  const copyAllMessages = async () => {
    const allText = filteredMessages
      .map((m) => m.message || '')
      .join('\n---\n\n');
    try {
      await navigator.clipboard.writeText(allText);
      toast.success(`Copied ${filteredMessages.length} messages`);
    } catch {
      toast.error('Failed to copy');
    }
  };

  // Fixed: send { is_sent: true } instead of { status: 'sent' }
  const markAsSent = async (messageId) => {
    try {
      await api.put(`/messages/${messageId}`, { is_sent: true });
      setMessages((prev) =>
        prev.map((m) => (m.id === messageId ? { ...m, is_sent: 1 } : m))
      );
      toast.success('Marked as sent');
    } catch (err) {
      toast.error(err.message);
    }
  };

  // Deliver a message to the parent's in-app notification inbox (+ push).
  const sendInApp = async (message) => {
    setSendingInAppId(message.id);
    try {
      const r = await api.post(`/messages/${message.id}/send-in-app`);
      setMessages((prev) => prev.map((m) => (m.id === message.id ? { ...m, is_sent: 1 } : m)));
      toast.success(r?.pushed > 0 ? 'Sent in-app + pushed to device' : 'Sent to in-app inbox');
    } catch (err) {
      toast.error(err.message || 'Failed to send in-app');
    } finally {
      setSendingInAppId(null);
    }
  };

  // Delete a single message
  const deleteMessage = async (messageId) => {
    const ok = await confirm({
      title: 'Delete this message?',
      message: 'This will permanently remove the message draft. This cannot be undone.',
      confirmText: 'Delete',
    });
    if (!ok) return;
    try {
      await api.delete(`/messages/${messageId}`);
      setMessages((prev) => prev.filter((m) => m.id !== messageId));
      toast.success('Message deleted');
    } catch (err) {
      toast.error(err.message);
    }
  };

  // Delete all currently filtered messages
  const deleteAllFiltered = async () => {
    const count = filteredMessages.length;
    if (count === 0) return;
    const label = filter === 'all' ? 'all' : filter.replace('_', ' ');
    const ok = await confirm({
      title: `Delete ${count} message(s)?`,
      message: `This will permanently remove all ${label} messages (${count}). This cannot be undone.`,
      confirmText: 'Delete all',
    });
    if (!ok) return;
    try {
      await Promise.all(filteredMessages.map((m) => api.delete(`/messages/${m.id}`)));
      const deletedIds = new Set(filteredMessages.map((m) => m.id));
      setMessages((prev) => prev.filter((m) => !deletedIds.has(m.id)));
      toast.success(`Deleted ${count} message(s)`);
    } catch (err) {
      toast.error('Failed to delete some messages: ' + err.message);
      fetchData();
    }
  };

  const filteredMessages = useMemo(() => {
    if (filter === 'all') return messages;
    return messages.filter((m) => m.message_type === filter);
  }, [messages, filter]);

  const { page, setPage, pageCount, pageItems: pageMessages, total, from, to } = usePagination(filteredMessages, 25);

  const messageTypeColors = {
    absence_alert: 'border-l-red-500 bg-red-50',
    fee_reminder: 'border-l-amber-500 bg-amber-50',
    class_update: 'border-l-blue-500 bg-blue-50',
    custom: 'border-l-indigo-500 bg-indigo-50',
  };

  const messageTypeIcons = {
    absence_alert: AlertTriangle,
    fee_reminder: IndianRupee,
    class_update: RefreshCw,
    custom: PenLine,
  };

  const messageTypeBadge = {
    absence_alert: 'bg-red-100 text-red-700',
    fee_reminder: 'bg-amber-100 text-amber-700',
    class_update: 'bg-blue-100 text-blue-700',
    custom: 'bg-indigo-100 text-indigo-700',
  };

  if (loading) return <Loader text="Loading messages..." />;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <h2 className="page-header mb-0">Messages</h2>
        <div className="flex items-center gap-2 flex-wrap">
          {pendingSendable.length > 0 && (
            <button
              onClick={sendAllPending}
              disabled={bulkSending}
              className="btn-sm rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium disabled:opacity-60"
              title={`Deliver all ${pendingSendable.length} pending message(s) to parents' in-app inbox`}
            >
              <BellRing className="w-4 h-4" />
              {bulkSending ? 'Sending…' : `Send All In-App (${pendingSendable.length})`}
            </button>
          )}
          <button
            onClick={generateAbsenceAlerts}
            disabled={generating}
            className="btn-danger btn-sm"
          >
            <AlertTriangle className="w-4 h-4" />
            {generating ? 'Generating...' : 'Absence Alerts'}
          </button>
          <div className="flex items-center gap-1 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1">
            <IndianRupee className="w-4 h-4 text-amber-700" />
            <select
              value={reminderMonth}
              onChange={(e) => setReminderMonth(Number(e.target.value))}
              className="bg-transparent text-sm text-amber-900 font-medium border-0 focus:outline-none focus:ring-0 pr-1"
              title="Month for fee reminders"
            >
              {['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'].map((m, i) => (
                <option key={i} value={i + 1}>{m}</option>
              ))}
            </select>
            <select
              value={reminderYear}
              onChange={(e) => setReminderYear(Number(e.target.value))}
              className="bg-transparent text-sm text-amber-900 font-medium border-0 focus:outline-none focus:ring-0"
              title="Year for fee reminders"
            >
              {[_now.getFullYear() - 1, _now.getFullYear(), _now.getFullYear() + 1].map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          </div>
          <button
            onClick={generateFeeReminders}
            disabled={generating}
            className="btn-secondary btn-sm border-amber-300 text-amber-700 hover:bg-amber-50"
          >
            <IndianRupee className="w-4 h-4" />
            Fee Reminders
          </button>
          <button
            onClick={() => setComposeOpen(!composeOpen)}
            data-tour="messages-compose"
            className="btn-primary btn-sm"
          >
            <PenLine className="w-4 h-4" /> Compose
          </button>
        </div>
      </div>

      {/* Compose Section */}
      {composeOpen && (
        <div className="card border-indigo-200">
          <h3 className="font-semibold text-gray-900 mb-3">Compose Message</h3>
          <form onSubmit={handleCompose} className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Student *</label>
                <select
                  value={composeForm.student_id}
                  onChange={(e) => handleStudentChange(e.target.value)}
                  className="select-field"
                  required
                >
                  <option value="">Select student...</option>
                  {students.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Type</label>
                <select
                  value={composeForm.message_type}
                  onChange={(e) => handleTypeChange(e.target.value)}
                  className="select-field"
                >
                  <option value="custom">Custom</option>
                  <option value="absence_alert">Absence Alert</option>
                  <option value="fee_reminder">Fee Reminder</option>
                  <option value="class_update">Class Update</option>
                </select>
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Message *</label>
              <textarea
                value={composeForm.message_text}
                onChange={(e) => setComposeForm({ ...composeForm, message_text: e.target.value })}
                className="input-field"
                rows={6}
                placeholder="Type your message or select a template below..."
                required
              />
              {/* Quick template chips */}
              <div className="flex flex-wrap gap-2 mt-2">
                {quickTemplates.map((t) => (
                  <button
                    key={t.key}
                    type="button"
                    onClick={() => applyQuickTemplate(t.key)}
                    className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                      composeForm.message_type === t.key
                        ? 'bg-indigo-100 text-gray-900 border-indigo-300 dark:bg-indigo-600 dark:text-white'
                        : 'bg-gray-50 text-gray-600 border-gray-200 hover:bg-gray-100 hover:border-gray-300'
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setComposeOpen(false)} className="btn-secondary btn-sm">
                Cancel
              </button>
              <button type="submit" className="btn-primary btn-sm" disabled={sending}>
                <Send className="w-4 h-4" /> {sending ? 'Creating...' : 'Create Message'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Filters & Actions */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-center gap-2 bg-white rounded-lg border border-gray-200 p-1">
          <Filter className="w-4 h-4 text-gray-400 ml-2" />
          {[
            { value: 'all', label: 'All' },
            { value: 'absence_alert', label: 'Absence' },
            { value: 'fee_reminder', label: 'Fees' },
            { value: 'class_update', label: 'Updates' },
            { value: 'custom', label: 'Custom' },
          ].map((f) => (
            <button
              key={f.value}
              onClick={() => setFilter(f.value)}
              className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                filter === f.value
                  ? 'bg-indigo-100 text-gray-900 dark:bg-indigo-600 dark:text-white'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
        {filteredMessages.length > 0 && (
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-500">{filteredMessages.length} messages</span>
            <button onClick={copyAllMessages} className="btn-secondary btn-sm">
              <Copy className="w-4 h-4" /> Copy All
            </button>
            <button onClick={deleteAllFiltered} className="btn-sm bg-red-50 text-red-600 border border-red-200 hover:bg-red-100 transition-colors rounded-lg flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium">
              <Trash2 className="w-4 h-4" /> Clear All
            </button>
          </div>
        )}
      </div>

      {/* Messages List */}
      {filteredMessages.length === 0 ? (
        <EmptyState
          icon={MessageSquare}
          title="No messages"
          message={filter !== 'all' ? 'No messages of this type found.' : 'Generate alerts or compose a message to get started.'}
        />
      ) : (
        <div className="space-y-3">
          {pageMessages.map((message) => {
            const TypeIcon = messageTypeIcons[message.message_type] || PenLine;
            const isSent = message.is_sent === 1 || message.is_sent === true;
            return (
              <div
                key={message.id}
                className={`border-l-4 rounded-xl p-4 ${messageTypeColors[message.message_type] || 'bg-gray-50 border-l-gray-300'}`}
              >
                <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`badge text-xs ${messageTypeBadge[message.message_type] || 'bg-gray-100 text-gray-600'}`}>
                        <TypeIcon className="w-3 h-3 mr-1" />
                        {message.message_type?.replace(/_/g, ' ')}
                      </span>
                      {isSent && (
                        <span className="badge bg-green-100 text-green-700">
                          <CheckCircle className="w-3 h-3 mr-1" /> Sent
                        </span>
                      )}
                    </div>

                    <div className="mt-2 flex items-center gap-4 text-sm flex-wrap">
                      <span className="flex items-center gap-1 text-gray-700 font-medium">
                        <User className="w-3.5 h-3.5 text-gray-400" />
                        {message.student_name || 'Student'}
                      </span>
                      {message.parent_name && (
                        <span className="text-gray-500">Parent: {message.parent_name}</span>
                      )}
                      {message.mobile_number && (
                        <span className="flex items-center gap-1 text-gray-500">
                          <Phone className="w-3.5 h-3.5" />
                          {formatMobileDisplay(message.mobile_number)}
                        </span>
                      )}
                    </div>

                    {/* Message preview - show raw message directly */}
                    <div className="mt-3 bg-white rounded-lg p-3 border border-gray-200 shadow-sm max-w-lg">
                      <p className="text-sm text-gray-800 whitespace-pre-line">
                        {message.message || ''}
                      </p>
                    </div>

                    <p className="text-xs text-gray-400 mt-2">
                      {message.created_at
                        ? new Date(message.created_at).toLocaleDateString('en-IN', {
                            day: 'numeric',
                            month: 'short',
                            year: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                          })
                        : ''}
                    </p>
                  </div>

                  <div className="flex flex-row flex-wrap sm:flex-col gap-2 flex-shrink-0">
                    <button
                      onClick={() => copyMessage(message)}
                      className={`btn-sm rounded-lg transition-colors ${
                        copiedId === message.id
                          ? 'bg-green-100 text-green-700 border border-green-300'
                          : 'btn-secondary'
                      }`}
                    >
                      {copiedId === message.id ? (
                        <><CopyCheck className="w-4 h-4" /> Copied</>
                      ) : (
                        <><Copy className="w-4 h-4" /> Copy</>
                      )}
                    </button>
                    {normalizeMobileForWhatsApp(message.mobile_number) && (
                      <a
                        href={`https://wa.me/${normalizeMobileForWhatsApp(message.mobile_number)}?text=${encodeURIComponent(message.message)}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={() => { if (!isSent) markAsSent(message.id); }}
                        className="btn-sm rounded-lg bg-green-600 hover:bg-green-700 text-white flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium"
                        title="Open WhatsApp with this message pre-filled"
                      >
                        <Send className="w-4 h-4" /> WhatsApp
                      </a>
                    )}
                    {message.student_id && (
                      <button
                        onClick={() => sendInApp(message)}
                        disabled={sendingInAppId === message.id}
                        className="btn-sm rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium disabled:opacity-60"
                        title="Deliver to the parent's in-app inbox and push to their device"
                      >
                        <BellRing className="w-4 h-4" /> {sendingInAppId === message.id ? 'Sending…' : 'Send in-app'}
                      </button>
                    )}
                    {!isSent && (
                      <button
                        onClick={() => markAsSent(message.id)}
                        className="btn-success btn-sm"
                      >
                        <CheckCircle className="w-4 h-4" /> Sent
                      </button>
                    )}
                    <button
                      onClick={() => deleteMessage(message.id)}
                      className="btn-sm rounded-lg bg-red-50 text-red-600 border border-red-200 hover:bg-red-100 transition-colors flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium"
                    >
                      <Trash2 className="w-4 h-4" /> Delete
                    </button>
                  </div>
                </div>
              </div>
            );
          })}

          <Pagination
            page={page}
            pageCount={pageCount}
            setPage={setPage}
            from={from}
            to={to}
            total={total}
            label="messages"
            className="rounded-xl border border-gray-200"
          />
        </div>
      )}

    </div>
  );
}
