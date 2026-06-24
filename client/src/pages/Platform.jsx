// Platform Admin page. Visible only to Catalyst "App Administrator" users
// (gated in TeacherLayout). Lets you (Rohit) see every org on the platform
// — Phase A surfaces just a list; subscription/billing/impersonate will
// come in Phase D.5.

import { useEffect, useMemo, useState } from 'react';
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
} from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../utils/api';
import Loader from '../components/Loader';
import EmptyState from '../components/EmptyState';
import { useAuth } from '../contexts/AuthContext';
import { useConfirm } from '../contexts/ConfirmContext';

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
    default:                  return '';
  }
}

export default function Platform() {
  const { user } = useAuth();
  const confirm = useConfirm();
  const [orgs, setOrgs] = useState([]);
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
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

  // Trial date-picker modal — replaces the old window.prompt so trial length is
  // set with the same date input the rest of the app uses. Holds the target org
  // and the chosen END date (YYYY-MM-DD); days are derived from it on confirm.
  const [trialModal, setTrialModal] = useState(null); // { org, date } | null

  // Per-org detail drill-down. Holds the fetched payload (org + module-wise
  // record counts + members) for the modal; `detailLoading` covers the fetch.
  const [detail, setDetail] = useState(null);         // { org, counts, members } | null
  const [detailLoading, setDetailLoading] = useState(false);

  // Platform audit log — recent admin actions across all orgs. `available`
  // flips false until the AuditLog table is created in the Catalyst console.
  const [audit, setAudit] = useState({ entries: [], available: true });

  // Activation funnel metrics (signed up → setup → first student → first attendance).
  const [funnel, setFunnel] = useState(null);

  const isPlatformAdmin = user?.role === 'App Administrator';

  const fetchAll = async () => {
    setLoading(true);
    try {
      const [statusRes, orgsRes, auditRes, metricsRes] = await Promise.all([
        api.get('/platform/status'),
        api.get('/platform/orgs'),
        api.get('/platform/audit').catch(() => ({ entries: [], available: true })),
        api.get('/platform/metrics').catch(() => null),
      ]);
      setStatus(statusRes || null);
      setOrgs(orgsRes?.orgs || []);
      setAudit({ entries: auditRes?.entries || [], available: auditRes?.available !== false });
      setFunnel(metricsRes?.funnel || null);
    } catch (err) {
      toast.error('Failed to load platform data: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchAll(); }, []);

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

  const PLAN_LABELS = { trial: 'Trial', free: 'Free', core: 'Core', complete: 'Complete' };

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
      toast.success(`Created "${data?.org?.name || f.academy_name}". Invite emailed to ${f.owner_email}.`);
      setCreateForm(emptyForm);
      setShowCreate(false);
      fetchAll();
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

  // Open the per-org detail drill-down. Shows how much data the academy has
  // created (module-wise record counts), its members, and plan/trial state.
  const openDetail = async (org) => {
    setDetail({ org, counts: null, members: null, module_flags: null }); // open with what we know
    setDetailLoading(true);
    try {
      const res = await api.get(`/platform/orgs/${org.id}/detail`);
      setDetail({
        org: res?.org || org,
        counts: res?.counts || [],
        members: res?.members || [],
        module_flags: res?.module_flags || [],
      });
    } catch (e) {
      toast.error('Could not load org details: ' + e.message);
      setDetail(null);
    } finally {
      setDetailLoading(false);
    }
  };

  // Flip one module toggle for the org in the detail modal. Optimistic update.
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
      toast.success(`Access email sent${res?.email ? ` to ${res.email}` : ''}`);
    } catch (e) {
      toast.error('Could not send access email: ' + e.message);
    } finally {
      setResending(false);
    }
  };

  // ----- Broadcast in-app notification to academies -------------------------
  // Sends an admin-level notification (with web push) to one academy or to all
  // of them. Lands in each owner's dashboard bell.
  const [showBroadcast, setShowBroadcast] = useState(false);
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
      setShowBroadcast(false);
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
        Catalyst project's App Administrator.
      </div>
    );
  }

  if (loading) return <Loader text="Loading platform data..." />;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className="page-header mb-0">Platform Admin</h2>
          <p className="text-sm text-gray-500 mt-1">
            Cross-org dashboard for you, the platform owner. Org owners see only their own academy.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={fetchAll} className="btn-secondary btn-sm">
            <RefreshCw className="w-4 h-4" /> Refresh
          </button>
          <button
            onClick={() => setShowBroadcast((v) => !v)}
            className="btn-secondary btn-sm"
          >
            {showBroadcast ? <X className="w-4 h-4" /> : <Megaphone className="w-4 h-4" />}
            {showBroadcast ? 'Cancel' : 'Send notification'}
          </button>
          <button
            onClick={() => setShowCreate((v) => !v)}
            className="btn-primary btn-sm"
          >
            {showCreate ? <X className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
            {showCreate ? 'Cancel' : 'Create academy'}
          </button>
        </div>
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

      {/* Broadcast an in-app notification to academies */}
      {showBroadcast && (
        <form onSubmit={sendBroadcast} className="card border-indigo-100 bg-indigo-50/40 space-y-4">
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
      )}

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
          <button onClick={stopImpersonate} className="btn-sm bg-white text-amber-800 border border-amber-300 hover:bg-amber-50 rounded-lg px-3 py-1 text-xs font-medium flex-shrink-0">
            Stop impersonating
          </button>
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
            <div className="rounded-lg bg-gray-50 border border-gray-100 px-2 py-1.5">
              <div className="text-lg font-semibold text-gray-800">{revenue.paid}</div>
              <div className="text-[11px] text-gray-500">Paid</div>
            </div>
            <div className="rounded-lg bg-gray-50 border border-gray-100 px-2 py-1.5">
              <div className="text-lg font-semibold text-gray-800">{revenue.trial}</div>
              <div className="text-[11px] text-gray-500">Trial</div>
            </div>
            <div className="rounded-lg bg-gray-50 border border-gray-100 px-2 py-1.5">
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
                Academies whose trial has ended or ends within {TRIAL_WATCH_DAYS} days. Renew to keep full access on.
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
                <button
                  onClick={() => setOrgPlan(o, 'trial')}
                  className="btn-sm rounded-md px-2.5 py-1 text-xs bg-amber-600 text-white hover:bg-amber-700 flex items-center gap-1 flex-shrink-0"
                  title="Set a new trial end date for this academy"
                >
                  <Clock className="w-3.5 h-3.5" /> Extend trial
                </button>
              </div>
            ))}
          </div>
        </div>
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
                      <button
                        type="button"
                        onClick={() => openDetail(o)}
                        className="flex items-center gap-2 text-left hover:text-indigo-700 transition-colors"
                        title="View this academy's details and record totals"
                      >
                        <div className="w-8 h-8 rounded-lg bg-indigo-100 text-indigo-700 flex items-center justify-center text-sm font-semibold flex-shrink-0">
                          {(o.name || '?').slice(0, 1).toUpperCase()}
                        </div>
                        <span className="underline-offset-2 hover:underline">{o.name}</span>
                      </button>
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
                            <input
                              type="number"
                              min="0"
                              defaultValue={o.max_students_override ?? ''}
                              placeholder={planDefault == null ? '∞' : String(planDefault)}
                              onBlur={(e) => setOrgStudentLimit(o, e.target.value)}
                              onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur(); }}
                              className="w-14 text-xs text-right rounded-md border border-gray-200 bg-white px-1.5 py-1 font-medium text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                              title="Custom student cap for this academy — leave blank to use the plan default"
                            />
                          </div>
                        );
                      })()}
                    </td>
                    <td className="table-cell">
                      <select
                        value={['trial', 'free', 'core', 'complete'].includes(o.plan) ? o.plan : 'legacy'}
                        onChange={(e) => setOrgPlan(o, e.target.value)}
                        className="text-xs rounded-md border border-gray-200 bg-white px-2 py-1 font-medium text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                        title="Subscription plan — Trial & Complete unlock online learning modules; Free caps active students at 2"
                      >
                        <option value="trial">Trial (14-day full access)</option>
                        <option value="free">Free (2 students)</option>
                        <option value="core">Core</option>
                        <option value="complete">Complete</option>
                        {!['trial', 'free', 'core', 'complete'].includes(o.plan) && (
                          <option value="legacy" disabled>{o.plan || 'free'} (legacy · full access)</option>
                        )}
                      </select>
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
                        <button
                          onClick={() => openDetail(o)}
                          className="btn-sm rounded-md px-2 py-1 text-xs bg-gray-50 text-gray-700 border border-gray-200 hover:bg-gray-100 flex items-center gap-1"
                          title="Record totals, members and plan for this academy"
                        >
                          <BarChart3 className="w-3.5 h-3.5" /> Details
                        </button>
                        <button
                          onClick={() => startImpersonate(o)}
                          disabled={String(impersonating) === String(o.id)}
                          className="btn-sm rounded-md px-2 py-1 text-xs bg-indigo-50 text-indigo-700 border border-indigo-200 hover:bg-indigo-100 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1"
                          title="View the app as this org"
                        >
                          <Eye className="w-3.5 h-3.5" /> View
                        </button>
                        <button
                          onClick={() => replayOnboarding(o)}
                          className="btn-sm rounded-md px-2 py-1 text-xs bg-gray-50 text-gray-700 border border-gray-200 hover:bg-gray-100 inline-flex items-center gap-1 whitespace-nowrap"
                          title="Show this org's owner the welcome tour again on next sign-in"
                        >
                          <RotateCcw className="w-3.5 h-3.5 flex-shrink-0" /> Replay tour
                        </button>
                        {o.status === 'suspended' ? (
                          <button
                            onClick={() => setOrgStatus(o, 'active')}
                            className="btn-sm rounded-md px-2 py-1 text-xs bg-green-50 text-green-700 border border-green-200 hover:bg-green-100 flex items-center gap-1"
                            title="Reactivate this org"
                          >
                            <Play className="w-3.5 h-3.5" /> Reactivate
                          </button>
                        ) : (
                          <button
                            onClick={() => setOrgStatus(o, 'suspended')}
                            className="btn-sm rounded-md px-2 py-1 text-xs bg-red-50 text-red-600 border border-red-200 hover:bg-red-100 flex items-center gap-1"
                            title="Lock this org's members out immediately"
                          >
                            <Pause className="w-3.5 h-3.5" /> Suspend
                          </button>
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

      {/* Activity log — recent platform-admin actions across all orgs. */}
      <div className="card p-0 overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-100">
          <ScrollText className="w-5 h-5 text-gray-500" />
          <h3 className="font-semibold text-gray-800">Activity log</h3>
          <span className="text-xs text-gray-400">recent platform actions</span>
        </div>
        {!audit.available ? (
          <div className="px-4 py-6 text-sm text-gray-500">
            The audit log is not set up yet. Create an <code className="font-mono text-gray-700">AuditLog</code> table
            in the Catalyst console (Data Store) and actions you take here will start being recorded.
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
                        days === n ? 'bg-indigo-600 text-white border-indigo-600' : 'border-gray-300 text-gray-600 hover:bg-gray-50'
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

      {/* Per-org detail drill-down — record totals, members, plan/trial. */}
      {detail && (() => {
        const d = detail.org || {};
        const counts = detail.counts || [];
        const members = detail.members || [];
        const totalRecords = counts.reduce((s, c) => s + (Number(c.count) || 0), 0);
        const planLabel = PLAN_LABELS[d.effective_plan] || d.effective_plan || d.plan || '-';
        const roleOrder = { owner: 0, admin: 1, teacher: 2 };
        const sortedMembers = [...members].sort(
          (a, b) => (roleOrder[a.role] ?? 9) - (roleOrder[b.role] ?? 9)
        );
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/50" onClick={() => setDetail(null)} aria-hidden="true" />
            <div role="dialog" aria-modal="true" aria-label={`${d.name} details`} className="relative w-full max-w-2xl bg-white rounded-2xl shadow-xl overflow-hidden max-h-[90vh] flex flex-col">
              <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-9 h-9 rounded-lg bg-indigo-100 text-indigo-700 flex items-center justify-center text-base font-semibold flex-shrink-0">
                    {(d.name || '?').slice(0, 1).toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <h3 className="font-semibold text-gray-900 truncate">{d.name}</h3>
                    <p className="text-xs font-mono text-gray-500 truncate">{d.slug}</p>
                  </div>
                </div>
                <button onClick={() => setDetail(null)} className="p-1.5 rounded-full hover:bg-gray-100 flex-shrink-0" aria-label="Close">
                  <X className="w-4 h-4 text-gray-500" />
                </button>
              </div>

              <div className="px-5 py-4 space-y-5 overflow-y-auto">
                {/* Plan / status summary */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div className="rounded-lg border border-gray-100 bg-gray-50 px-3 py-2">
                    <div className="text-[11px] uppercase tracking-wide text-gray-400">Plan</div>
                    <div className="text-sm font-semibold text-gray-800 capitalize">{planLabel}</div>
                  </div>
                  <div className="rounded-lg border border-gray-100 bg-gray-50 px-3 py-2">
                    <div className="text-[11px] uppercase tracking-wide text-gray-400">Status</div>
                    <div className="text-sm font-semibold text-gray-800 capitalize">{d.status || 'active'}</div>
                  </div>
                  <div className="rounded-lg border border-gray-100 bg-gray-50 px-3 py-2">
                    <div className="text-[11px] uppercase tracking-wide text-gray-400">Members</div>
                    <div className="text-sm font-semibold text-gray-800">{d.member_count ?? members.length}</div>
                  </div>
                  <div className="rounded-lg border border-gray-100 bg-gray-50 px-3 py-2">
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
                        <div key={c.key} className="rounded-lg border border-gray-100 px-3 py-2 flex items-center justify-between">
                          <span className="text-xs text-gray-600 truncate pr-2">{c.label}</span>
                          <span className={`text-sm font-semibold ${c.count == null ? 'text-gray-300' : 'text-gray-900'}`}>
                            {c.count == null ? '-' : Number(c.count).toLocaleString('en-IN')}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Members */}
                <div>
                  <h4 className="text-sm font-semibold text-gray-800 mb-2">Members</h4>
                  {detailLoading && !detail.members ? (
                    <div className="flex items-center gap-2 text-sm text-gray-500 py-2">
                      <Loader2 className="w-4 h-4 animate-spin" /> Loading members…
                    </div>
                  ) : sortedMembers.length === 0 ? (
                    <p className="text-sm text-gray-500 py-2">No members recorded.</p>
                  ) : (
                    <div className="space-y-1.5">
                      {sortedMembers.map((m, i) => (
                        <div key={`${m.user_id}-${i}`} className="flex items-center justify-between rounded-lg border border-gray-100 px-3 py-2">
                          <span className="text-sm font-mono text-gray-600 truncate pr-2">{m.user_id}</span>
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
                          onClick={() => toggleModuleFlag(f.key)}
                          disabled={flagBusy === f.key}
                          className="flex items-center justify-between rounded-lg border border-gray-100 px-3 py-2 hover:bg-gray-50 disabled:opacity-60 text-left"
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

              <div className="flex items-center justify-between gap-2 px-5 py-4 bg-gray-50 border-t border-gray-100">
                <div className="flex items-center gap-2">
                <button
                  onClick={() => resendInvite(detail.org)}
                  disabled={resending}
                  className="btn-sm rounded-md px-2.5 py-1.5 text-xs bg-white text-gray-700 border border-gray-200 hover:bg-gray-100 flex items-center gap-1 disabled:opacity-50"
                  title="Email the owner a fresh link to set their password and sign in"
                >
                  {resending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Mail className="w-3.5 h-3.5" />}
                  Resend owner access
                </button>
                <button
                  onClick={() => exportOrg(detail.org)}
                  disabled={exporting}
                  className="btn-sm rounded-md px-2.5 py-1.5 text-xs bg-white text-gray-700 border border-gray-200 hover:bg-gray-100 flex items-center gap-1 disabled:opacity-50"
                  title="Download this academy's data as a JSON file"
                >
                  {exporting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
                  Export data
                </button>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => { const o = detail.org; setDetail(null); startImpersonate(o); }}
                    className="btn-secondary btn-sm flex items-center gap-1"
                  >
                    <Eye className="w-3.5 h-3.5" /> View as this org
                  </button>
                  <button onClick={() => setDetail(null)} className="btn-primary btn-sm">Close</button>
                </div>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}

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
