// Platform Admin console. Visible only to Catalyst "App Administrator" users
// (gated by RequirePlatform). Lets you (the platform owner) see and manage
// every org on the platform from one side-navigation console: an overview
// with revenue + funnel + trial watch, an academies directory with an inline
// per-org detail panel (record counts, members with a Show-contact reveal,
// plan-change history, module toggles), the cross-org activity log, and a
// broadcast composer.

import { useEffect, useMemo, useState, Fragment } from 'react';
import { Link } from 'react-router-dom';
import { FEATURE_CATALOG, PLAN_PRICING } from '../config';
import {
  Building2,
  Users as UsersIcon,
  Shield,
  RefreshCw,
  Search,
  TrendingUp,
  AlertCircle,
  Pause,
  Play,
  Eye,
  EyeOff,
  Plus,
  Mail,
  X,
  Loader2,
  RotateCcw,
  BarChart3,
  Clock,
  ScrollText,
  IndianRupee,
  Download,
  ToggleLeft,
  Megaphone,
  Send,
  LayoutDashboard,
  Layers,
  History,
  ChevronLeft,
  Activity,
  Receipt,
  CheckCircle2,
  Ban,
  Inbox,
  Phone,
  AtSign,
  MapPin,
} from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../utils/api';
import Loader from '../components/Loader';
import CredentialShare from '../components/CredentialShare';
import EmptyState from '../components/EmptyState';
import Tooltip from '../components/Tooltip';
import { useAuth } from '../contexts/AuthContext';
import { useConfirm } from '../contexts/ConfirmContext';

// Sign-in message shared with a new academy owner (no email — WhatsApp/in person).
const PLATFORM_LOGIN_URL = `${window.location.origin}${(process.env.PUBLIC_URL || '/').replace(/\/$/, '')}/login`;
function ownerCredMessage({ email, password, academyName }) {
  const lines = [
    `Your ${academyName || 'VidyaSetu'} admin access is ready.`,
    ``,
    `Sign in here: ${PLATFORM_LOGIN_URL}`,
    `Email: ${email}`,
  ];
  if (password) lines.push(`Password: ${password}`, ``, `Please change your password after signing in.`);
  else lines.push(``, `Use your existing password.`);
  return lines.join('\n');
}
const waSend = (text) => `https://api.whatsapp.com/send?text=${encodeURIComponent(text)}`;

// localStorage key the api client checks to inject ?org=<id> on every
// admin call. Setting this lets the platform admin "see what the org
// sees" without needing to be a member.
const IMPERSONATE_KEY = 'veena_impersonate_org_id';

// Monthly price per active student by plan. Display-only figures that mirror
// the public landing page (client/public/landing.html). Trial and Free bill
// nothing. When real billing is wired (Zoho), this map is the place to update.
const PLAN_PRICE = { core: 50, complete: 100, trial: 0, free: 0 };
const PAID_PLANS = ['core', 'complete'];

// Human labels for audit-log action codes (see functions/api/lib/audit.js).
const AUDIT_LABELS = {
  'org.create':           'Created',
  'org.status_change':    'Status',
  'org.plan_change':      'Plan',
  'org.student_cap':      'Student cap',
  'org.reset_onboarding': 'Replay tour',
  'org.resend_invite':    'Resent access',
  'org.module_flag':      'Module',
  'org.view_members_pii': 'Viewed contacts',
  'platform.broadcast':   'Broadcast',
  'invoice.create':       'Invoice',
  'invoice.update':       'Invoice',
};

// Build a short, readable summary from an audit entry's detail JSON.
function auditDetailText(a) {
  const d = a.detail;
  if (!d || typeof d !== 'object') return '';
  switch (a.action) {
    case 'org.status_change': return d.to ? `set to ${d.to}` : '';
    case 'org.plan_change':   return d.to ? `${d.from || '?'} → ${d.to}${d.trial_days ? ` (${d.trial_days}d)` : ''}` : '';
    case 'org.student_cap':   return (d.max_students === '' || d.max_students == null) ? 'cap cleared' : `cap ${d.max_students}`;
    case 'org.resend_invite': return d.email ? `to ${d.email}` : '';
    case 'org.reset_onboarding': return d.mode === 'setup' ? 'tour + setup' : 'tour';
    case 'org.create':        return d.owner_email ? `owner ${d.owner_email}` : '';
    case 'org.module_flag':   return d.flag ? `${d.flag.replace('modules.', '')} ${d.enabled ? 'on' : 'off'}` : '';
    case 'org.view_members_pii': return d.count != null ? `${d.count} member${d.count === 1 ? '' : 's'}` : '';
    case 'platform.broadcast': return d.title ? `"${d.title}" to ${d.orgs || 0} academ${d.orgs === 1 ? 'y' : 'ies'}` : '';
    case 'invoice.create':    return d.amount != null ? `₹${Number(d.amount).toLocaleString('en-IN')}${d.period ? ` · ${d.period}` : ''}` : '';
    case 'invoice.update':    return d.status ? `marked ${d.status}` : '';
    default:                  return '';
  }
}

const PLAN_LABELS = { trial: 'Trial', free: 'Free', core: 'Core', complete: 'Complete' };

export default function Platform() {
  const { user } = useAuth();
  const confirm = useConfirm();
  const [orgs, setOrgs] = useState([]);
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [section, setSection] = useState('overview'); // overview | academies | activity | broadcast
  const [impersonating, setImpersonating] = useState(() => {
    try { return localStorage.getItem(IMPERSONATE_KEY) || ''; } catch { return ''; }
  });

  // Create-academy (invite-only) form. The platform admin fills this; the
  // backend creates the Catalyst user + org + owner membership and Catalyst
  // emails the new owner an invite to set their password.
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const emptyForm = { academy_name: '', first_name: '', last_name: '', owner_email: '' };
  const [createForm, setCreateForm] = useState(emptyForm);
  const setCF = (k) => (e) => setCreateForm((f) => ({ ...f, [k]: e.target.value }));
  // Sign-in details to share after creating/resetting an owner (shown once).
  const [credModal, setCredModal] = useState(null); // { email, password, academyName } | null

  // Trial date-picker modal — replaces the old window.prompt so trial length is
  // set with the same date input the rest of the app uses. Holds the target org
  // and the chosen END date (YYYY-MM-DD); days are derived from it on confirm.
  const [trialModal, setTrialModal] = useState(null); // { org, date } | null

  // Per-org detail drill-down (rendered inline inside the Academies section,
  // not as a pop-up). Holds the fetched payload: org + module-wise record
  // counts + members + plan-change history + module flags.
  const [detail, setDetail] = useState(null);         // { org, counts, members, module_flags, history } | null
  const [detailLoading, setDetailLoading] = useState(false);

  // Show-contact reveal. Member name + email are personal data, so they are
  // fetched (and audited) only when the platform admin explicitly asks.
  const [piiBusy, setPiiBusy] = useState(false);
  const [piiShown, setPiiShown] = useState(false);

  // Platform audit log — recent admin actions across all orgs. `available`
  // flips false until the AuditLog table is created in the Catalyst console.
  const [audit, setAudit] = useState({ entries: [], available: true });

  // Activation funnel metrics (signed up → setup → first student → first attendance).
  const [funnel, setFunnel] = useState(null);

  // Per-org engagement (last-active + days idle), drives the quiet-academy watch.
  const [engagement, setEngagement] = useState([]);

  const isPlatformAdmin = user?.role === 'App Administrator';

  const fetchAll = async () => {
    setLoading(true);
    try {
      const [statusRes, orgsRes, auditRes, metricsRes, engagementRes] = await Promise.all([
        api.get('/platform/status'),
        api.get('/platform/orgs'),
        api.get('/platform/audit').catch(() => ({ entries: [], available: true })),
        api.get('/platform/metrics').catch(() => null),
        api.get('/platform/engagement').catch(() => ({ engagement: [] })),
      ]);
      setStatus(statusRes || null);
      setOrgs(orgsRes?.orgs || []);
      setAudit({ entries: auditRes?.entries || [], available: auditRes?.available !== false });
      setFunnel(metricsRes?.funnel || null);
      setEngagement(engagementRes?.engagement || []);
    } catch (err) {
      toast.error('Failed to load platform data: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchAll(); }, []);

  // ----- Global cross-org search --------------------------------------------
  const [searchQ, setSearchQ] = useState('');
  const [searchResults, setSearchResults] = useState(null); // { academies, people } | null
  const [searchBusy, setSearchBusy] = useState(false);
  const runSearch = async (q) => {
    const term = String(q || '').trim();
    if (term.length < 2) { setSearchResults(null); return; }
    setSearchBusy(true);
    try {
      const res = await api.get(`/platform/search?q=${encodeURIComponent(term)}`);
      setSearchResults({ academies: res?.academies || [], people: res?.people || [] });
    } catch (e) {
      toast.error('Search failed: ' + e.message);
    } finally {
      setSearchBusy(false);
    }
  };

  // ----- Billing & invoices --------------------------------------------------
  const [invoices, setInvoices] = useState([]);
  const [invoicesAvailable, setInvoicesAvailable] = useState(true);
  const [invoicesLoaded, setInvoicesLoaded] = useState(false);
  const [invoiceBusy, setInvoiceBusy] = useState('');
  const emptyInvoice = { org_id: '', amount: '', period: '', due_date: '', notes: '' };
  const [invoiceForm, setInvoiceForm] = useState(emptyInvoice);
  const setIF = (k) => (e) => setInvoiceForm((f) => ({ ...f, [k]: e.target.value }));

  const fetchInvoices = async () => {
    try {
      const res = await api.get('/platform/invoices');
      setInvoices(res?.invoices || []);
      setInvoicesAvailable(res?.available !== false);
    } catch (e) {
      toast.error('Could not load invoices: ' + e.message);
    } finally {
      setInvoicesLoaded(true);
    }
  };

  const createInvoice = async (e) => {
    e.preventDefault();
    const f = invoiceForm;
    if (!f.org_id) return toast.error('Pick an academy for this invoice.');
    const amt = Number(f.amount);
    if (!Number.isFinite(amt) || amt < 0) return toast.error('Enter a valid amount.');
    setInvoiceBusy('new');
    try {
      await api.post('/platform/invoices', {
        org_id: f.org_id,
        amount: amt,
        period: f.period.trim(),
        due_date: f.due_date,
        notes: f.notes.trim(),
      });
      toast.success('Invoice added');
      setInvoiceForm(emptyInvoice);
      fetchInvoices();
    } catch (err) {
      toast.error('Could not add invoice: ' + err.message);
    } finally {
      setInvoiceBusy('');
    }
  };

  const setInvoiceStatus = async (inv, status) => {
    setInvoiceBusy(inv.id);
    // Optimistic.
    setInvoices((list) => list.map((x) => (x.id === inv.id ? { ...x, status } : x)));
    try {
      await api.put(`/platform/invoices/${inv.id}`, { status });
      toast.success(`Invoice marked ${status}`);
      fetchInvoices();
    } catch (e) {
      toast.error('Could not update invoice: ' + e.message);
      fetchInvoices();
    } finally {
      setInvoiceBusy('');
    }
  };

  // ----- Broadcast sent history ---------------------------------------------
  const [broadcasts, setBroadcasts] = useState([]);
  const [broadcastsLoaded, setBroadcastsLoaded] = useState(false);
  const fetchBroadcasts = async () => {
    try {
      const res = await api.get('/platform/broadcasts');
      setBroadcasts(res?.broadcasts || []);
    } catch { /* non-fatal */ } finally {
      setBroadcastsLoaded(true);
    }
  };

  // ----- Requests (leads) ----------------------------------------------------
  const [leads, setLeads] = useState([]);
  const [leadsAvailable, setLeadsAvailable] = useState(true);
  const [leadsLoaded, setLeadsLoaded] = useState(false);
  const [leadBusy, setLeadBusy] = useState('');

  const fetchLeads = async () => {
    try {
      const res = await api.get('/platform/leads');
      setLeads(res?.leads || []);
      setLeadsAvailable(res?.available !== false);
    } catch (e) {
      toast.error('Could not load requests: ' + e.message);
    } finally {
      setLeadsLoaded(true);
    }
  };

  const setLeadStatus = async (lead, status) => {
    setLeadBusy(lead.id);
    // Optimistic.
    setLeads((list) => list.map((x) => (x.id === lead.id ? { ...x, status } : x)));
    try {
      await api.put(`/platform/leads/${lead.id}`, { status });
      toast.success(`Marked ${LEAD_LABEL[status] || status}`);
      fetchLeads();
    } catch (e) {
      toast.error('Could not update request: ' + e.message);
      fetchLeads();
    } finally {
      setLeadBusy('');
    }
  };

  const saveLeadNotes = async (lead, notes) => {
    setLeadBusy(lead.id);
    try {
      await api.put(`/platform/leads/${lead.id}`, { notes });
      setLeads((list) => list.map((x) => (x.id === lead.id ? { ...x, notes } : x)));
      toast.success('Notes saved');
    } catch (e) {
      toast.error('Could not save notes: ' + e.message);
    } finally {
      setLeadBusy('');
    }
  };

  // Lazy-load section data the first time each tab is opened.
  useEffect(() => {
    if (section === 'billing' && !invoicesLoaded) fetchInvoices();
    if (section === 'broadcast' && !broadcastsLoaded) fetchBroadcasts();
    if (section === 'requests' && !leadsLoaded) fetchLeads();
  }, [section]); // eslint-disable-line react-hooks/exhaustive-deps

  const setOrgStatus = async (org, nextStatus) => {
    const action = nextStatus === 'suspended' ? 'suspend' : 'reactivate';
    const ok = await confirm({
      title: `${action[0].toUpperCase() + action.slice(1)} ${org.name}?`,
      message: nextStatus === 'suspended'
        ? `All members of ${org.name} will be locked out immediately. They can be unsuspended any time.`
        : `${org.name} members will be able to sign in and use the app again.`,
      confirmText: action[0].toUpperCase() + action.slice(1),
    });
    if (!ok) return;
    try {
      await api.put(`/platform/orgs/${org.id}`, { status: nextStatus });
      toast.success(`${org.name} ${nextStatus === 'suspended' ? 'suspended' : 'reactivated'}`);
      fetchAll();
    } catch (e) {
      toast.error('Action failed: ' + e.message);
    }
  };

  // Push a plan change to the backend. Used directly for non-trial plans, and
  // by the trial modal once an end date is chosen.
  const commitPlan = async (org, nextPlan, extra = {}) => {
    const prev = org.plan;
    try {
      await api.put(`/platform/orgs/${org.id}`, { plan: nextPlan, ...extra });
      const suffix = nextPlan === 'trial' && extra.trial_days ? ` (${extra.trial_days}-day trial)` : '';
      toast.success(`${org.name} moved to the ${PLAN_LABELS[nextPlan] || nextPlan} plan${suffix}`);
      // Re-fetch so derived fields (trial countdown, effective_plan) refresh.
      fetchAll();
    } catch (e) {
      toast.error('Could not change plan: ' + e.message);
      setOrgs((list) => list.map((o) => (o.id === org.id ? { ...o, plan: prev } : o)));
    }
  };

  const setOrgPlan = (org, nextPlan) => {
    // Trial: open the date picker (default end date 14 days out). The <select>
    // is controlled by o.plan, so doing nothing here leaves it on the old plan
    // until the modal confirms — a cancel needs no extra revert.
    if (nextPlan === 'trial') {
      const d = new Date(Date.now() + 14 * 86400000);
      setTrialModal({ org, date: d.toISOString().slice(0, 10) });
      return;
    }
    commitPlan(org, nextPlan);
  };

  // Confirm the trial modal: derive whole days from today to the chosen end
  // date and commit. The backend expects trial_days, so we convert here.
  const confirmTrial = () => {
    if (!trialModal) return;
    const { org, date } = trialModal;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const end = new Date(`${date}T00:00:00`);
    const days = Math.round((end - today) / 86400000);
    if (!Number.isFinite(days) || days < 1 || days > 365) {
      toast.error('Pick an end date between tomorrow and one year from today.');
      return;
    }
    const target = org;
    setTrialModal(null);
    commitPlan(target, 'trial', { trial_days: days });
  };

  // Per-org student-cap override. Blank input → clear (revert to plan default).
  const setOrgStudentLimit = async (org, raw) => {
    const trimmed = String(raw ?? '').trim();
    const current = org.max_students_override; // number or null

    let payload;
    if (trimmed === '') {
      if (current == null) return; // already on plan default — nothing to do
      payload = { max_students: null };
    } else {
      const n = parseInt(trimmed, 10);
      if (!Number.isFinite(n) || n < 0 || n > 100000) {
        toast.error('Enter a whole number ≥ 0, or leave blank for the plan default.');
        fetchAll();
        return;
      }
      if (n === current) return; // unchanged
      payload = { max_students: n };
    }

    try {
      await api.put(`/platform/orgs/${org.id}`, payload);
      toast.success(
        trimmed === ''
          ? `${org.name}: student limit reset to plan default`
          : `${org.name}: student limit set to ${trimmed}`
      );
      fetchAll();
    } catch (e) {
      toast.error('Could not update student limit: ' + e.message);
      fetchAll();
    }
  };

  const createAcademy = async (e) => {
    e.preventDefault();
    const f = createForm;
    if (!f.academy_name.trim()) return toast.error('Academy name is required.');
    if (!f.first_name.trim()) return toast.error("Owner's first name is required.");
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f.owner_email)) {
      return toast.error('A valid owner email is required.');
    }
    try {
      setCreating(true);
      const data = await api.post('/auth/signup', {
        academy_name: f.academy_name.trim(),
        first_name: f.first_name.trim(),
        last_name: f.last_name.trim(),
        owner_email: f.owner_email.trim().toLowerCase(),
      });
      toast.success(`Created "${data?.org?.name || f.academy_name}"`);
      setCreateForm(emptyForm);
      setShowCreate(false);
      fetchAll();
      // Show the owner's sign-in details to share (password shown only once).
      setCredModal({
        email: data?.owner_email || f.owner_email.trim().toLowerCase(),
        password: data?.temp_password || null,
        academyName: data?.org?.name || f.academy_name.trim(),
      });
    } catch (err) {
      toast.error('Could not create academy: ' + err.message);
    } finally {
      setCreating(false);
    }
  };

  // Re-arm the first-login welcome tour for an org. The owner sees the guided
  // walkthrough again the next time they open the app (the flag is otherwise
  // only set at signup). Cosmetic and reversible — they just dismiss it again.
  const replayOnboarding = async (org) => {
    const ok = await confirm({
      title: `Replay onboarding for ${org.name}?`,
      message: `The owner of ${org.name} will see the welcome walkthrough again the next time they open the app. They can dismiss it as usual.`,
      confirmText: 'Replay',
    });
    if (!ok) return;
    try {
      await api.put(`/platform/orgs/${org.id}`, { reset_onboarding: true });
      toast.success(`${org.name}: onboarding will replay on next sign-in`);
    } catch (e) {
      toast.error('Could not re-arm onboarding: ' + e.message);
    }
  };

  // Open the per-org detail drill-down. Loads how much data the academy has
  // created (module-wise record counts), its members, plan-change history, and
  // plan/trial state. Switches to the Academies section so the inline panel
  // is in view.
  const openDetail = async (org) => {
    setSection('academies');
    setPiiShown(false);
    setDetail({ org, counts: null, members: null, module_flags: null, history: null }); // open with what we know
    setDetailLoading(true);
    try {
      const [res, hist] = await Promise.all([
        api.get(`/platform/orgs/${org.id}/detail`),
        api.get(`/platform/audit?org=${org.id}`).catch(() => ({ entries: [] })),
      ]);
      setDetail({
        org: res?.org || org,
        counts: res?.counts || [],
        members: res?.members || [],
        module_flags: res?.module_flags || [],
        history: (hist?.entries || []).filter((e) => e.action === 'org.plan_change'),
      });
    } catch (e) {
      toast.error('Could not load org details: ' + e.message);
      setDetail(null);
    } finally {
      setDetailLoading(false);
    }
  };

  // Reveal member names + emails for the open detail org. Fetched on demand and
  // audited server-side as a contact-data view.
  const revealMembers = async () => {
    if (!detail) return;
    const orgId = detail.org.id || detail.org.ROWID;
    setPiiBusy(true);
    try {
      const res = await api.get(`/platform/orgs/${orgId}/members`);
      setDetail((d) => (d ? { ...d, members: res?.members || d.members } : d));
      setPiiShown(true);
    } catch (e) {
      toast.error('Could not load contact details: ' + e.message);
    } finally {
      setPiiBusy(false);
    }
  };

  // Flip one module toggle for the org in the detail panel. Optimistic update.
  const [flagBusy, setFlagBusy] = useState('');
  const toggleModuleFlag = async (flag) => {
    if (!detail) return;
    const orgId = detail.org.id || detail.org.ROWID;
    const current = (detail.module_flags || []).find((f) => f.key === flag);
    const next = !(current?.enabled);
    setFlagBusy(flag);
    // Optimistic UI.
    setDetail((d) => ({
      ...d,
      module_flags: (d.module_flags || []).map((f) => (f.key === flag ? { ...f, enabled: next } : f)),
    }));
    try {
      await api.put(`/platform/orgs/${orgId}/module-flag`, { flag, enabled: next });
      toast.success(`${flag.replace('modules.', '')} ${next ? 'enabled' : 'disabled'}`);
    } catch (e) {
      toast.error('Could not change module: ' + e.message);
      // Revert.
      setDetail((d) => ({
        ...d,
        module_flags: (d.module_flags || []).map((f) => (f.key === flag ? { ...f, enabled: !next } : f)),
      }));
    } finally {
      setFlagBusy('');
    }
  };

  // Download a full JSON export of one org's data.
  const [exporting, setExporting] = useState(false);
  const exportOrg = async (org) => {
    const orgId = org.id || org.ROWID;
    setExporting(true);
    try {
      const res = await api.get(`/platform/orgs/${orgId}/export`);
      const blob = new Blob([JSON.stringify(res, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const stamp = new Date().toISOString().slice(0, 10);
      a.href = url;
      a.download = `${org.slug || `org-${orgId}`}-export-${stamp}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success('Export downloaded');
    } catch (e) {
      toast.error('Could not export: ' + e.message);
    } finally {
      setExporting(false);
    }
  };

  // Re-send the owner's access email (Catalyst forgot-password link). Works for
  // an owner who never accepted their invite or who has lost access.
  const [resending, setResending] = useState(false);
  const resendInvite = async (org) => {
    const ok = await confirm({
      title: `Send access email to ${org.name}'s owner?`,
      message: `We'll email the owner of ${org.name} a fresh link to set their password and sign in. Use this when they never accepted the invite or have lost access.`,
      confirmText: 'Send email',
    });
    if (!ok) return;
    setResending(true);
    try {
      const res = await api.post(`/platform/orgs/${org.id}/resend-invite`, {});
      toast.success('New password generated');
      setCredModal({
        email: res?.email || '',
        password: res?.temp_password || null,
        academyName: org?.name || '',
      });
    } catch (e) {
      toast.error('Could not send access email: ' + e.message);
    } finally {
      setResending(false);
    }
  };

  // ----- Broadcast in-app notification to academies -------------------------
  // Sends an admin-level notification (with web push) to one academy or to all
  // of them. Lands in each owner's dashboard bell.
  const [broadcasting, setBroadcasting] = useState(false);
  const emptyBroadcast = { target: 'all', title: '', body: '', link: '' };
  const [broadcastForm, setBroadcastForm] = useState(emptyBroadcast);
  const setBF = (k) => (e) => setBroadcastForm((f) => ({ ...f, [k]: e.target.value }));

  const sendBroadcast = async (e) => {
    e.preventDefault();
    const title = broadcastForm.title.trim();
    if (!title) { toast.error('Add a title for the notification'); return; }
    const targetName = broadcastForm.target === 'all'
      ? 'every academy'
      : (orgs.find((o) => String(o.id) === String(broadcastForm.target))?.name || 'the selected academy');
    const ok = await confirm({
      title: 'Send this notification?',
      message: `"${title}" will be delivered to ${targetName}. It appears in the dashboard bell and as a push notification on registered devices.`,
      confirmText: 'Send',
    });
    if (!ok) return;
    setBroadcasting(true);
    try {
      const res = await api.post('/platform/notifications/broadcast', {
        target: broadcastForm.target,
        title,
        body: broadcastForm.body.trim(),
        link: broadcastForm.link.trim(),
      });
      toast.success(`${res?.message || 'Sent'} · ${res?.delivered || 0} in-app, ${res?.push || 0} push`);
      setBroadcastForm(emptyBroadcast);
      fetchBroadcasts();
    } catch (err) {
      toast.error('Could not send: ' + err.message);
    } finally {
      setBroadcasting(false);
    }
  };

  const startImpersonate = (org) => {
    try {
      localStorage.setItem(IMPERSONATE_KEY, String(org.id));
      setImpersonating(String(org.id));
      toast.success(`Now viewing as ${org.name}. All requests target this org until you stop.`);
    } catch {
      toast.error('Could not set impersonation (localStorage blocked?)');
    }
  };

  const stopImpersonate = () => {
    try {
      localStorage.removeItem(IMPERSONATE_KEY);
      setImpersonating('');
      toast.success('Stopped impersonation — back to platform-admin view.');
    } catch {}
  };

  const filteredOrgs = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return orgs;
    return orgs.filter((o) =>
      String(o.name || '').toLowerCase().includes(q) ||
      String(o.slug || '').toLowerCase().includes(q) ||
      String(o.owner_user_id || '').includes(q)
    );
  }, [orgs, search]);

  const stats = useMemo(() => {
    const active   = orgs.filter((o) => o.status === 'active').length;
    const suspended = orgs.filter((o) => o.status === 'suspended').length;
    const totalMembers = orgs.reduce((sum, o) => sum + (Number(o.member_count) || 0), 0);
    return { active, suspended, totalMembers };
  }, [orgs]);

  // Revenue snapshot — estimated MRR from active students × plan price, plus
  // the paid-vs-trial split and a simple conversion rate. Display-only.
  const revenue = useMemo(() => {
    let mrr = 0;
    let paid = 0, trial = 0, free = 0;
    for (const o of orgs) {
      const plan = o.effective_plan || o.plan;
      const price = PLAN_PRICE[plan] ?? 0;
      mrr += price * (o.student_count || 0);
      if (PAID_PLANS.includes(plan)) paid += 1;
      else if (plan === 'trial') trial += 1;
      else free += 1;
    }
    const convertible = paid + trial; // exclude free from the denominator
    const conversion = convertible > 0 ? Math.round((paid / convertible) * 100) : 0;
    return { mrr, paid, trial, free, conversion };
  }, [orgs]);

  // Trial watchlist — academies on trial that have already lapsed, or whose
  // trial ends within the next 7 days. Surfaced so you can renew before access
  // drops to the Free plan. Expired ones sort first, then soonest-ending.
  const TRIAL_WATCH_DAYS = 7;
  const trialWatch = useMemo(() => {
    return orgs
      .filter((o) => o.trial && (o.trial.expired || (o.trial.daysLeft != null && o.trial.daysLeft <= TRIAL_WATCH_DAYS)))
      .sort((a, b) => {
        const av = a.trial.expired ? -1 : (a.trial.daysLeft ?? 999);
        const bv = b.trial.expired ? -1 : (b.trial.daysLeft ?? 999);
        return av - bv;
      });
  }, [orgs]);

  if (!isPlatformAdmin) {
    return (
      <div className="card flex items-center gap-3 text-red-600">
        <Shield className="w-5 h-5" />
        Platform Admin access required. This page is only visible to the
        platform owner.
      </div>
    );
  }

  if (loading) return <Loader text="Loading platform data..." />;

  const NAV = [
    { key: 'overview',   label: 'Overview',   icon: LayoutDashboard, badge: 0 },
    { key: 'requests',   label: 'Requests',   icon: Inbox,           badge: leads.filter((l) => l.status === 'new').length },
    { key: 'academies',  label: 'Academies',  icon: Building2,       badge: orgs.length },
    { key: 'search',     label: 'Search',     icon: Search,          badge: 0 },
    { key: 'billing',    label: 'Billing',    icon: Receipt,         badge: 0 },
    { key: 'plans',      label: 'Plans',      icon: Layers,          badge: 0 },
    { key: 'activity',   label: 'Activity',   icon: ScrollText,      badge: 0 },
    { key: 'broadcast',  label: 'Broadcast',  icon: Megaphone,       badge: 0 },
  ];

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className="page-header mb-0">Platform Admin</h2>
          <p className="text-sm text-gray-500 mt-1">
            Cross-org console for you, the platform owner. Org owners see only their own academy.
          </p>
        </div>
        <button onClick={fetchAll} className="btn-secondary btn-sm self-start">
          <RefreshCw className="w-4 h-4" /> Refresh
        </button>
      </div>

      {/* Impersonation banner — visible whenever you're acting as a tenant */}
      {impersonating && (
        <div className="rounded-lg bg-amber-50 border border-amber-200 px-4 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <Eye className="w-5 h-5 text-amber-700 flex-shrink-0" />
            <p className="text-sm text-amber-900 truncate">
              <strong>Impersonating org {impersonating}.</strong>
              {' '}All admin API calls will be scoped to this academy until you stop.
            </p>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <Link to="/dashboard" className="btn-sm bg-white text-amber-800 border border-amber-300 hover:bg-amber-50 rounded-lg px-3 py-1 text-xs font-medium">
              Open academy app
            </Link>
            <button onClick={stopImpersonate} className="btn-sm bg-white text-amber-800 border border-amber-300 hover:bg-amber-50 rounded-lg px-3 py-1 text-xs font-medium">
              Stop impersonating
            </button>
          </div>
        </div>
      )}

      {/* Bootstrap status banner */}
      {status && !status.bootstrapped && (
        <div className="card border-amber-200 bg-amber-50 flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-amber-700 mt-0.5" />
          <div>
            <p className="font-medium text-amber-800">Platform not bootstrapped yet</p>
            <p className="text-sm text-amber-700 mt-1">
              No organizations exist. POST <code>/api/platform/bootstrap</code> from the browser console to create
              the default org and tag all existing data with its org_id.
            </p>
          </div>
        </div>
      )}

      {/* Console: side nav + section content */}
      <div className="lg:grid lg:grid-cols-[208px_1fr] lg:gap-4 space-y-4 lg:space-y-0">
        {/* Side navigation. Vertical on desktop, a horizontal scroll strip on
            mobile so it never overflows the viewport. */}
        <nav className="lg:sticky lg:top-4 lg:self-start">
          <div className="card p-2 flex lg:flex-col gap-1 overflow-x-auto">
            {NAV.map((n) => (
              <NavItem
                key={n.key}
                icon={n.icon}
                label={n.label}
                badge={n.badge}
                active={section === n.key}
                onClick={() => setSection(n.key)}
              />
            ))}
          </div>
        </nav>

        {/* Section content */}
        <div className="min-w-0 space-y-4">
          {section === 'overview' && (
            <OverviewSection
              orgs={orgs}
              stats={stats}
              revenue={revenue}
              funnel={funnel}
              engagement={engagement}
              trialWatch={trialWatch}
              trialWatchDays={TRIAL_WATCH_DAYS}
              onExtendTrial={(o) => setOrgPlan(o, 'trial')}
              onOpenOrg={(orgId) => {
                const o = orgs.find((x) => String(x.id) === String(orgId));
                if (o) openDetail(o);
              }}
              onGoAcademies={() => setSection('academies')}
            />
          )}

          {section === 'search' && (
            <SearchSection
              searchQ={searchQ}
              setSearchQ={setSearchQ}
              runSearch={runSearch}
              searchBusy={searchBusy}
              results={searchResults}
              onOpenOrg={(orgId) => {
                const o = orgs.find((x) => String(x.id) === String(orgId));
                if (o) openDetail(o);
              }}
            />
          )}

          {section === 'requests' && (
            <LeadsSection
              leads={leads}
              available={leadsAvailable}
              loaded={leadsLoaded}
              leadBusy={leadBusy}
              setLeadStatus={setLeadStatus}
              saveLeadNotes={saveLeadNotes}
            />
          )}

          {section === 'billing' && (
            <BillingSection
              orgs={orgs}
              invoices={invoices}
              available={invoicesAvailable}
              loaded={invoicesLoaded}
              invoiceForm={invoiceForm}
              setIF={setIF}
              invoiceBusy={invoiceBusy}
              createInvoice={createInvoice}
              setInvoiceStatus={setInvoiceStatus}
            />
          )}

          {section === 'academies' && (
            detail ? (
              <DetailPanel
                detail={detail}
                detailLoading={detailLoading}
                piiBusy={piiBusy}
                piiShown={piiShown}
                onReveal={revealMembers}
                flagBusy={flagBusy}
                onToggleFlag={toggleModuleFlag}
                resending={resending}
                exporting={exporting}
                onResend={resendInvite}
                onExport={exportOrg}
                onImpersonate={(o) => { setDetail(null); startImpersonate(o); }}
                onBack={() => setDetail(null)}
              />
            ) : (
              <AcademiesSection
                orgs={orgs}
                filteredOrgs={filteredOrgs}
                search={search}
                setSearch={setSearch}
                showCreate={showCreate}
                setShowCreate={setShowCreate}
                createForm={createForm}
                setCF={setCF}
                creating={creating}
                createAcademy={createAcademy}
                impersonating={impersonating}
                openDetail={openDetail}
                startImpersonate={startImpersonate}
                replayOnboarding={replayOnboarding}
                setOrgStatus={setOrgStatus}
                setOrgPlan={setOrgPlan}
                setOrgStudentLimit={setOrgStudentLimit}
              />
            )
          )}

          {section === 'plans' && (
            <PlansSection />
          )}

          {section === 'activity' && (
            <ActivitySection audit={audit} />
          )}

          {section === 'broadcast' && (
            <BroadcastSection
              orgs={orgs}
              broadcastForm={broadcastForm}
              setBF={setBF}
              broadcasting={broadcasting}
              sendBroadcast={sendBroadcast}
              broadcasts={broadcasts}
              broadcastsLoaded={broadcastsLoaded}
            />
          )}
        </div>
      </div>

      {/* Owner sign-in details to share (shown once, after create / reset) */}
      {credModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setCredModal(null)}>
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-5" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-semibold text-gray-900 mb-1">Share these sign-in details</h3>
            <p className="text-sm text-gray-600 mb-4">
              {credModal.password
                ? `Send these to the owner of ${credModal.academyName || 'the academy'} (e.g. on WhatsApp). The password is shown only once.`
                : `${credModal.academyName || 'The academy'} is linked to an existing account — they sign in with their current password.`}
            </p>
            <CredentialShare
              email={credModal.email}
              password={credModal.password}
              waLink={waSend(ownerCredMessage(credModal))}
              copyText={ownerCredMessage(credModal)}
              note={credModal.password ? 'Shown only once — copy or send it now.' : null}
            />
            <div className="flex justify-end pt-3 mt-3 border-t border-gray-100">
              <button onClick={() => setCredModal(null)} className="btn-secondary btn-sm">Done</button>
            </div>
          </div>
        </div>
      )}

      {/* Trial length picker — replaces the old window.prompt. */}
      {trialModal && (() => {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const minDate = new Date(today.getTime() + 86400000).toISOString().slice(0, 10);
        const maxDate = new Date(today.getTime() + 365 * 86400000).toISOString().slice(0, 10);
        const end = new Date(`${trialModal.date}T00:00:00`);
        const days = Math.round((end - today) / 86400000);
        const daysValid = Number.isFinite(days) && days >= 1 && days <= 365;
        const setDays = (n) => setTrialModal((m) => ({
          ...m,
          date: new Date(today.getTime() + n * 86400000).toISOString().slice(0, 10),
        }));
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/50" onClick={() => setTrialModal(null)} aria-hidden="true" />
            <div role="dialog" aria-modal="true" aria-label="Set trial length" className="relative w-full max-w-sm bg-white rounded-2xl shadow-xl overflow-hidden">
              <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
                <h3 className="font-semibold text-gray-900">Start trial for {trialModal.org.name}</h3>
                <button onClick={() => setTrialModal(null)} className="p-1.5 rounded-full hover:bg-gray-100" aria-label="Close">
                  <X className="w-4 h-4 text-gray-500" />
                </button>
              </div>
              <div className="px-5 py-4 space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Trial ends on</label>
                  <input
                    type="date"
                    value={trialModal.date}
                    min={minDate}
                    max={maxDate}
                    onChange={(e) => setTrialModal((m) => ({ ...m, date: e.target.value }))}
                    className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                  <p className="mt-1 text-xs text-gray-500">
                    {daysValid ? `${days} day${days === 1 ? '' : 's'} of full access from today.` : 'Pick a date between tomorrow and one year out.'}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {[7, 14, 30, 90].map((n) => (
                    <button
                      key={n}
                      onClick={() => setDays(n)}
                      className={`px-2.5 py-1 rounded-md text-xs font-medium border transition-colors ${
                        days === n ? 'bg-indigo-600 text-white border-indigo-600' : 'border-gray-300 text-gray-600 hover:bg-gray-100'
                      }`}
                    >
                      {n} days
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex items-center justify-end gap-2 px-5 py-4 bg-gray-50 border-t border-gray-100">
                <button onClick={() => setTrialModal(null)} className="btn-secondary btn-sm">Cancel</button>
                <button onClick={confirmTrial} disabled={!daysValid} className="btn-primary btn-sm disabled:opacity-50">Start trial</button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}

// ----------------------------------------------------------------------------
// Side-nav item
// ----------------------------------------------------------------------------
function NavItem({ icon: Icon, label, active, onClick, badge }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-colors ${
        active
          ? 'bg-brand-50 text-brand-700 ring-1 ring-brand-200'
          : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
      }`}
    >
      <Icon className="w-4 h-4 flex-shrink-0" />
      <span>{label}</span>
      {badge > 0 && (
        <span className={`ml-auto text-[11px] px-1.5 py-0.5 rounded-full font-semibold ${
          active ? 'bg-brand-100 text-brand-700' : 'bg-gray-100 text-gray-500'
        }`}>
          {badge}
        </span>
      )}
    </button>
  );
}

// Small stat tile used on the overview.
function StatTile({ icon: Icon, label, value, color }) {
  const colorMap = {
    indigo: 'bg-indigo-50 text-indigo-700 border-indigo-100',
    green:  'bg-green-50 text-green-700 border-green-100',
    amber:  'bg-amber-50 text-amber-700 border-amber-100',
  };
  return (
    <div className={`card flex items-center gap-3 border ${colorMap[color] || colorMap.indigo}`}>
      <Icon className="w-6 h-6 flex-shrink-0" />
      <div>
        <div className="text-2xl font-bold leading-tight">{value}</div>
        <div className="text-xs uppercase tracking-wide opacity-80">{label}</div>
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------------
// Plans section — read-only comparison of what each plan includes, plus the
// live prices. Both the catalog and prices come from the generated config
// (config.master.js → gen-config), so this always matches the public pricing
// sheet and the in-app gating.
// ----------------------------------------------------------------------------
function PlansSection() {
  const P = PLAN_PRICING || {};
  const cur = P.currency || '₹';
  const cats = Array.isArray(FEATURE_CATALOG) ? FEATURE_CATALOG : [];

  // Default price shape for a plan, falling back to empty numbers so the inputs
  // are always controlled.
  const PRICE_FIELDS = ['base', 'baseRegular', 'included', 'perStudent', 'perStudentRegular'];
  const defaultPrice = (plan) => {
    const d = (plan === 'core' ? P.core : P.complete) || {};
    const out = {};
    PRICE_FIELDS.forEach((f) => { out[f] = Number(d[f] || 0); });
    return out;
  };

  // Flat list of every feature with its default core/complete flags.
  const allItems = cats.flatMap((c) => c.items);

  const [loading, setLoading]   = useState(true);
  const [saving, setSaving]     = useState(false);
  const [error, setError]       = useState('');
  const [saved, setSaved]       = useState(false);   // true right after a successful save
  const [prices, setPrices]     = useState(() => ({ core: defaultPrice('core'), complete: defaultPrice('complete') }));
  const [features, setFeatures] = useState(() => {
    const m = {};
    allItems.forEach((it) => { m[it.key] = { core: !!it.core, complete: !!it.complete }; });
    return m;
  });

  // Build the working state by overlaying saved overrides on top of the config
  // defaults. Effective value = override if present, else default.
  const applyOverrides = (overrides) => {
    const ov = overrides || {};
    const ovPrices = ov.prices || {};
    const ovFeatures = ov.features || {};

    const nextPrices = { core: defaultPrice('core'), complete: defaultPrice('complete') };
    ['core', 'complete'].forEach((plan) => {
      const o = ovPrices[plan] || {};
      PRICE_FIELDS.forEach((f) => {
        if (o[f] != null) nextPrices[plan][f] = Number(o[f]);
      });
    });

    const nextFeatures = {};
    allItems.forEach((it) => {
      const o = ovFeatures[it.key] || {};
      nextFeatures[it.key] = {
        core: o.core != null ? !!o.core : !!it.core,
        complete: o.complete != null ? !!o.complete : !!it.complete,
      };
    });

    setPrices(nextPrices);
    setFeatures(nextFeatures);
  };

  const load = async () => {
    setLoading(true);
    setError('');
    setSaved(false);
    try {
      const res = await api.get('/platform/pricing');
      applyOverrides(res?.overrides);
    } catch (e) {
      setError('Could not load saved pricing: ' + e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const setPriceField = (plan, field, value) => {
    setSaved(false);
    setPrices((prev) => ({ ...prev, [plan]: { ...prev[plan], [field]: value === '' ? '' : Number(value) } }));
  };

  const toggleFeature = (key, plan) => {
    setSaved(false);
    setFeatures((prev) => ({ ...prev, [key]: { ...prev[key], [plan]: !prev[key]?.[plan] } }));
  };

  const handleSave = async () => {
    setSaving(true);
    setError('');
    setSaved(false);
    try {
      // Send the full working state: complete prices for both plans and every
      // feature's {core, complete}. Inherent rows are forced on below.
      const cleanPrices = {};
      ['core', 'complete'].forEach((plan) => {
        cleanPrices[plan] = {};
        PRICE_FIELDS.forEach((f) => { cleanPrices[plan][f] = Number(prices[plan]?.[f] || 0); });
      });
      const body = { prices: cleanPrices, features: {} };
      allItems.forEach((it) => {
        const inherent = it.enforce === 'inherent';
        const f = features[it.key] || {};
        body.features[it.key] = inherent
          ? { core: true, complete: true }
          : { core: !!f.core, complete: !!f.complete };
      });
      const res = await api.put('/platform/pricing', body);
      applyOverrides(res?.overrides);
      setSaved(true);
      toast.success('Pricing saved');
    } catch (e) {
      const msg = e?.message || 'Save failed';
      setError(msg);
      toast.error('Could not save pricing: ' + msg);
    } finally {
      setSaving(false);
    }
  };

  const money = (n) => cur + Number(n || 0).toLocaleString('en-IN');
  const coreCount = allItems.filter((it) => features[it.key]?.core).length;
  const completeCount = allItems.filter((it) => features[it.key]?.complete).length;
  const total = allItems.length;

  // Small inline editor for one plan's prices.
  const PriceEditor = ({ plan, name, accent }) => {
    const p = prices[plan] || {};
    const Field = ({ label, field, suffix }) => (
      <label className="block">
        <span className="text-xs font-medium text-gray-600">{label}</span>
        <div className="mt-1 flex items-center gap-1.5">
          <span className="text-sm text-gray-400">{cur}</span>
          <input
            type="number"
            min="0"
            inputMode="numeric"
            value={p[field] === '' ? '' : Number(p[field] || 0)}
            onChange={(e) => setPriceField(plan, field, e.target.value)}
            className="w-full rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-200"
          />
          {suffix ? <span className="text-xs text-gray-400 whitespace-nowrap">{suffix}</span> : null}
        </div>
      </label>
    );
    return (
      <div className={`card space-y-3 ${accent ? 'ring-1 ring-indigo-200' : ''}`}>
        <div className="flex items-baseline justify-between">
          <h3 className="font-semibold text-gray-900">{name}</h3>
          <div className="text-right">
            <span className="text-xl font-bold text-gray-900">{money(p.base)}</span>
            <span className="text-sm text-gray-500">/mo</span>
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Base price" field="base" suffix="/mo" />
          <Field label="Regular base (struck)" field="baseRegular" suffix="/mo" />
          <Field label="Included students" field="included" />
          <Field label="Per student" field="perStudent" suffix="/student" />
          <Field label="Per student regular (struck)" field="perStudentRegular" suffix="/student" />
        </div>
      </div>
    );
  };

  if (loading) {
    return (
      <div className="card flex items-center justify-center py-10">
        <Loader />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="card">
        <h2 className="text-lg font-bold text-gray-900">Plans and feature pricing</h2>
        <p className="text-sm text-gray-500 mt-0.5">
          Editing here saves to the platform store and updates in-app gating right away. The public
          pricing page updates on the next deploy (./deploy.sh pulls these in).
        </p>
      </div>

      {error ? (
        <div className="card border-red-200 bg-red-50 text-sm text-red-700">{error}</div>
      ) : null}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <PriceEditor plan="core" name="Core" />
        <PriceEditor plan="complete" name="Complete" accent />
      </div>

      <div className="card p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[420px]">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-4 py-3 font-semibold text-gray-700">Feature</th>
                <th className="px-4 py-3 text-center font-semibold text-gray-700 w-28">Core<div className="text-[11px] font-normal text-gray-400">{coreCount}/{total}</div></th>
                <th className="px-4 py-3 text-center font-semibold text-indigo-700 w-28">Complete<div className="text-[11px] font-normal text-gray-400">{completeCount}/{total}</div></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {cats.map((c) => (
                <Fragment key={c.name}>
                  <tr className="bg-gray-50/60">
                    <td colSpan={3} className="px-4 py-2 text-xs font-semibold uppercase tracking-wide text-gray-500">{c.name}</td>
                  </tr>
                  {c.items.map((it) => {
                    const inherent = it.enforce === 'inherent';
                    const f = features[it.key] || {};
                    return (
                      <tr key={it.key}>
                        <td className="px-4 py-2.5 text-gray-700">
                          {it.label}
                          {inherent ? <span className="ml-2 text-[11px] text-gray-400">always on</span> : null}
                        </td>
                        <td className="px-4 py-2.5 text-center">
                          <input
                            type="checkbox"
                            className="h-4 w-4 align-middle accent-indigo-600 disabled:opacity-50"
                            checked={inherent ? true : !!f.core}
                            disabled={inherent}
                            onChange={() => toggleFeature(it.key, 'core')}
                          />
                        </td>
                        <td className="px-4 py-2.5 text-center">
                          <input
                            type="checkbox"
                            className="h-4 w-4 align-middle accent-indigo-600 disabled:opacity-50"
                            checked={inherent ? true : !!f.complete}
                            disabled={inherent}
                            onChange={() => toggleFeature(it.key, 'complete')}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="sticky bottom-0 z-10 -mx-1 flex flex-col gap-2 rounded-xl border border-gray-200 bg-white/95 px-3 py-3 backdrop-blur sm:flex-row sm:items-center sm:justify-between">
        <div className="text-xs">
          {saved
            ? <span className="text-emerald-700">Saved. Run ./deploy.sh to publish to the public pricing page.</span>
            : <span className="text-gray-500">Inherent features stay on for both plans and cannot be toggled off.</span>}
        </div>
        <div className="flex items-center gap-2">
          <button type="button" className="btn-secondary btn-sm" onClick={load} disabled={saving}>
            Reset to saved
          </button>
          <button type="button" className="btn-primary btn-sm" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------------
// Overview section — stat tiles, revenue, funnel, trial watch.
// ----------------------------------------------------------------------------
function OverviewSection({ orgs, stats, revenue, funnel, engagement, trialWatch, trialWatchDays, onExtendTrial, onOpenOrg }) {
  // Quiet academies: no recorded activity for 14+ days, and old enough that the
  // quiet stretch is meaningful (skip ones that only just signed up). Sorted by
  // longest idle first so the academies most at risk of lapsing lead.
  const QUIET_DAYS = 14;
  const quiet = (engagement || [])
    .filter((e) => e.days_idle != null && e.days_idle >= QUIET_DAYS && (e.age_days == null || e.age_days >= QUIET_DAYS))
    .slice(0, 8);

  return (
    <div className="space-y-4">
      {/* Stat tiles */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <StatTile icon={Building2} label="Total orgs" value={orgs.length} color="indigo" />
        <StatTile icon={TrendingUp} label="Active" value={stats.active} color="green" />
        <StatTile icon={UsersIcon} label="Total members" value={stats.totalMembers} color="amber" />
      </div>

      {/* Revenue + activation funnel */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {/* Estimated MRR */}
        <div className="card space-y-3">
          <div className="flex items-center gap-2">
            <IndianRupee className="w-5 h-5 text-emerald-600" />
            <h3 className="font-semibold text-gray-800">Revenue snapshot</h3>
            <span className="text-xs text-gray-400">estimated</span>
          </div>
          <div>
            <div className="text-3xl font-bold text-gray-900 leading-tight">
              ₹{revenue.mrr.toLocaleString('en-IN')}<span className="text-base font-medium text-gray-400">/mo</span>
            </div>
            <p className="text-xs text-gray-500">Active students × plan price (Core ₹50, Complete ₹100).</p>
          </div>
          <div className="grid grid-cols-4 gap-2 text-center">
            <div className="rounded-lg bg-gray-100 px-2 py-1.5">
              <div className="text-lg font-semibold text-gray-800">{revenue.paid}</div>
              <div className="text-[11px] text-gray-500">Paid</div>
            </div>
            <div className="rounded-lg bg-gray-100 px-2 py-1.5">
              <div className="text-lg font-semibold text-gray-800">{revenue.trial}</div>
              <div className="text-[11px] text-gray-500">Trial</div>
            </div>
            <div className="rounded-lg bg-gray-100 px-2 py-1.5">
              <div className="text-lg font-semibold text-gray-800">{revenue.free}</div>
              <div className="text-[11px] text-gray-500">Free</div>
            </div>
            <div className="rounded-lg bg-emerald-50 border border-emerald-100 px-2 py-1.5">
              <div className="text-lg font-semibold text-emerald-700">{revenue.conversion}%</div>
              <div className="text-[11px] text-emerald-600">Convert</div>
            </div>
          </div>
        </div>

        {/* Activation funnel */}
        <div className="card space-y-3">
          <div className="flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-indigo-600" />
            <h3 className="font-semibold text-gray-800">Activation funnel</h3>
          </div>
          {!funnel ? (
            <p className="text-sm text-gray-500">Funnel metrics unavailable.</p>
          ) : (() => {
            const steps = [
              { label: 'Signed up',         value: funnel.signed_up },
              { label: 'Finished setup',    value: funnel.finished_setup },
              { label: 'Added a student',   value: funnel.added_student },
              { label: 'Marked attendance', value: funnel.marked_attendance },
            ];
            const top = funnel.signed_up || 0;
            return (
              <div className="space-y-2">
                {steps.map((s) => {
                  const pct = top > 0 ? Math.round((s.value / top) * 100) : 0;
                  return (
                    <div key={s.label}>
                      <div className="flex items-center justify-between text-xs mb-0.5">
                        <span className="text-gray-600">{s.label}</span>
                        <span className="text-gray-500 font-medium">{s.value} · {pct}%</span>
                      </div>
                      <div className="h-2 rounded-full bg-gray-100 overflow-hidden">
                        <div className="h-full bg-indigo-500 rounded-full" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })()}
        </div>
      </div>

      {/* Trial watchlist — trials that have lapsed or end within a week. */}
      {trialWatch.length > 0 && (
        <div className="card border-amber-200 bg-amber-50/60 space-y-3">
          <div className="flex items-center gap-2">
            <Clock className="w-5 h-5 text-amber-700 flex-shrink-0" />
            <div>
              <p className="font-medium text-amber-900">Trials needing attention</p>
              <p className="text-xs text-amber-700">
                Academies whose trial has ended or ends within {trialWatchDays} days. Renew to keep full access on.
              </p>
            </div>
          </div>
          <div className="space-y-1.5">
            {trialWatch.map((o) => (
              <div key={o.id} className="flex items-center justify-between gap-3 rounded-lg bg-white border border-amber-100 px-3 py-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="font-medium text-gray-900 truncate">{o.name}</span>
                  <span className={`text-[11px] px-2 py-0.5 rounded-full font-medium flex-shrink-0 ${o.trial.expired ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}`}>
                    {o.trial.expired
                      ? 'Expired'
                      : o.trial.daysLeft === 0
                        ? 'Ends today'
                        : `${o.trial.daysLeft} day${o.trial.daysLeft === 1 ? '' : 's'} left`}
                  </span>
                </div>
                <Tooltip label="Set a new trial end date for this academy">
                  <button
                    onClick={() => onExtendTrial(o)}
                    className="btn-sm rounded-md px-2.5 py-1 text-xs bg-amber-600 text-white hover:bg-amber-700 flex items-center gap-1 flex-shrink-0"
                  >
                    <Clock className="w-3.5 h-3.5" /> Extend trial
                  </button>
                </Tooltip>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Quiet academies — no recorded activity for a couple of weeks or more.
          A nudge to check in before they drift away. */}
      {quiet.length > 0 && (
        <div className="card space-y-3">
          <div className="flex items-center gap-2">
            <Activity className="w-5 h-5 text-rose-600 flex-shrink-0" />
            <div>
              <p className="font-medium text-gray-800">Quiet academies</p>
              <p className="text-xs text-gray-500">
                No attendance, payments, messages or new students for {QUIET_DAYS}+ days. A good moment to reach out.
              </p>
            </div>
          </div>
          <div className="space-y-1.5">
            {quiet.map((e) => (
              <button
                key={e.id}
                onClick={() => onOpenOrg?.(e.id)}
                className="w-full flex items-center justify-between gap-3 rounded-lg border border-gray-200 px-3 py-2 text-left hover:bg-gray-50 transition-colors"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span className="font-medium text-gray-900 truncate">{e.name}</span>
                  <span className="text-[11px] px-2 py-0.5 rounded-full font-medium flex-shrink-0 bg-rose-100 text-rose-700">
                    {e.days_idle} days quiet
                  </span>
                </div>
                <span className="text-xs text-gray-400 flex-shrink-0">
                  {e.last_active_at
                    ? `last active ${new Date(e.last_active_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}`
                    : 'no activity yet'}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ----------------------------------------------------------------------------
// Academies section — create form, search, orgs table.
// ----------------------------------------------------------------------------
function AcademiesSection({
  orgs, filteredOrgs, search, setSearch, showCreate, setShowCreate, createForm, setCF,
  creating, createAcademy, impersonating, openDetail, startImpersonate, replayOnboarding,
  setOrgStatus, setOrgPlan, setOrgStudentLimit,
}) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="font-semibold text-gray-800">Academies</h3>
        <button onClick={() => setShowCreate((v) => !v)} className="btn-primary btn-sm">
          {showCreate ? <X className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
          {showCreate ? 'Cancel' : 'Create academy'}
        </button>
      </div>

      {/* Invite a new academy (invite-only signup) */}
      {showCreate && (
        <form onSubmit={createAcademy} className="card border-indigo-100 bg-indigo-50/40 space-y-4">
          <div className="flex items-start gap-2">
            <Mail className="w-5 h-5 text-indigo-600 mt-0.5 flex-shrink-0" />
            <div>
              <p className="font-medium text-gray-900">Invite a new academy</p>
              <p className="text-sm text-gray-500">
                We'll create the org and email the owner a link to set their password. They land in their
                own admin app on first sign-in.
              </p>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="sm:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">Academy name</label>
              <input type="text" value={createForm.academy_name} onChange={setCF('academy_name')}
                className="input-field" placeholder="e.g. Sangeet Sadhana" autoFocus required />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Owner first name</label>
              <input type="text" value={createForm.first_name} onChange={setCF('first_name')}
                className="input-field" placeholder="First name" required />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Owner last name</label>
              <input type="text" value={createForm.last_name} onChange={setCF('last_name')}
                className="input-field" placeholder="Optional" />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">Owner email</label>
              <input type="email" value={createForm.owner_email} onChange={setCF('owner_email')}
                className="input-field" placeholder="owner@example.com" required />
            </div>
          </div>
          <div className="flex justify-end">
            <button type="submit" disabled={creating} className="btn-primary disabled:opacity-50">
              {creating ? <><Loader2 className="w-4 h-4 animate-spin" /> Creating...</> : <><Plus className="w-4 h-4" /> Create & send invite</>}
            </button>
          </div>
        </form>
      )}

      {/* Search bar */}
      {orgs.length > 0 && (
        <div className="relative">
          <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name, slug, owner ID..."
            className="input-field pl-9"
          />
        </div>
      )}

      {/* Orgs list */}
      {filteredOrgs.length === 0 ? (
        <EmptyState
          icon={Building2}
          title={search ? 'No matching orgs' : 'No orgs yet'}
          message={search ? 'Try a different search term.' : 'Once academies sign up, they\'ll appear here.'}
        />
      ) : (
        <div className="card p-0 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="table-header">Org</th>
                  <th className="table-header">Slug</th>
                  <th className="table-header text-right">Members</th>
                  <th className="table-header text-right">Students</th>
                  <th className="table-header">Plan</th>
                  <th className="table-header">Status</th>
                  <th className="table-header">Created</th>
                  <th className="table-header text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filteredOrgs.map((o) => (
                  <tr key={o.id} className="hover:bg-gray-50 transition-colors">
                    <td className="table-cell font-medium text-gray-900">
                      <Tooltip label="Open this academy's detail panel">
                        <button
                          type="button"
                          onClick={() => openDetail(o)}
                          className="flex items-center gap-2 text-left hover:text-indigo-700 transition-colors"
                        >
                          <div className="w-8 h-8 rounded-lg bg-indigo-100 text-indigo-700 flex items-center justify-center text-sm font-semibold flex-shrink-0">
                            {(o.name || '?').slice(0, 1).toUpperCase()}
                          </div>
                          <span className="underline-offset-2 hover:underline">{o.name}</span>
                        </button>
                      </Tooltip>
                    </td>
                    <td className="table-cell font-mono text-xs text-gray-500">{o.slug}</td>
                    <td className="table-cell text-right font-medium">{o.member_count || 0}</td>
                    <td className="table-cell text-right font-medium">
                      {(() => {
                        const cap = o.max_students;            // effective cap (null = ∞)
                        const used = o.student_count || 0;
                        const over = cap != null && used >= cap;
                        const planDefault = o.plan_max_students; // null = ∞
                        return (
                          <div className="flex items-center justify-end gap-1">
                            <span className={over ? 'text-red-600' : 'text-gray-700'}>{used}</span>
                            <span className="text-gray-400">/</span>
                            <Tooltip label="Custom student cap — leave blank for the plan default">
                              <input
                                type="number"
                                min="0"
                                defaultValue={o.max_students_override ?? ''}
                                placeholder={planDefault == null ? '∞' : String(planDefault)}
                                onBlur={(e) => setOrgStudentLimit(o, e.target.value)}
                                onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur(); }}
                                className="w-14 text-xs text-right rounded-md border border-gray-200 bg-white px-1.5 py-1 font-medium text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                              />
                            </Tooltip>
                          </div>
                        );
                      })()}
                    </td>
                    <td className="table-cell">
                      <Tooltip label="Trial and Complete unlock online learning; Free caps active students at 2">
                        <select
                          value={['trial', 'free', 'core', 'complete'].includes(o.plan) ? o.plan : 'legacy'}
                          onChange={(e) => setOrgPlan(o, e.target.value)}
                          className="text-xs rounded-md border border-gray-200 bg-white px-2 py-1 font-medium text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                        >
                          <option value="trial">Trial (14-day full access)</option>
                          <option value="free">Free (2 students)</option>
                          <option value="core">Core</option>
                          <option value="complete">Complete</option>
                          {!['trial', 'free', 'core', 'complete'].includes(o.plan) && (
                            <option value="legacy" disabled>{o.plan || 'free'} (legacy · full access)</option>
                          )}
                        </select>
                      </Tooltip>
                      {o.trial && (
                        <div className={`mt-1 text-[11px] ${o.trial.expired ? 'text-red-600' : 'text-amber-600'}`}>
                          {o.trial.expired
                            ? 'Trial expired → Free'
                            : o.trial.daysLeft != null
                              ? `${o.trial.daysLeft} day${o.trial.daysLeft === 1 ? '' : 's'} left`
                              : 'On trial'}
                        </div>
                      )}
                    </td>
                    <td className="table-cell">
                      <span className={
                        o.status === 'active' ? 'badge-active'
                        : o.status === 'suspended' ? 'bg-red-100 text-red-700 px-2 py-0.5 rounded-full text-xs font-medium'
                        : 'badge-inactive'
                      }>
                        {o.status || 'active'}
                      </span>
                    </td>
                    <td className="table-cell text-xs text-gray-500">
                      {o.created_at
                        ? new Date(o.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
                        : '-'}
                    </td>
                    <td className="table-cell text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Tooltip label="Record totals, members and plan">
                          <button
                            onClick={() => openDetail(o)}
                            className="btn-sm rounded-md px-2 py-1 text-xs bg-gray-100 text-gray-700 border border-gray-200 hover:bg-gray-200 flex items-center gap-1"
                          >
                            <BarChart3 className="w-3.5 h-3.5" /> Details
                          </button>
                        </Tooltip>
                        <Tooltip label="View the app as this org">
                          <button
                            onClick={() => startImpersonate(o)}
                            disabled={String(impersonating) === String(o.id)}
                            className="btn-sm rounded-md px-2 py-1 text-xs bg-indigo-50 text-indigo-700 border border-indigo-200 hover:bg-indigo-100 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1"
                          >
                            <Eye className="w-3.5 h-3.5" /> View
                          </button>
                        </Tooltip>
                        <Tooltip label="Show the welcome tour again on next sign-in">
                          <button
                            onClick={() => replayOnboarding(o)}
                            className="btn-sm rounded-md px-2 py-1 text-xs bg-gray-100 text-gray-700 border border-gray-200 hover:bg-gray-200 inline-flex items-center gap-1 whitespace-nowrap"
                          >
                            <RotateCcw className="w-3.5 h-3.5 flex-shrink-0" /> Replay tour
                          </button>
                        </Tooltip>
                        {o.status === 'suspended' ? (
                          <Tooltip label="Reactivate this org">
                            <button
                              onClick={() => setOrgStatus(o, 'active')}
                              className="btn-sm rounded-md px-2 py-1 text-xs bg-green-50 text-green-700 border border-green-200 hover:bg-green-100 flex items-center gap-1"
                            >
                              <Play className="w-3.5 h-3.5" /> Reactivate
                            </button>
                          </Tooltip>
                        ) : (
                          <Tooltip label="Lock this org's members out immediately">
                            <button
                              onClick={() => setOrgStatus(o, 'suspended')}
                              className="btn-sm rounded-md px-2 py-1 text-xs bg-red-50 text-red-600 border border-red-200 hover:bg-red-100 flex items-center gap-1"
                            >
                              <Pause className="w-3.5 h-3.5" /> Suspend
                            </button>
                          </Tooltip>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="px-4 py-3 bg-gray-50 border-t border-gray-200 text-sm text-gray-500">
            {filteredOrgs.length} of {orgs.length} orgs
          </div>
        </div>
      )}
    </div>
  );
}

// ----------------------------------------------------------------------------
// Inline per-org detail panel (replaces the table while open). Record counts,
// members with a Show-contact reveal, plan-change history, module toggles.
// ----------------------------------------------------------------------------
function DetailPanel({
  detail, detailLoading, piiBusy, piiShown, onReveal, flagBusy, onToggleFlag,
  resending, exporting, onResend, onExport, onImpersonate, onBack,
}) {
  const d = detail.org || {};
  const counts = detail.counts || [];
  const members = detail.members || [];
  const history = detail.history || [];
  const totalRecords = counts.reduce((s, c) => s + (Number(c.count) || 0), 0);
  const planLabel = PLAN_LABELS[d.effective_plan] || d.effective_plan || d.plan || '-';
  const roleOrder = { owner: 0, admin: 1, teacher: 2 };
  const sortedMembers = [...members].sort(
    (a, b) => (roleOrder[a.role] ?? 9) - (roleOrder[b.role] ?? 9)
  );

  return (
    <div className="space-y-4">
      {/* Back + identity header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <button onClick={onBack} className="btn-secondary btn-sm">
          <ChevronLeft className="w-4 h-4" /> Academies
        </button>
        <div className="flex items-center gap-2">
          <Tooltip label="Email the owner a fresh password link">
            <button
              onClick={() => onResend(detail.org)}
              disabled={resending}
              className="btn-sm rounded-md px-2.5 py-1.5 text-xs bg-gray-100 text-gray-700 border border-gray-200 hover:bg-gray-200 flex items-center gap-1 disabled:opacity-50"
            >
              {resending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Mail className="w-3.5 h-3.5" />}
              Resend owner access
            </button>
          </Tooltip>
          <Tooltip label="Download this academy's data as JSON">
            <button
              onClick={() => onExport(detail.org)}
              disabled={exporting}
              className="btn-sm rounded-md px-2.5 py-1.5 text-xs bg-gray-100 text-gray-700 border border-gray-200 hover:bg-gray-200 flex items-center gap-1 disabled:opacity-50"
            >
              {exporting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
              Export data
            </button>
          </Tooltip>
          <button
            onClick={() => onImpersonate(detail.org)}
            className="btn-secondary btn-sm flex items-center gap-1"
          >
            <Eye className="w-3.5 h-3.5" /> View as this org
          </button>
        </div>
      </div>

      <div className="card space-y-5">
        {/* Identity */}
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-10 h-10 rounded-lg bg-indigo-100 text-indigo-700 flex items-center justify-center text-base font-semibold flex-shrink-0">
            {(d.name || '?').slice(0, 1).toUpperCase()}
          </div>
          <div className="min-w-0">
            <h3 className="font-semibold text-gray-900 truncate">{d.name}</h3>
            <p className="text-xs font-mono text-gray-500 truncate">{d.slug}</p>
          </div>
        </div>

        {/* Plan / status summary */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="rounded-lg bg-gray-100 px-3 py-2">
            <div className="text-[11px] uppercase tracking-wide text-gray-400">Plan</div>
            <div className="text-sm font-semibold text-gray-800 capitalize">{planLabel}</div>
          </div>
          <div className="rounded-lg bg-gray-100 px-3 py-2">
            <div className="text-[11px] uppercase tracking-wide text-gray-400">Status</div>
            <div className="text-sm font-semibold text-gray-800 capitalize">{d.status || 'active'}</div>
          </div>
          <div className="rounded-lg bg-gray-100 px-3 py-2">
            <div className="text-[11px] uppercase tracking-wide text-gray-400">Members</div>
            <div className="text-sm font-semibold text-gray-800">{d.member_count ?? members.length}</div>
          </div>
          <div className="rounded-lg bg-gray-100 px-3 py-2">
            <div className="text-[11px] uppercase tracking-wide text-gray-400">Created</div>
            <div className="text-sm font-semibold text-gray-800">
              {d.created_at
                ? new Date(d.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
                : '-'}
            </div>
          </div>
        </div>

        {d.trial && (
          <div className={`rounded-lg px-3 py-2 text-sm ${d.trial.expired ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-700'}`}>
            {d.trial.expired
              ? 'Trial has ended — now on the Free plan.'
              : d.trial.daysLeft != null
                ? `Trial: ${d.trial.daysLeft} day${d.trial.daysLeft === 1 ? '' : 's'} of full access left.`
                : 'On trial.'}
          </div>
        )}

        {/* Module-wise record counts */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-sm font-semibold text-gray-800">Records by module</h4>
            <span className="text-xs text-gray-500">{totalRecords.toLocaleString('en-IN')} total</span>
          </div>
          {detailLoading && !detail.counts ? (
            <div className="flex items-center gap-2 text-sm text-gray-500 py-4">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading record totals…
            </div>
          ) : counts.length === 0 ? (
            <p className="text-sm text-gray-500 py-2">No modules to report.</p>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {counts.map((c) => (
                <div key={c.key} className="rounded-lg border border-gray-200 px-3 py-2 flex items-center justify-between">
                  <span className="text-xs text-gray-600 truncate pr-2">{c.label}</span>
                  <span className={`text-sm font-semibold ${c.count == null ? 'text-gray-300' : 'text-gray-900'}`}>
                    {c.count == null ? '-' : Number(c.count).toLocaleString('en-IN')}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Members + Show-contact reveal */}
        <div>
          <div className="flex items-center justify-between mb-2 gap-2">
            <h4 className="text-sm font-semibold text-gray-800">Members</h4>
            {sortedMembers.length > 0 && (
              piiShown ? (
                <span className="inline-flex items-center gap-1 text-[11px] text-gray-400">
                  <Eye className="w-3.5 h-3.5" /> Contact details shown
                </span>
              ) : (
                <Tooltip label="Reveal member names and emails (this view is audited)">
                  <button
                    onClick={onReveal}
                    disabled={piiBusy}
                    className="btn-sm rounded-md px-2.5 py-1 text-xs bg-gray-100 text-gray-700 border border-gray-200 hover:bg-gray-200 inline-flex items-center gap-1 disabled:opacity-50"
                  >
                    {piiBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <EyeOff className="w-3.5 h-3.5" />}
                    Show contact details
                  </button>
                </Tooltip>
              )
            )}
          </div>
          {detailLoading && !detail.members ? (
            <div className="flex items-center gap-2 text-sm text-gray-500 py-2">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading members…
            </div>
          ) : sortedMembers.length === 0 ? (
            <p className="text-sm text-gray-500 py-2">No members recorded.</p>
          ) : (
            <div className="space-y-1.5">
              {sortedMembers.map((m, i) => (
                <div key={`${m.user_id}-${i}`} className="flex items-center justify-between rounded-lg border border-gray-200 px-3 py-2 gap-2">
                  <div className="min-w-0">
                    {piiShown && (m.name || m.email) ? (
                      <>
                        <div className="text-sm font-medium text-gray-900 truncate">{m.name || '(no name)'}</div>
                        <div className="text-xs text-gray-500 truncate">{m.email || m.user_id}</div>
                      </>
                    ) : (
                      <span className="text-sm font-mono text-gray-600 truncate">{m.user_id}</span>
                    )}
                  </div>
                  <span className="flex items-center gap-2 flex-shrink-0">
                    <span className="text-xs font-medium text-gray-700 capitalize">{m.role}</span>
                    <span className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${m.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>
                      {m.status || 'active'}
                    </span>
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Plan-change history */}
        <div>
          <div className="flex items-center gap-2 mb-2">
            <History className="w-4 h-4 text-gray-500" />
            <h4 className="text-sm font-semibold text-gray-800">Plan change history</h4>
          </div>
          {detailLoading && !detail.history ? (
            <div className="flex items-center gap-2 text-sm text-gray-500 py-2">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading history…
            </div>
          ) : history.length === 0 ? (
            <p className="text-sm text-gray-500 py-2">No plan changes recorded yet.</p>
          ) : (
            <ul className="space-y-1.5">
              {history.map((h) => (
                <li key={h.id} className="flex items-center justify-between rounded-lg border border-gray-200 px-3 py-2 gap-3">
                  <span className="text-sm text-gray-800 truncate">
                    {auditDetailText(h) || 'Plan changed'}
                  </span>
                  <span className="text-xs text-gray-400 flex-shrink-0">
                    {h.created_at
                      ? new Date(h.created_at).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
                      : ''}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Module toggles — enable/disable a feature for this academy. */}
        <div>
          <div className="flex items-center gap-2 mb-2">
            <ToggleLeft className="w-4 h-4 text-gray-500" />
            <h4 className="text-sm font-semibold text-gray-800">Modules</h4>
          </div>
          {detailLoading && !detail.module_flags ? (
            <div className="flex items-center gap-2 text-sm text-gray-500 py-2">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading modules…
            </div>
          ) : (detail.module_flags || []).length === 0 ? (
            <p className="text-sm text-gray-500 py-2">No modules to configure.</p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {(detail.module_flags || []).map((f) => (
                <button
                  key={f.key}
                  onClick={() => onToggleFlag(f.key)}
                  disabled={flagBusy === f.key}
                  className="flex items-center justify-between rounded-lg border border-gray-200 px-3 py-2 hover:bg-gray-100 disabled:opacity-60 text-left"
                >
                  <span className="text-sm text-gray-700 flex items-center gap-1.5 min-w-0">
                    <span className="truncate">{f.label}</span>
                    {f.premium && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-indigo-50 text-indigo-600 flex-shrink-0">Premium</span>}
                  </span>
                  <span className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors flex-shrink-0 ${f.enabled ? 'bg-emerald-500' : 'bg-gray-300'}`}>
                    <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${f.enabled ? 'translate-x-4' : 'translate-x-1'}`} />
                  </span>
                </button>
              ))}
            </div>
          )}
          <p className="mt-1.5 text-[11px] text-gray-400">Premium modules also need the right plan to appear for the academy.</p>
        </div>
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------------
// Activity section — cross-org platform-admin audit log.
// ----------------------------------------------------------------------------
function ActivitySection({ audit }) {
  return (
    <div className="card p-0 overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-100">
        <ScrollText className="w-5 h-5 text-gray-500" />
        <h3 className="font-semibold text-gray-800">Activity log</h3>
        <span className="text-xs text-gray-400">recent platform actions</span>
      </div>
      {!audit.available ? (
        <div className="px-4 py-6 text-sm text-gray-500">
          The audit log is not set up yet. Create an <code className="font-mono text-gray-700">AuditLog</code> table
          in Supabase (SQL editor) and actions you take here will start being recorded.
        </div>
      ) : audit.entries.length === 0 ? (
        <div className="px-4 py-6 text-sm text-gray-500">No activity recorded yet.</div>
      ) : (
        <ul className="divide-y divide-gray-100">
          {audit.entries.map((a) => (
            <li key={a.id} className="px-4 py-2.5 flex items-start gap-3">
              <span className="mt-0.5 text-[11px] font-medium px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 flex-shrink-0">
                {AUDIT_LABELS[a.action] || a.action}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm text-gray-800 truncate">
                  {a.target_org_name || (a.target_org_id ? `Org ${a.target_org_id}` : '—')}
                  {auditDetailText(a) && <span className="text-gray-500"> · {auditDetailText(a)}</span>}
                </p>
                <p className="text-xs text-gray-400">
                  {a.actor_email || a.actor_user_id || 'unknown'}
                  {a.created_at && ` · ${new Date(a.created_at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}`}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ----------------------------------------------------------------------------
// Search section — one box across every tenant: academies plus students and
// their parent/contact. Each people result links back to its academy.
// ----------------------------------------------------------------------------
function SearchSection({ searchQ, setSearchQ, runSearch, searchBusy, results, onOpenOrg }) {
  const submit = (e) => { e.preventDefault(); runSearch(searchQ); };
  const academies = results?.academies || [];
  const people = results?.people || [];
  const hasResults = academies.length > 0 || people.length > 0;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="font-semibold text-gray-800">Global search</h3>
      </div>

      <form onSubmit={submit} className="flex gap-2">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQ}
            onChange={(e) => setSearchQ(e.target.value)}
            placeholder="Academy, student, parent, or mobile number..."
            className="input-field pl-9"
            autoFocus
          />
        </div>
        <button type="submit" disabled={searchBusy || searchQ.trim().length < 2} className="btn-primary disabled:opacity-50">
          {searchBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
          Search
        </button>
      </form>
      <p className="text-xs text-gray-500 px-1 -mt-1">
        Find an academy by name or slug, or a student or parent by name or mobile number.
      </p>

      {results && !searchBusy && (
        !hasResults ? (
          <EmptyState icon={Search} title="No matches" message="Try a different name, slug, or number." />
        ) : (
          <div className="space-y-4">
            {academies.length > 0 && (
              <div className="card p-0 overflow-hidden">
                <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-100">
                  <Building2 className="w-4 h-4 text-gray-500" />
                  <h3 className="font-semibold text-gray-800">Academies</h3>
                  <span className="text-xs text-gray-400">{academies.length}</span>
                </div>
                <ul className="divide-y divide-gray-100">
                  {academies.map((a) => (
                    <li key={a.id}>
                      <button onClick={() => onOpenOrg?.(a.id)} className="w-full flex items-center justify-between gap-3 px-4 py-2.5 text-left hover:bg-gray-50 transition-colors">
                        <div className="flex items-center gap-2 min-w-0">
                          <div className="w-7 h-7 rounded-lg bg-indigo-100 text-indigo-700 flex items-center justify-center text-xs font-semibold flex-shrink-0">
                            {(a.name || '?').slice(0, 1).toUpperCase()}
                          </div>
                          <span className="font-medium text-gray-900 truncate">{a.name}</span>
                          <span className="font-mono text-xs text-gray-400 truncate">{a.slug}</span>
                        </div>
                        <span className="text-xs text-gray-500 capitalize flex-shrink-0">{a.plan || a.status}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {people.length > 0 && (
              <div className="card p-0 overflow-hidden">
                <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-100">
                  <UsersIcon className="w-4 h-4 text-gray-500" />
                  <h3 className="font-semibold text-gray-800">Students &amp; parents</h3>
                  <span className="text-xs text-gray-400">{people.length}</span>
                </div>
                <ul className="divide-y divide-gray-100">
                  {people.map((p) => (
                    <li key={p.id} className="px-4 py-2.5 flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-gray-900 truncate">{p.name || '(no name)'}</div>
                        <div className="text-xs text-gray-500 truncate">
                          {[p.parent_name, p.mobile_number].filter(Boolean).join(' · ') || '—'}
                        </div>
                      </div>
                      <button
                        onClick={() => onOpenOrg?.(p.org_id)}
                        className="text-xs text-indigo-600 hover:text-indigo-700 font-medium flex-shrink-0 truncate max-w-[40%] text-right"
                        title={`Open ${p.org_name}`}
                      >
                        {p.org_name}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )
      )}
    </div>
  );
}

// ----------------------------------------------------------------------------
// Requests (leads) section — inbound contact-form submissions from the public
// landing page. Each request moves through a follow-up pipeline.
// ----------------------------------------------------------------------------
// The pipeline order. The "track" the owner asked for: form filled -> called
// -> signed up -> invited -> under trial -> won | lost.
const LEAD_STATUSES = ['new', 'called', 'signed_up', 'invited', 'trial', 'won', 'lost'];
const LEAD_LABEL = {
  new: 'New',
  called: 'Called',
  signed_up: 'Signed up',
  invited: 'Invited',
  trial: 'On trial',
  won: 'Won',
  lost: 'Lost',
};
const LEAD_BADGE = {
  new:       'bg-indigo-100 text-indigo-700',
  called:    'bg-sky-100 text-sky-700',
  signed_up: 'bg-violet-100 text-violet-700',
  invited:   'bg-amber-100 text-amber-700',
  trial:     'bg-teal-100 text-teal-700',
  won:       'bg-green-100 text-green-700',
  lost:      'bg-gray-100 text-gray-500',
};

// ----------------------------------------------------------------------------
// Billing section — a lightweight invoice ledger per academy. Records what is
// owed and lets you mark invoices paid; charging itself is not wired yet.
// ----------------------------------------------------------------------------
const INVOICE_BADGE = {
  pending: 'bg-amber-100 text-amber-700',
  paid:    'bg-green-100 text-green-700',
  void:    'bg-gray-100 text-gray-500',
};
function BillingSection({ orgs, invoices, available, loaded, invoiceForm, setIF, invoiceBusy, createInvoice, setInvoiceStatus }) {
  const outstanding = invoices
    .filter((i) => i.status === 'pending')
    .reduce((s, i) => s + (Number(i.amount) || 0), 0);
  const collected = invoices
    .filter((i) => i.status === 'paid')
    .reduce((s, i) => s + (Number(i.amount) || 0), 0);

  if (!loaded) return <Loader text="Loading invoices..." />;

  if (!available) {
    return (
      <div className="card flex items-start gap-3">
        <Receipt className="w-5 h-5 text-gray-500 mt-0.5 flex-shrink-0" />
        <div className="text-sm text-gray-600">
          <p className="font-medium text-gray-800">Billing ledger not set up yet</p>
          <p className="mt-1">
            Create an <code className="font-mono text-gray-700">Invoices</code> table in Supabase (SQL editor)
            with columns <code className="font-mono text-gray-700">org_id</code> (bigint),
            {' '}<code className="font-mono text-gray-700">amount</code> (double),
            {' '}<code className="font-mono text-gray-700">period</code>, <code className="font-mono text-gray-700">status</code>,
            {' '}<code className="font-mono text-gray-700">due_date</code>, <code className="font-mono text-gray-700">paid_at</code>,
            {' '}and <code className="font-mono text-gray-700">notes</code> (varchar). The ledger turns on once it exists.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Totals */}
      <div className="grid grid-cols-2 gap-3">
        <div className="card flex items-center gap-3 border border-amber-100 bg-amber-50 text-amber-700">
          <Receipt className="w-6 h-6 flex-shrink-0" />
          <div>
            <div className="text-2xl font-bold leading-tight">₹{outstanding.toLocaleString('en-IN')}</div>
            <div className="text-xs uppercase tracking-wide opacity-80">Outstanding</div>
          </div>
        </div>
        <div className="card flex items-center gap-3 border border-green-100 bg-green-50 text-green-700">
          <CheckCircle2 className="w-6 h-6 flex-shrink-0" />
          <div>
            <div className="text-2xl font-bold leading-tight">₹{collected.toLocaleString('en-IN')}</div>
            <div className="text-xs uppercase tracking-wide opacity-80">Collected</div>
          </div>
        </div>
      </div>

      {/* Add invoice */}
      <form onSubmit={createInvoice} className="card space-y-3">
        <div className="flex items-center gap-2">
          <Plus className="w-4 h-4 text-indigo-600" />
          <h3 className="font-semibold text-gray-800">Record an invoice</h3>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Academy</label>
            <select value={invoiceForm.org_id} onChange={setIF('org_id')} className="input-field" required>
              <option value="">Pick an academy</option>
              {orgs.map((o) => <option key={o.id} value={String(o.id)}>{o.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Amount (₹)</label>
            <input type="number" min="0" step="1" value={invoiceForm.amount} onChange={setIF('amount')} className="input-field" placeholder="e.g. 1500" required />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Period</label>
            <input type="text" value={invoiceForm.period} onChange={setIF('period')} className="input-field" placeholder="e.g. Jun 2026" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Due date</label>
            <input type="date" value={invoiceForm.due_date} onChange={setIF('due_date')} className="input-field" />
          </div>
          <div className="sm:col-span-2">
            <label className="block text-sm font-medium text-gray-700 mb-1">Notes (optional)</label>
            <input type="text" value={invoiceForm.notes} onChange={setIF('notes')} className="input-field" placeholder="Memo for this invoice" />
          </div>
        </div>
        <div className="flex justify-end">
          <button type="submit" disabled={invoiceBusy === 'new'} className="btn-primary disabled:opacity-50">
            {invoiceBusy === 'new' ? <><Loader2 className="w-4 h-4 animate-spin" /> Adding...</> : <><Plus className="w-4 h-4" /> Add invoice</>}
          </button>
        </div>
      </form>

      {/* Ledger */}
      {invoices.length === 0 ? (
        <EmptyState icon={Receipt} title="No invoices yet" message="Record one above to start tracking what each academy owes." />
      ) : (
        <div className="card p-0 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="table-header">Academy</th>
                  <th className="table-header">Period</th>
                  <th className="table-header text-right">Amount</th>
                  <th className="table-header">Status</th>
                  <th className="table-header text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {invoices.map((inv) => (
                  <tr key={inv.id} className="hover:bg-gray-50 transition-colors">
                    <td className="table-cell font-medium text-gray-900">
                      <div className="truncate">{inv.org_name}</div>
                      {inv.notes && <div className="text-xs text-gray-400 truncate">{inv.notes}</div>}
                    </td>
                    <td className="table-cell text-sm text-gray-600">
                      {inv.period || '-'}
                      {inv.due_date && <div className="text-xs text-gray-400">due {inv.due_date}</div>}
                    </td>
                    <td className="table-cell text-right font-semibold text-gray-900">₹{Number(inv.amount || 0).toLocaleString('en-IN')}</td>
                    <td className="table-cell">
                      <span className={`text-[11px] px-2 py-0.5 rounded-full font-medium capitalize ${INVOICE_BADGE[inv.status] || INVOICE_BADGE.pending}`}>
                        {inv.status || 'pending'}
                      </span>
                    </td>
                    <td className="table-cell text-right">
                      <div className="flex items-center justify-end gap-1">
                        {inv.status !== 'paid' && (
                          <Tooltip label="Mark this invoice paid">
                            <button onClick={() => setInvoiceStatus(inv, 'paid')} disabled={invoiceBusy === inv.id}
                              className="btn-sm rounded-md px-2 py-1 text-xs bg-green-50 text-green-700 border border-green-200 hover:bg-green-100 disabled:opacity-50 flex items-center gap-1">
                              <CheckCircle2 className="w-3.5 h-3.5" /> Paid
                            </button>
                          </Tooltip>
                        )}
                        {inv.status === 'paid' && (
                          <Tooltip label="Move back to pending">
                            <button onClick={() => setInvoiceStatus(inv, 'pending')} disabled={invoiceBusy === inv.id}
                              className="btn-sm rounded-md px-2 py-1 text-xs bg-amber-50 text-amber-700 border border-amber-200 hover:bg-amber-100 disabled:opacity-50 flex items-center gap-1">
                              <RotateCcw className="w-3.5 h-3.5" /> Pending
                            </button>
                          </Tooltip>
                        )}
                        {inv.status !== 'void' && (
                          <Tooltip label="Void this invoice">
                            <button onClick={() => setInvoiceStatus(inv, 'void')} disabled={invoiceBusy === inv.id}
                              className="btn-sm rounded-md px-2 py-1 text-xs bg-gray-100 text-gray-600 border border-gray-200 hover:bg-gray-200 disabled:opacity-50 flex items-center gap-1">
                              <Ban className="w-3.5 h-3.5" /> Void
                            </button>
                          </Tooltip>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ----------------------------------------------------------------------------
// One request row — header summary plus an expandable body with full contact
// details, a status pipeline, and an internal notes field.
// ----------------------------------------------------------------------------
function LeadRow({ lead, leadBusy, setLeadStatus, saveLeadNotes }) {
  const [open, setOpen] = useState(false);
  const [notes, setNotes] = useState(lead.notes || '');
  const busy = leadBusy === lead.id;
  const when = lead.created_at ? new Date(lead.created_at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '';

  return (
    <div className="card p-0 overflow-hidden">
      {/* Header — always visible */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full text-left px-4 py-3 flex items-center gap-3 hover:bg-gray-50 transition-colors"
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-gray-900 truncate">{lead.name || 'Unnamed'}</span>
            <span className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${LEAD_BADGE[lead.status] || LEAD_BADGE.new}`}>
              {LEAD_LABEL[lead.status] || lead.status}
            </span>
            {lead.academy_type && (
              <span className="text-[11px] px-2 py-0.5 rounded-full font-medium bg-gray-100 text-gray-600">{lead.academy_type}</span>
            )}
          </div>
          <div className="text-xs text-gray-500 mt-0.5 truncate">
            {[lead.email, lead.phone, lead.city].filter(Boolean).join(' · ') || 'No contact details'}
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {when && <span className="hidden sm:inline text-xs text-gray-400">{when}</span>}
          <ChevronLeft className={`w-4 h-4 text-gray-400 transition-transform ${open ? '-rotate-90' : 'rotate-180'}`} />
        </div>
      </button>

      {/* Body — expandable */}
      {open && (
        <div className="border-t border-gray-100 px-4 py-3 space-y-4 bg-gray-50/60">
          {/* Contact + meta grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-sm">
            {lead.email && (
              <div className="flex items-center gap-2 text-gray-700">
                <AtSign className="w-4 h-4 text-gray-400 flex-shrink-0" />
                <a href={`mailto:${lead.email}`} className="text-indigo-600 hover:underline truncate">{lead.email}</a>
              </div>
            )}
            {lead.phone && (
              <div className="flex items-center gap-2 text-gray-700">
                <Phone className="w-4 h-4 text-gray-400 flex-shrink-0" />
                <a href={`tel:${lead.phone}`} className="text-indigo-600 hover:underline truncate">{lead.phone}</a>
              </div>
            )}
            {lead.academy_name && (
              <div className="flex items-center gap-2 text-gray-700">
                <Building2 className="w-4 h-4 text-gray-400 flex-shrink-0" />
                <span className="truncate">{lead.academy_name}</span>
              </div>
            )}
            {lead.city && (
              <div className="flex items-center gap-2 text-gray-700">
                <MapPin className="w-4 h-4 text-gray-400 flex-shrink-0" />
                <span className="truncate">{lead.city}</span>
              </div>
            )}
            {lead.student_count && (
              <div className="flex items-center gap-2 text-gray-700">
                <UsersIcon className="w-4 h-4 text-gray-400 flex-shrink-0" />
                <span className="truncate">{lead.student_count} students</span>
              </div>
            )}
          </div>

          {lead.message && (
            <div className="text-sm text-gray-700 bg-white border border-gray-200 rounded-lg px-3 py-2 whitespace-pre-wrap">
              {lead.message}
            </div>
          )}

          {/* Status pipeline */}
          <div>
            <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1.5">Track</div>
            <div className="flex flex-wrap gap-1.5">
              {LEAD_STATUSES.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => lead.status !== s && setLeadStatus(lead, s)}
                  disabled={busy}
                  className={`text-xs px-2.5 py-1 rounded-full font-medium border transition-colors disabled:opacity-50 ${
                    lead.status === s
                      ? `${LEAD_BADGE[s]} border-transparent ring-1 ring-current`
                      : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-100'
                  }`}
                >
                  {LEAD_LABEL[s]}
                </button>
              ))}
            </div>
          </div>

          {/* Internal notes */}
          <div>
            <label className="block text-xs font-medium text-gray-500 uppercase tracking-wide mb-1.5">Follow-up notes</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className="input-field text-sm"
              placeholder="Private notes about this request..."
            />
            <div className="flex justify-end mt-2">
              <button
                type="button"
                onClick={() => saveLeadNotes(lead, notes)}
                disabled={busy || notes === (lead.notes || '')}
                className="btn-sm rounded-md px-3 py-1 text-xs bg-indigo-50 text-indigo-700 border border-indigo-200 hover:bg-indigo-100 disabled:opacity-50 flex items-center gap-1"
              >
                {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />} Save notes
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ----------------------------------------------------------------------------
// Requests section — the lead inbox. Lists inbound contact-form submissions
// with a pipeline tracker and follow-up notes per request.
// ----------------------------------------------------------------------------
function LeadsSection({ leads, available, loaded, leadBusy, setLeadStatus, saveLeadNotes }) {
  const counts = {};
  for (const s of LEAD_STATUSES) counts[s] = 0;
  for (const l of leads) if (counts[l.status] !== undefined) counts[l.status] += 1;

  if (!loaded) return <Loader text="Loading requests..." />;

  if (!available) {
    return (
      <div className="card flex items-start gap-3">
        <Inbox className="w-5 h-5 text-gray-500 mt-0.5 flex-shrink-0" />
        <div className="text-sm text-gray-600">
          <p className="font-medium text-gray-800">Requests inbox not set up yet</p>
          <p className="mt-1">
            Create a <code className="font-mono text-gray-700">Leads</code> table in Supabase (SQL editor)
            with columns <code className="font-mono text-gray-700">name</code>, <code className="font-mono text-gray-700">email</code>,
            {' '}<code className="font-mono text-gray-700">phone</code>, <code className="font-mono text-gray-700">academy_type</code>,
            {' '}<code className="font-mono text-gray-700">academy_name</code>, <code className="font-mono text-gray-700">student_count</code>,
            {' '}<code className="font-mono text-gray-700">city</code>, <code className="font-mono text-gray-700">message</code>,
            {' '}<code className="font-mono text-gray-700">source</code>, <code className="font-mono text-gray-700">status</code>,
            {' '}and <code className="font-mono text-gray-700">notes</code> (all varchar). The inbox turns on once it exists.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Pipeline counts */}
      <div className="card p-3 flex flex-wrap gap-2">
        {LEAD_STATUSES.map((s) => (
          <span key={s} className={`text-xs px-2.5 py-1 rounded-full font-medium ${LEAD_BADGE[s]}`}>
            {LEAD_LABEL[s]} · {counts[s]}
          </span>
        ))}
      </div>

      {leads.length === 0 ? (
        <EmptyState icon={Inbox} title="No requests yet" message="Contact-form submissions from the landing page will land here." />
      ) : (
        <div className="space-y-2">
          {leads.map((lead) => (
            <LeadRow
              key={lead.id}
              lead={lead}
              leadBusy={leadBusy}
              setLeadStatus={setLeadStatus}
              saveLeadNotes={saveLeadNotes}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ----------------------------------------------------------------------------
// Broadcast section — compose an in-app + push notification to academies,
// with a list of recently sent broadcasts beneath it.
// ----------------------------------------------------------------------------
function BroadcastSection({ orgs, broadcastForm, setBF, broadcasting, sendBroadcast, broadcasts, broadcastsLoaded }) {
  return (
    <div className="space-y-4">
    <form onSubmit={sendBroadcast} className="card space-y-4">
      <div className="flex items-start gap-2">
        <Megaphone className="w-5 h-5 text-indigo-600 mt-0.5 flex-shrink-0" />
        <div>
          <p className="font-medium text-gray-900">Send an in-app notification</p>
          <p className="text-sm text-gray-500">
            Reaches academy owners in their dashboard bell, plus a push notification on devices
            that have it enabled. Pick one academy or send to all.
          </p>
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Send to</label>
          <select value={broadcastForm.target} onChange={setBF('target')} className="input-field">
            <option value="all">All academies</option>
            {orgs.map((o) => (
              <option key={o.id} value={String(o.id)}>{o.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Link (optional)</label>
          <input type="text" value={broadcastForm.link} onChange={setBF('link')}
            className="input-field" placeholder="/dashboard" />
        </div>
        <div className="sm:col-span-2">
          <label className="block text-sm font-medium text-gray-700 mb-1">Title</label>
          <input type="text" value={broadcastForm.title} onChange={setBF('title')}
            className="input-field" placeholder="e.g. New feature: Question papers" maxLength={250} required />
        </div>
        <div className="sm:col-span-2">
          <label className="block text-sm font-medium text-gray-700 mb-1">Message (optional)</label>
          <textarea value={broadcastForm.body} onChange={setBF('body')}
            className="input-field min-h-[80px]" placeholder="Add a short detail or call to action." maxLength={1000} />
        </div>
      </div>
      <div className="flex justify-end">
        <button type="submit" disabled={broadcasting} className="btn-primary disabled:opacity-50">
          {broadcasting ? <><Loader2 className="w-4 h-4 animate-spin" /> Sending...</> : <><Send className="w-4 h-4" /> Send notification</>}
        </button>
      </div>
    </form>

      {/* Sent history */}
      <div className="card p-0 overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-100">
          <History className="w-5 h-5 text-gray-500" />
          <h3 className="font-semibold text-gray-800">Recently sent</h3>
        </div>
        {!broadcastsLoaded ? (
          <div className="px-4 py-6 flex items-center gap-2 text-sm text-gray-500">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading history...
          </div>
        ) : broadcasts.length === 0 ? (
          <div className="px-4 py-6 text-sm text-gray-500">Nothing sent yet. Your broadcasts will be listed here.</div>
        ) : (
          <ul className="divide-y divide-gray-100">
            {broadcasts.map((b) => {
              const d = b.detail || {};
              return (
                <li key={b.id} className="px-4 py-2.5 flex items-start gap-3">
                  <Megaphone className="w-4 h-4 text-indigo-500 mt-0.5 flex-shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-gray-800 truncate">{d.title || '(untitled)'}</p>
                    <p className="text-xs text-gray-400">
                      {b.scope || 'academies'}
                      {d.delivered != null && ` · ${d.delivered} in-app`}
                      {d.push != null && `, ${d.push} push`}
                      {b.created_at && ` · ${new Date(b.created_at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}`}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
