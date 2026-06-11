import { useState, useEffect, useMemo, useRef } from 'react';
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
  Settings as SettingsIcon,
  Rocket,
} from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../utils/api';
import { useConfirm } from '../contexts/ConfirmContext';
import { normalizeMobileForWhatsApp, formatMobileDisplay } from '../utils/phone';
import Loader from '../components/Loader';
import EmptyState from '../components/EmptyState';
import Modal from '../components/Modal';

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

// Defaults that mirror the server's DEFAULT_TEMPLATES in
// functions/api/routes/settings.js. Used as the bootstrap value before
// /api/settings/templates returns, and as a fallback if a key is missing
// from the server response.
const DEFAULT_TEMPLATES = {
  absence_alert:
    `Dear {parent},\n\nThis is to inform you that {name} has been absent for the last {count} consecutive classes. Kindly ensure regular attendance for better progress.\n\nPlease reach out if there are any concerns.\n\nRegards,\nVeena Dhwani Academy`,
  fee_reminder:
    `Dear {parent},\n\nThis is a gentle reminder regarding the {month} {year} fee payment for {name}.\n\nFees for {name} — {month} {year}: ₹{amount}\n  • Class fees: ₹{class_fees}\n  • Additional: ₹{additional_fees}\n\nKindly do the needful. Thank you.\n\nVeena Dhwani Academy`,
  class_update:
    `Dear {parent},\n\nThis is to inform you about an update regarding {name}'s music class schedule. Please check with us for the revised timings.\n\nRegards,\nVeena Dhwani Academy`,
  thank_you:
    `Dear {parent},\n\nThank you for your continued support and for ensuring {name}'s regular attendance at Veena Dhwani Academy. We truly appreciate it.\n\nRegards,\nVeena Dhwani Academy`,
  holiday_notice:
    `Dear {parent},\n\nThis is to inform you that Veena Dhwani Academy will remain closed on account of the upcoming holiday. {name}'s classes will resume as per the regular schedule after the break.\n\nRegards,\nVeena Dhwani Academy`,
};

// Which placeholders each template supports — drives the clickable chip
// buttons rendered under each textarea in the Edit Templates modal.
const TEMPLATE_PLACEHOLDERS = {
  absence_alert:  ['{parent}', '{name}', '{count}'],
  fee_reminder:   ['{parent}', '{name}', '{month}', '{year}', '{amount}', '{class_fees}', '{additional_fees}'],
  class_update:   ['{parent}', '{name}'],
  thank_you:      ['{parent}', '{name}'],
  holiday_notice: ['{parent}', '{name}'],
};

const TEMPLATE_LABELS = {
  absence_alert:  'Absence Alert',
  fee_reminder:   'Fee Reminder',
  class_update:   'Class Update',
  thank_you:      'Thank You',
  holiday_notice: 'Holiday Notice',
};

export default function Messages() {
  const confirm = useConfirm();
  const [messages, setMessages] = useState([]);
  const [students, setStudents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const [generating, setGenerating] = useState(false);
  const [copiedId, setCopiedId] = useState(null);

  // Customizable templates (admin-editable). Bootstrapped to defaults so the
  // page works on first render before /api/settings/templates returns.
  const [templates, setTemplates] = useState(DEFAULT_TEMPLATES);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [templatesDraft, setTemplatesDraft] = useState(DEFAULT_TEMPLATES);
  const [savingTemplates, setSavingTemplates] = useState(false);
  const templateTextareaRefs = useRef({});

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
      const [messagesData, studentsData, templatesData] = await Promise.all([
        api.get('/messages'),
        api.get('/students'),
        // Templates fetch must not break the page — fall back to defaults
        // if the Settings table doesn't exist yet or the call fails.
        api.get('/settings/templates').catch(() => ({ templates: DEFAULT_TEMPLATES })),
      ]);
      setMessages(messagesData.messages || []);
      setStudents((studentsData.students || []).filter((s) => s.status === 'active'));
      const t = { ...DEFAULT_TEMPLATES, ...(templatesData?.templates || {}) };
      setTemplates(t);
    } catch (err) {
      toast.error('Failed to load data: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  // Open the Edit Templates modal seeded with the latest fetched values.
  const openTemplatesEditor = () => {
    setTemplatesDraft({ ...DEFAULT_TEMPLATES, ...templates });
    setTemplatesOpen(true);
  };

  // Insert a placeholder at the textarea's current cursor position.
  // Keeps focus + restores caret after the inserted token.
  const insertPlaceholder = (type, placeholder) => {
    const ta = templateTextareaRefs.current[type];
    if (!ta) return;
    const start = ta.selectionStart ?? ta.value.length;
    const end   = ta.selectionEnd   ?? ta.value.length;
    const before = ta.value.slice(0, start);
    const after  = ta.value.slice(end);
    const next   = before + placeholder + after;
    setTemplatesDraft((prev) => ({ ...prev, [type]: next }));
    // Restore cursor after the inserted token on next tick.
    requestAnimationFrame(() => {
      ta.focus();
      const caret = start + placeholder.length;
      try { ta.setSelectionRange(caret, caret); } catch {}
    });
  };

  const saveTemplates = async () => {
    try {
      setSavingTemplates(true);
      const result = await api.put('/settings/templates', { templates: templatesDraft });
      const t = { ...DEFAULT_TEMPLATES, ...(result?.templates || templatesDraft) };
      setTemplates(t);
      toast.success('Templates saved');
      setTemplatesOpen(false);
    } catch (err) {
      toast.error('Failed to save templates: ' + err.message);
    } finally {
      setSavingTemplates(false);
    }
  };

  const resetTemplateToDefault = (type) => {
    setTemplatesDraft((prev) => ({ ...prev, [type]: DEFAULT_TEMPLATES[type] }));
  };

  // ----- Bulk WhatsApp "Send All Pending" -----
  // Opens one wa.me tab per pending message (~300 ms apart so Chrome doesn't
  // treat the burst as popup spam). Each opened message is marked is_sent=1
  // immediately — the teacher still has to tap Send in each tab, but the
  // UI no longer pesters them about pending drafts.
  const pendingSendable = useMemo(() =>
    messages.filter((m) =>
      !(m.is_sent === 1 || m.is_sent === true) &&
      normalizeMobileForWhatsApp(m.mobile_number)
    ), [messages]);

  const sendAllPending = async () => {
    const list = pendingSendable;
    if (list.length === 0) return;
    const ok = await confirm({
      title: `Open ${list.length} WhatsApp tab${list.length === 1 ? '' : 's'}?`,
      message:
        `This will open ${list.length} new browser tab${list.length === 1 ? '' : 's'} — one per pending message — with the text pre-filled. ` +
        `You will need to tap "Send" in each tab.\n\n` +
        `If your browser blocks popups, look for the popup-blocker icon in the address bar and allow popups for this site, then try again.`,
      confirmText: `Open ${list.length} tab${list.length === 1 ? '' : 's'}`,
    });
    if (!ok) return;
    try {
      setBulkSending(true);
      let opened = 0;
      for (const m of list) {
        const num = normalizeMobileForWhatsApp(m.mobile_number);
        if (!num) continue;
        const url = `https://wa.me/${num}?text=${encodeURIComponent(m.message || '')}`;
        const win = window.open(url, '_blank', 'noopener,noreferrer');
        if (win) opened++;
        // Flip the local row's status optimistically + server-side.
        try { await api.put(`/messages/${m.id}`, { is_sent: true }); } catch {}
        setMessages((prev) => prev.map((x) => (x.id === m.id ? { ...x, is_sent: 1 } : x)));
        // Pacing — Chrome blocks rapid-fire window.open as popup spam.
        await new Promise((r) => setTimeout(r, 300));
      }
      if (opened === list.length) {
        toast.success(`Opened ${opened} WhatsApp tab${opened === 1 ? '' : 's'} — tap Send in each.`);
      } else if (opened > 0) {
        toast(`Opened ${opened} of ${list.length} tabs — allow popups for this site to open the rest.`, { icon: 'ℹ️' });
      } else {
        toast.error('Browser blocked all popups. Allow popups for this site and try again.');
      }
    } finally {
      setBulkSending(false);
    }
  };

  const generateAbsenceAlerts = async () => {
    try {
      setGenerating(true);
      const result = await api.post('/messages/generate-absence-alert');
      const count = result.alerts?.length || 0;
      if (count > 0) {
        toast.success(`Generated ${count} absence alert(s)`);
      } else {
        toast.success('No students with 3+ consecutive absences');
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
              className="btn-sm rounded-lg bg-green-600 hover:bg-green-700 text-white flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium disabled:opacity-60"
              title={`Open WhatsApp for all ${pendingSendable.length} pending message(s)`}
            >
              <Rocket className="w-4 h-4" />
              {bulkSending ? 'Opening tabs...' : `Send All Pending (${pendingSendable.length})`}
            </button>
          )}
          <button
            onClick={openTemplatesEditor}
            className="btn-secondary btn-sm"
            title="Customize message wording"
          >
            <SettingsIcon className="w-4 h-4" />
            Edit Templates
          </button>
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
                        ? 'bg-indigo-100 text-indigo-700 border-indigo-300'
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
                  ? 'bg-indigo-100 text-indigo-700'
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
          {filteredMessages.map((message) => {
            const TypeIcon = messageTypeIcons[message.message_type] || PenLine;
            const isSent = message.is_sent === 1 || message.is_sent === true;
            return (
              <div
                key={message.id}
                className={`border-l-4 rounded-xl p-4 ${messageTypeColors[message.message_type] || 'bg-gray-50 border-l-gray-300'}`}
              >
                <div className="flex items-start justify-between gap-4">
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

                  <div className="flex flex-col gap-2 flex-shrink-0">
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
        </div>
      )}

      {/* Edit Templates modal */}
      <Modal
        isOpen={templatesOpen}
        onClose={() => setTemplatesOpen(false)}
        title="Edit message templates"
        size="lg"
      >
        <div className="space-y-5">
          <p className="text-sm text-gray-600">
            Customize the wording of automated and quick-template messages.
            Use the chip buttons below each field to insert placeholders that
            get replaced with student details when the message is generated.
          </p>
          {Object.keys(DEFAULT_TEMPLATES).map((type) => {
            const placeholders = TEMPLATE_PLACEHOLDERS[type] || [];
            return (
              <div key={type} className="border border-gray-200 rounded-lg p-3 bg-gray-50/50">
                <div className="flex items-center justify-between mb-1.5">
                  <label className="block text-sm font-medium text-gray-800">
                    {TEMPLATE_LABELS[type]}
                  </label>
                  <button
                    type="button"
                    onClick={() => resetTemplateToDefault(type)}
                    className="text-xs text-gray-500 hover:text-indigo-600 hover:underline"
                    title="Restore the original wording"
                  >
                    Reset to default
                  </button>
                </div>
                <textarea
                  ref={(el) => { templateTextareaRefs.current[type] = el; }}
                  value={templatesDraft[type] ?? ''}
                  onChange={(e) =>
                    setTemplatesDraft((prev) => ({ ...prev, [type]: e.target.value }))
                  }
                  rows={6}
                  className="input-field font-mono text-sm"
                  spellCheck={false}
                />
                {placeholders.length > 0 && (
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    <span className="text-xs text-gray-500">Insert:</span>
                    {placeholders.map((ph) => (
                      <button
                        key={ph}
                        type="button"
                        onClick={() => insertPlaceholder(type, ph)}
                        className="px-2 py-0.5 rounded-full text-xs font-mono bg-indigo-50 text-indigo-700 border border-indigo-200 hover:bg-indigo-100 transition-colors"
                        title={`Insert ${ph} at cursor`}
                      >
                        {ph}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setTemplatesOpen(false)}
              className="btn-secondary btn-sm"
              disabled={savingTemplates}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={saveTemplates}
              className="btn-primary btn-sm"
              disabled={savingTemplates}
            >
              {savingTemplates ? 'Saving...' : 'Save templates'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
