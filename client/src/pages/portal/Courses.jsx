// Parent portal: list of courses the student is enrolled in.

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Video, PlayCircle, CheckCircle2, Clock } from 'lucide-react';
import api from '../../utils/api';
import Loader from '../../components/Loader';
import EmptyState from '../../components/EmptyState';
import { formatDurationLong } from '../../utils/youtube';

export default function PortalCourses() {
  const [loading, setLoading] = useState(true);
  const [courses, setCourses] = useState([]);

  useEffect(() => {
    api.get('/portal/courses')
      .then((d) => setCourses(d.courses || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <Loader />;

  if (courses.length === 0) {
    return (
      <EmptyState
        icon={Video}
        title="No courses yet"
        message="Your teacher hasn't enrolled you in any courses yet."
      />
    );
  }

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold text-gray-900">My Lessons</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {courses.map((c) => (
          <Link
            key={c.id}
            to={`/portal/lessons/${c.id}`}
            className="card hover:border-indigo-300 hover:shadow-md transition-all"
          >
            <div className="flex items-start justify-between gap-2 mb-2">
              <h3 className="font-semibold text-gray-900">{c.name}</h3>
              {c.progress_percent >= 90 ? (
                <CheckCircle2 className="w-5 h-5 text-green-500 flex-shrink-0" />
              ) : (
                <PlayCircle className="w-5 h-5 text-indigo-500 flex-shrink-0" />
              )}
            </div>
            {c.description && (
              <p className="text-xs text-gray-500 line-clamp-2 mb-3">{c.description}</p>
            )}
            <div className="flex items-center gap-3 mb-3 text-xs text-gray-500">
              <span>{c.lessons_total} lesson{c.lessons_total === 1 ? '' : 's'}</span>
              {c.total_duration_seconds > 0 && (
                <span className="inline-flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  {formatDurationLong(c.total_duration_seconds)}
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <div className="flex-1 bg-gray-100 rounded-full h-2 overflow-hidden">
                <div
                  className={`h-full rounded-full ${c.progress_percent >= 90 ? 'bg-green-500' : c.progress_percent >= 50 ? 'bg-indigo-500' : 'bg-amber-500'}`}
                  style={{ width: `${c.progress_percent}%` }}
                />
              </div>
              <span className="text-xs text-gray-500 flex-shrink-0">
                {c.lessons_completed}/{c.lessons_total} · {c.progress_percent}%
              </span>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
