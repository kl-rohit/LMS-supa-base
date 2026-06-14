// Parent view: read-only class history with month filter.

import { useEffect, useMemo, useState } from 'react';
import { Check, X, Search } from 'lucide-react';
import api from '../../utils/api';
import Loader from '../../components/Loader';

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

export default function PortalAttendance() {
  const [loading, setLoading] = useState(true);
  const [records, setRecords] = useState([]);
  const [monthFilter, setMonthFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [search, setSearch] = useState('');

  useEffect(() => {
    api.get('/portal/attendance')
      .then((d) => setRecords(d.attendance || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const availableMonths = useMemo(() => {
    const set = new Set();
    records.forEach((r) => { if (r.date && /^\d{4}-\d{2}/.test(r.date)) set.add(r.date.slice(0, 7)); });
    return Array.from(set).sort().reverse();
  }, [records]);

  const filtered = useMemo(() => records.filter((r) => {
    if (statusFilter !== 'all' && r.status !== statusFilter) return false;
    if (monthFilter !== 'all' && (!r.date || !r.date.startsWith(monthFilter))) return false;
    if (search.trim()) {
      const q = search.toLowerCase();
      return (
        (r.topic || '').toLowerCase().includes(q) ||
        (r.notes || '').toLowerCase().includes(q) ||
        (r.class_name || '').toLowerCase().includes(q)
      );
    }
    return true;
  }), [records, statusFilter, monthFilter, search]);

  if (loading) return <Loader />;

  return (
    <div className="space-y-4">
      <div className="card">
        <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
          <h3 className="font-semibold text-gray-900">
            Class History <span className="text-sm text-gray-400 font-normal">({filtered.length} of {records.length})</span>
          </h3>
          <div className="flex items-center gap-2 flex-wrap">
            <div className="relative">
              <Search className="w-4 h-4 text-gray-400 absolute left-2 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search topic / notes..."
                className="input-field text-sm pl-8 w-56"
              />
            </div>
            <select
              value={monthFilter}
              onChange={(e) => setMonthFilter(e.target.value)}
              className="select-field text-sm w-auto"
            >
              <option value="all">All months</option>
              {availableMonths.map((ym) => {
                const [y, m] = ym.split('-');
                return <option key={ym} value={ym}>{MONTHS[parseInt(m, 10) - 1]} {y}</option>;
              })}
            </select>
            <div className="flex items-center gap-1 bg-white rounded-lg border border-gray-200 p-1">
              {['all', 'present', 'absent'].map((s) => (
                <button
                  key={s}
                  onClick={() => setStatusFilter(s)}
                  className={`px-2.5 py-1 rounded-md text-xs font-medium capitalize transition-colors ${
                    statusFilter === s ? 'bg-indigo-100 text-gray-900 dark:bg-indigo-600 dark:text-white' : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        </div>

        {filtered.length === 0 ? (
          <div className="text-center py-8 text-sm text-gray-400">No classes match the filters.</div>
        ) : (
          <>
          <div className="overflow-x-auto hidden md:block">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="table-header whitespace-nowrap">Date</th>
                  <th className="table-header">Class</th>
                  <th className="table-header text-center">Status</th>
                  <th className="table-header">Topic taught</th>
                  <th className="table-header">Notes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filtered.map((r) => (
                  <tr key={r.id} className={r.status === 'absent' ? 'bg-red-50/30' : ''}>
                    <td className="table-cell whitespace-nowrap text-gray-600">
                      {r.date
                        ? new Date(r.date + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', weekday: 'short' })
                        : '-'}
                    </td>
                    <td className="table-cell text-gray-700">
                      {r.class_name || (r.camp_id ? 'Camp' : 'Ad-hoc')}
                    </td>
                    <td className="table-cell text-center">
                      {(r.status === 'present' || r.status === 'late') && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-green-100 text-green-700 text-xs font-medium">
                          <Check className="w-3 h-3" /> Present
                        </span>
                      )}
                      {r.status === 'absent' && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-100 text-red-700 text-xs font-medium">
                          <X className="w-3 h-3" /> Absent
                        </span>
                      )}
                    </td>
                    <td className="table-cell text-gray-700 max-w-xs">
                      {r.topic || <span className="text-gray-300">—</span>}
                    </td>
                    <td className="table-cell text-gray-700 max-w-xs">
                      {r.notes || <span className="text-gray-300">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {/* Mobile: stacked cards instead of a side-scrolling table */}
          <div className="md:hidden space-y-3">
            {filtered.map((r) => (
              <div
                key={r.id}
                className={`rounded-lg border p-3 ${r.status === 'absent' ? 'border-red-200 bg-red-50/50' : 'border-gray-200'}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium text-gray-900">
                    {r.date
                      ? new Date(r.date + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', weekday: 'short' })
                      : '-'}
                  </span>
                  {(r.status === 'present' || r.status === 'late') && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-green-100 text-green-700 text-xs font-medium flex-shrink-0">
                      <Check className="w-3 h-3" /> Present
                    </span>
                  )}
                  {r.status === 'absent' && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-100 text-red-700 text-xs font-medium flex-shrink-0">
                      <X className="w-3 h-3" /> Absent
                    </span>
                  )}
                </div>
                <p className="text-sm text-gray-700 mt-1">{r.class_name || (r.camp_id ? 'Camp' : 'Ad-hoc')}</p>
                {r.topic && (
                  <p className="text-xs text-gray-500 mt-1"><span className="text-gray-400">Topic: </span>{r.topic}</p>
                )}
                {r.notes && (
                  <p className="text-xs text-gray-500 mt-0.5"><span className="text-gray-400">Notes: </span>{r.notes}</p>
                )}
              </div>
            ))}
          </div>
          </>
        )}
      </div>
    </div>
  );
}
