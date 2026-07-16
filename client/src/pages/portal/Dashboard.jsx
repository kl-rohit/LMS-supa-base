// Parent dashboard — high-level summary for the linked student.

import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Calendar, CalendarClock, Check, IndianRupee, PlayCircle, ChevronRight, UserX, LogOut, Video,
  Sparkles, ClipboardList, ListChecks, Bell, FileText,
} from 'lucide-react';
import api from '../../utils/api';
import Loader from '../../components/Loader';
import InstallAppButton from '../../components/InstallAppButton';
import PortalBadges from '../../components/PortalBadges';
import { useAuth } from '../../contexts/AuthContext';
import { extractYouTubeId, ytThumbnail, formatDuration } from '../../utils/youtube';

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

export default function PortalDashboard() {
  const { user, signOut } = useAuth();
  const [loading, setLoading] = useState(true);
  const [student, setStudent] = useState(null);
  const [fees, setFees] = useState(null);
  const [recentClasses, setRecentClasses] = useState([]);
  const [attendanceAll, setAttendanceAll] = useState([]);
  const [continueWatching, setContinueWatching] = useState(null);
  const [upcoming, setUpcoming] = useState(null);
  const [assignments, setAssignments] = useState([]);
  const [notifications, setNotifications] = useState([]);

  const now = new Date();
  const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [me, monthFees, att, cw, up, asg, ntf] = await Promise.all([
          api.getCached('/portal/me', 'portal_me'),
          api.getCached(`/portal/fees?month=${ym}`, 'portal_fees'),
          api.getCached('/portal/attendance', 'portal_attendance'),
          api.get('/portal/continue-watching').catch(() => ({ course: null })),
          api.get('/portal/upcoming-class').catch(() => ({ upcoming: null })),
          api.get('/portal/assignments').catch(() => ({ assignments: [] })),
          api.get('/portal/notifications').catch(() => ({ notifications: [] })),
        ]);
        if (cancelled) return;
        setStudent(me.student);
        setFees(monthFees);
        const attendance = att.attendance || [];
        setRecentClasses(attendance.slice(0, 5));
        setAttendanceAll(attendance);
        setContinueWatching(cw?.course ? cw : null);
        setUpcoming(up?.upcoming || null);
        setAssignments(asg?.assignments || []);
        setNotifications(ntf?.notifications || []);
      } catch (e) {
        // /portal/me will fail if no StudentLogins row exists — show a friendly message
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [ym]);

  // "For you" feed — a single ranked list of what needs attention now, pulled
  // from data already loaded: pending homework/quizzes first (time-sensitive),
  // then unread notifications (fees, attendance, new content). Continue-watching
  // has its own card below, so it is not duplicated here.
  const feed = useMemo(() => {
    const todayStr = new Date().toISOString().slice(0, 10);
    const items = [];
    (assignments || []).filter((a) => !a.completed).forEach((a) => {
      const overdue = a.due_date && a.due_date < todayStr;
      const dueSoon = a.due_date && a.due_date >= todayStr;
      items.push({
        key: `asg-${a.id}`,
        icon: a.kind === 'quiz' ? ListChecks : ClipboardList,
        tone: a.kind === 'quiz' ? 'violet' : 'indigo',
        title: a.title || (a.kind === 'quiz' ? 'Quiz' : 'Homework'),
        subtitle: a.kind === 'quiz'
          ? (a.status === 'attempted' ? 'Quiz · retake to pass' : 'Quiz · not started')
          : 'Homework · to do',
        due: a.due_date || '',
        overdue,
        dueSoon,
        to: '/portal/assignments',
        priority: overdue ? 0 : 1,
        sortKey: a.due_date || '9999-99-99',
      });
    });
    (notifications || []).filter((n) => !n.read).forEach((n) => {
      const icon = n.type === 'fee' ? IndianRupee : n.type === 'attendance' ? Calendar : n.type === 'message' ? Bell : FileText;
      items.push({
        key: `ntf-${n.id}`,
        icon,
        tone: 'sky',
        title: n.title || 'Update',
        subtitle: n.body || '',
        to: n.link || '/portal',
        priority: 2,
        sortKey: n.created_at || '',
      });
    });
    // Actionable first (overdue → due → notifications); within a tier, soonest
    // due date first, newest notification first.
    items.sort((a, b) => (a.priority - b.priority)
      || (a.priority <= 1 ? String(a.sortKey).localeCompare(String(b.sortKey)) : String(b.sortKey).localeCompare(String(a.sortKey))));
    return items.slice(0, 6);
  }, [assignments, notifications]);

  if (loading) return <Loader />;
  if (!student) {
    const signedInEmail = user?.email || '';
    return (
      <div className="max-w-md mx-auto text-center py-12 px-4">
        <div className="w-14 h-14 rounded-full bg-amber-100 text-amber-600 flex items-center justify-center mx-auto mb-4">
          <UserX className="w-7 h-7" />
        </div>
        <p className="text-gray-900 font-semibold text-lg">Account not set up yet</p>
        <p className="text-sm text-gray-500 mt-2">
          Your teacher hasn't linked a student to this login.
          {signedInEmail && (
            <> Share this exact email with them so they can connect you:</>
          )}
        </p>
        {signedInEmail && (
          <div className="mt-3 inline-block bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm font-medium text-gray-800 break-all">
            {signedInEmail}
          </div>
        )}
        <p className="text-xs text-gray-400 mt-4">
          If you were invited with a different email, sign out and sign back in with that one.
        </p>
        <button
          onClick={signOut}
          className="mt-5 inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg border border-gray-300 text-gray-700 text-sm font-medium hover:bg-gray-50 transition-colors"
        >
          <LogOut className="w-4 h-4" /> Sign out
        </button>
      </div>
    );
  }

  const [y, m] = ym.split('-');
  const monthLabel = `${MONTHS[parseInt(m, 10) - 1]} ${y}`;

  return (
    <div className="space-y-6">
      {/* Install-as-app prompt (phones only, hidden once installed) */}
      <InstallAppButton />

      <div>
        <h2 className="text-2xl font-semibold text-gray-900">Welcome</h2>
        <p className="text-sm text-gray-500 mt-1">
          Here's a snapshot of {student.name}'s {monthLabel} so far.
        </p>
      </div>

      {/* Encouragement badges, computed from data already loaded. */}
      <PortalBadges attendance={attendanceAll} continueWatching={continueWatching} />

      {/* "For you" — everything that needs {student.name}'s attention, in one place. */}
      {feed.length > 0 && (
        <div className="card">
          <h3 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-indigo-600" />
            For you
          </h3>
          <div className="space-y-2">
            {feed.map((it) => {
              const Icon = it.icon;
              const tone = {
                indigo: 'bg-indigo-50 text-indigo-600',
                violet: 'bg-violet-50 text-violet-600',
                sky: 'bg-sky-50 text-sky-600',
              }[it.tone] || 'bg-gray-50 text-gray-600';
              return (
                <Link
                  key={it.key}
                  to={it.to}
                  className="flex items-center gap-3 p-2.5 rounded-lg border border-gray-100 hover:border-indigo-300 hover:bg-indigo-50/30 transition-colors group"
                >
                  <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${tone}`}>
                    <Icon className="w-4 h-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-gray-900 truncate">{it.title}</p>
                    {it.subtitle && <p className="text-xs text-gray-500 truncate">{it.subtitle}</p>}
                  </div>
                  {it.due && (
                    <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full whitespace-nowrap flex-shrink-0 ${it.overdue ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}`}>
                      {it.overdue ? 'Overdue' : `Due ${new Date(it.due + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}`}
                    </span>
                  )}
                  <ChevronRight className="w-4 h-4 text-gray-300 group-hover:text-indigo-500 flex-shrink-0" />
                </Link>
              );
            })}
          </div>
        </div>
      )}

      {/* Upcoming class — next scheduled occurrence from the timetable */}
      {upcoming && (
        <div className="card bg-indigo-50/60 dark:bg-indigo-500/10 border-indigo-100 dark:border-indigo-500/20">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-indigo-100 text-indigo-600 rounded-lg flex items-center justify-center flex-shrink-0">
              <CalendarClock className="w-5 h-5" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs uppercase tracking-wide text-indigo-600 font-semibold">Upcoming class</p>
              <p className="text-base font-semibold text-gray-900 truncate mt-0.5">{upcoming.name}</p>
              <p className="text-sm text-gray-600 mt-0.5">
                {upcoming.day_label}{upcoming.start_time ? ` · ${upcoming.start_time}` : ''}
                {upcoming.end_time ? `–${upcoming.end_time}` : ''}
                {upcoming.group_name ? ` · ${upcoming.group_name}` : ''}
              </p>
            </div>
            {/* Online classes get a Join button. It is emphasised once the join
                window opens (15 min before start) and stays as a quieter link
                ahead of time so parents can find the meeting in advance. */}
            {upcoming.is_online && upcoming.meeting_link && (
              <a
                href={upcoming.meeting_link}
                target="_blank"
                rel="noopener noreferrer"
                className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium flex-shrink-0 transition-colors ${
                  upcoming.join_open
                    ? 'bg-indigo-600 text-white hover:bg-indigo-700'
                    : 'bg-white text-indigo-600 border border-indigo-200 hover:bg-indigo-50'
                }`}
              >
                <Video className="w-4 h-4" />
                Join
              </a>
            )}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Link to="/portal/attendance" className="card hover:border-indigo-300 hover:shadow-md transition-all">
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
        </Link>
        <Link to="/portal/fees" className="card hover:border-indigo-300 hover:shadow-md transition-all">
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
        </Link>
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
