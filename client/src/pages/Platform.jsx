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

  const isPlatformAdmin = user?.role === 'App Administrator';

  const fetchAll = async () => {
    setLoading(true);
    try {
      const [statusRes, orgsRes] = await Promise.all([
        api.get('/platform/status'),
        api.get('/platform/orgs'),
      ]);
      setStatus(statusRes || null);
      setOrgs(orgsRes?.orgs || []);
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

  const setOrgPlan = async (org, nextPlan) => {
    const prev = org.plan;
    const body = { plan: nextPlan };

    // Trial: ask how many days the trial should run (default 14). Cancelling
    // the prompt aborts the change.
    if (nextPlan === 'trial') {
      const input = window.prompt(`Trial length for "${org.name}" — number of days from today:`, '14');
      if (input === null) {
        // Cancelled — force a re-render so the <select> snaps back to the old plan.
        setOrgs((list) => list.map((o) => (o.id === org.id ? { ...o } : o)));
        return;
      }
      const days = parseInt(input, 10);
      if (!Number.isFinite(days) || days <= 0 || days > 365) {
        toast.error('Enter a whole number of days between 1 and 365.');
        setOrgs((list) => list.map((o) => (o.id === org.id ? { ...o } : o)));
        return;
      }
      body.trial_days = days;
    }

    try {
      await api.put(`/platform/orgs/${org.id}`, body);
      const suffix = nextPlan === 'trial' ? ` (${body.trial_days}-day trial)` : '';
      toast.success(`${org.name} moved to the ${PLAN_LABELS[nextPlan] || nextPlan} plan${suffix}`);
      // Re-fetch so derived fields (trial countdown, effective_plan) refresh.
      fetchAll();
    } catch (e) {
      toast.error('Could not change plan: ' + e.message);
      setOrgs((list) => list.map((o) => (o.id === org.id ? { ...o, plan: prev } : o)));
    }
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
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-lg bg-indigo-100 text-indigo-700 flex items-center justify-center text-sm font-semibold flex-shrink-0">
                          {(o.name || '?').slice(0, 1).toUpperCase()}
                        </div>
                        <span>{o.name}</span>
                      </div>
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
                          onClick={() => startImpersonate(o)}
                          disabled={String(impersonating) === String(o.id)}
                          className="btn-sm rounded-md px-2 py-1 text-xs bg-indigo-50 text-indigo-700 border border-indigo-200 hover:bg-indigo-100 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1"
                          title="View the app as this org"
                        >
                          <Eye className="w-3.5 h-3.5" /> View
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
