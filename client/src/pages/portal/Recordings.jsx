// Parent view: list of recording links.

import { useEffect, useState } from 'react';
import { Youtube, ExternalLink } from 'lucide-react';
import api from '../../utils/api';
import Loader from '../../components/Loader';

export default function PortalRecordings() {
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/portal/recordings')
      .then((d) => setList(d.recordings || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <Loader />;

  return (
    <div className="space-y-4">
      <div className="card">
        <h3 className="font-semibold text-gray-900 mb-4 flex items-center gap-2">
          <Youtube className="w-5 h-5 text-red-500" />
          Class Recordings
        </h3>
        {list.length === 0 ? (
          <p className="text-center text-sm text-gray-400 py-8">
            No recordings yet. Your teacher will upload them as classes happen.
          </p>
        ) : (
          <div className="divide-y divide-gray-100">
            {list.map((r) => (
              <a
                key={r.id}
                href={r.recording_url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-between gap-3 py-3 hover:bg-gray-50 px-2 rounded-md transition-colors"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-800">
                    {r.date
                      ? new Date(r.date + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', weekday: 'short' })
                      : '—'}
                  </p>
                  {r.topic && <p className="text-xs text-gray-500 mt-0.5 truncate">{r.topic}</p>}
                </div>
                <ExternalLink className="w-4 h-4 text-gray-400 flex-shrink-0" />
              </a>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
