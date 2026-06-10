// Parent view: read-only fees with month picker.

import { useEffect, useState } from 'react';
import { IndianRupee, TrendingDown } from 'lucide-react';
import api from '../../utils/api';
import Loader from '../../components/Loader';

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

function currentYm() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// Build last N months descending (e.g. ['2026-05', '2026-04', ...])
function recentMonths(n) {
  const d = new Date();
  const out = [];
  for (let i = 0; i < n; i++) {
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
    d.setMonth(d.getMonth() - 1);
  }
  return out;
}

export default function PortalFees() {
  const [month, setMonth] = useState(currentYm());
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    api.get(`/portal/fees?month=${month}`)
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [month]);

  const monthOpts = recentMonths(12);
  const [y, m] = month.split('-');
  const monthLabel = `${MONTHS[parseInt(m, 10) - 1]} ${y}`;

  return (
    <div className="space-y-4">
      <div className="card">
        <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
          <h3 className="font-semibold text-gray-900 flex items-center gap-2">
            <IndianRupee className="w-5 h-5 text-indigo-600" />
            Fee summary — {monthLabel}
          </h3>
          <select
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            className="select-field text-sm w-auto"
          >
            {monthOpts.map((ym) => {
              const [yy, mm] = ym.split('-');
              return <option key={ym} value={ym}>{MONTHS[parseInt(mm, 10) - 1]} {yy}</option>;
            })}
          </select>
        </div>

        {loading ? (
          <Loader />
        ) : !data ? (
          <p className="text-center text-sm text-gray-400 py-6">Could not load fee data.</p>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <Stat label="Classes attended" value={data.classes_attended} />
            <Stat label="Class fees" value={`₹${Number(data.class_fees).toLocaleString('en-IN')}`} />
            <Stat label="Additional" value={`₹${Number(data.additional_fees).toLocaleString('en-IN')}`} />
            <Stat
              label="Total"
              value={`₹${Number(data.total).toLocaleString('en-IN')}`}
              accent="text-indigo-700"
            />
          </div>
        )}

        {data?.discount > 0 && (
          <div className="mt-4 p-3 rounded-lg bg-green-50 text-green-700 text-sm flex items-center gap-2">
            <TrendingDown className="w-4 h-4" />
            A discount of ₹{Number(data.discount).toLocaleString('en-IN')} has been applied this month.
          </div>
        )}
      </div>

      <p className="text-xs text-gray-400 px-2">
        For payment, please contact your teacher directly. This page is for reference only.
      </p>
    </div>
  );
}

function Stat({ label, value, accent }) {
  return (
    <div className="p-3 rounded-lg bg-gray-50">
      <p className="text-xs text-gray-500">{label}</p>
      <p className={`text-xl font-semibold mt-1 ${accent || 'text-gray-900'}`}>{value}</p>
    </div>
  );
}
