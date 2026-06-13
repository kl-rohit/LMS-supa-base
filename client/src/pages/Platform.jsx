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
} from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../utils/api';
import Loader from '../components/Loader';
import EmptyState from '../components/EmptyState';
import { useAuth } from '../contexts/AuthContext';

export default function Platform() {
  const { user } = useAuth();
  const [orgs, setOrgs] = useState([]);
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

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
        <button onClick={fetchAll} className="btn-secondary btn-sm">
          <RefreshCw className="w-4 h-4" /> Refresh
        </button>
      </div>

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
                  <th className="table-header">Plan</th>
                  <th className="table-header">Status</th>
                  <th className="table-header">Created</th>
                  <th className="table-header">Owner ID</th>
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
                    <td className="table-cell">
                      <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-700 uppercase tracking-wide font-medium">
                        {o.plan || 'free'}
                      </span>
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
                    <td className="table-cell font-mono text-xs text-gray-400 truncate max-w-[10rem]" title={o.owner_user_id}>
                      {o.owner_user_id || '-'}
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
