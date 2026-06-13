// Parent dashboard — high-level summary for the linked student.

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Calendar, Check, IndianRupee, PlayCircle, ChevronRight } from 'lucide-react';
import api from '../../utils/api';
import Loader from '../../components/Loader';
import { extractYouTubeId, ytThumbnail, formatDuration } from '../../utils/youtube';

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

export default function PortalDashboard() {
  const [loading, setLoading] = useState(true);
  const [student, setStudent] = useState(null);
  const [fees, setFees] = useState(null);
  const [recentClasses, setRecentClasses] = useState([]);
  const [continueWatching, setContinueWatching] = useState(null);

  const now = new Date();
  const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [me, monthFees, att, cw] = await Promise.all([
          api.get('/portal/me'),
          api.get(`/portal/fees?month=${ym}`),
          api.get('/portal/attendance'),
          api.get('/portal/continue-watching').catch(() => ({ course: null })),
        ]);
        if (cancelled) return;
        setStudent(me.student);
        setFees(monthFees);
        const attendance = att.attendance || [];
        setRecentClasses(attendance.slice(0, 5));
        setContinueWatching(cw?.course ? cw : null);
      } catch (e) {
        // /portal/me will fail if no StudentLogins row exists — show a friendly message
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [ym]);

  if (loading) return <Loader />;
  if (!student) {
    return (
      <div className="text-center py-12">
        <p className="text-gray-700 font-medium">Account not set up yet</p>
        <p className="text-sm text-gray-500 mt-1">
          Your teacher hasn't linked a student to this login. Please contact them.
        </p>
      </div>
    );
  }

  const [y, m] = ym.split('-');
  const monthLabel = `${MONTHS[parseInt(m, 10) - 1]} ${y}`;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold text-gray-900">Welcome</h2>
        <p className="text-sm text-gray-500 mt-1">
          Here's a snapshot of {student.name}'s {monthLabel} so far.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="card">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-green-50 text-green-600 rounded-lg flex items-center justify-center">
              <Check className="w-5 h-5" />
            </div>
            <div>
              <p className="text-xs text-gray-500">Classes attended</p>
              <p className="text-2xl font-semibold text-gray-900">{fees?.classes_attended || 0}</p>
              <p className="text-xs text-gray-400">{monthLabel}</p>
            </div>
          </div>
        </div>
        <div className="card">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-indigo-50 text-indigo-600 rounded-lg flex items-center justify-center">
              <IndianRupee className="w-5 h-5" />
            </div>
            <div>
              <p className="text-xs text-gray-500">This month's fee</p>
              <p className="text-2xl font-semibold text-gray-900">
                ₹{Number(fees?.total || 0).toLocaleString('en-IN')}
              </p>
              <p className="text-xs text-gray-400">
                Class ₹{Number(fees?.class_fees || 0).toLocaleString('en-IN')}
                {fees?.additional_fees > 0 ? ` · Additional ₹${Number(fees.additional_fees).toLocaleString('en-IN')}` : ''}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Continue watching — most recently touched lesson */}
      {continueWatching?.course && continueWatching?.lesson && (() => {
        const lesson = continueWatching.lesson;
        const course = continueWatching.course;
        const ytId = extractYouTubeId(lesson.video_url);
        const pct = lesson.progress?.percent_complete || 0;
        const watched = lesson.progress?.watched_seconds || 0;
        return (
          <Link
            to={`/portal/lessons/${course.id}`}
            className="card flex items-center gap-4 hover:border-indigo-300 hover:shadow-md transition-all group"
          >
            {/* Thumbnail hidden on mobile — the title + progress bar
                below are enough for a compact card. */}
            <div className="relative flex-shrink-0 hidden sm:block">
              {ytId ? (
                <img
                  src={ytThumbnail(ytId, 'mqdefault')}
                  alt=""
                  className="w-32 h-18 rounded-lg object-cover"
                  loading="lazy"
                />
              ) : (
                <div className="w-32 h-18 rounded-lg bg-gray-100 flex items-center justify-center">
                  <PlayCircle className="w-8 h-8 text-gray-300" />
                </div>
              )}
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="w-10 h-10 rounded-full bg-black/60 flex items-center justify-center group-hover:bg-indigo-600 transition-colors">
                  <PlayCircle className="w-6 h-6 text-white" fill="white" />
                </div>
              </div>
              {/* Progress bar overlay */}
              {pct > 0 && (
                <div className="absolute bottom-0 left-0 right-0 h-1 bg-black/40 rounded-b-lg overflow-hidden">
                  <div className="h-full bg-indigo-500" style={{ width: `${pct}%` }} />
                </div>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs uppercase tracking-wide text-indigo-600 font-semibold">Continue watching</p>
              <p className="text-base font-semibold text-gray-900 truncate mt-0.5">{lesson.title}</p>
              <p className="text-xs text-gray-500 mt-0.5 truncate">{course.name}</p>
              {watched > 0 && (
                <p className="text-xs text-gray-400 mt-1">
                  At {formatDuration(watched)} · {pct}% watched
                </p>
              )}
            </div>
            <ChevronRight className="w-5 h-5 text-gray-300 group-hover:text-indigo-500 flex-shrink-0" />
          </Link>
        );
      })()}

      <div className="card">
        <h3 className="font-semibold text-gray-900 mb-4 flex items-center gap-2">
          <Calendar className="w-5 h-5 text-indigo-600" />
          Recent classes
        </h3>
        {recentClasses.length === 0 ? (
          <p className="text-sm text-gray-400 py-4 text-center">No classes recorded yet.</p>
        ) : (
          <div className="space-y-3">
            {recentClasses.map((r) => (
              <div key={r.id} className="flex items-start justify-between gap-4 py-2 border-b last:border-b-0 border-gray-100">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-800">
                    {r.date
                      ? new Date(r.date + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', weekday: 'short' })
                      : '-'}
                  </p>
                  {r.topic && <p className="text-xs text-gray-500 mt-0.5 truncate">{r.topic}</p>}
                </div>
                <span
                  className={`flex-shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${
                    r.status === 'present' ? 'bg-green-100 text-green-700'
                    : r.status === 'absent' ? 'bg-red-100 text-red-700'
                    : 'bg-amber-100 text-amber-700'
                  }`}
                >
                  {r.status}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
