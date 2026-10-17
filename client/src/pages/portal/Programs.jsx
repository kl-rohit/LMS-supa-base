// Parent/student portal — Programs (read-only). Lists the events (recitals,
// kutcheris, workshops, competitions) the child is taking part in, with the
// date and, when the academy has added it to fee collection, the fee.

import { useState, useEffect } from 'react';
import { CalendarDays, IndianRupee, Tag } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../utils/api';
import Loader from '../../components/Loader';
import EmptyState from '../../components/EmptyState';

const TYPE_LABEL = {
  recital: 'Recital',
  workshop: 'Workshop',
  competition: 'Competition',
  kutchery: 'Kutchery',
  other: 'Event',
};

const STATUS_BADGE = {
  planned:   'bg-indigo-100 text-indigo-700',
  completed: 'bg-green-100 text-green-700',
};

function formatDate(d) {
  if (!d) return '';
  const dt = new Date(`${d}T00:00:00`);
  if (Number.isNaN(dt.getTime())) return d;
  return dt.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

export default function PortalPrograms() {
  const [programs, setPrograms] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await api.get('/portal/programs');
        if (!cancelled) setPrograms(data.programs || []);
      } catch {
        if (!cancelled) toast.error('Failed to load programs');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  if (loading) return <Loader text="Loading programs..." />;

  if (programs.length === 0) {
    return (
      <EmptyState
        icon={CalendarDays}
        title="No programs yet"
        message="When your academy adds your child to an event (a recital, kutchery or workshop), it will show up here."
      />
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
      {programs.map((p) => (
        <div key={p.id} className="card">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-lg bg-indigo-100 flex items-center justify-center flex-shrink-0">
              <CalendarDays className="w-5 h-5 text-indigo-600" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <h3 className="font-medium text-gray-900 truncate">{p.name}</h3>
                {p.status && STATUS_BADGE[p.status] && (
                  <span className={`text-[11px] px-2 py-0.5 rounded-full font-medium shrink-0 ${STATUS_BADGE[p.status]}`}>
                    {p.status === 'completed' ? 'Completed' : 'Planned'}
                  </span>
                )}
              </div>
              <div className="flex items-center flex-wrap gap-x-3 gap-y-1 mt-1 text-xs text-gray-500">
                <span className="inline-flex items-center gap-1">
                  <Tag className="w-3 h-3" /> {TYPE_LABEL[p.type] || 'Event'}
                </span>
                {p.program_date && (
                  <span className="inline-flex items-center gap-1">
                    <CalendarDays className="w-3 h-3" /> {formatDate(p.program_date)}
                  </span>
                )}
                {p.billed && p.fee > 0 && (
                  p.collected ? (
                    <span className="inline-flex items-center gap-1 text-green-700 font-medium">
                      <IndianRupee className="w-3 h-3" /> {p.fee.toLocaleString('en-IN')} paid
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-gray-700">
                      <IndianRupee className="w-3 h-3" /> {p.fee.toLocaleString('en-IN')} (added to fees)
                    </span>
                  )
                )}
              </div>
              {p.description && (
                <p className="text-sm text-gray-600 mt-2 whitespace-pre-wrap">{p.description}</p>
              )}
              {p.note && (
                <div className="mt-2 text-sm text-gray-900 bg-indigo-50 border border-indigo-200 rounded-lg px-3 py-2 whitespace-pre-wrap">
                  {p.note}
                </div>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
