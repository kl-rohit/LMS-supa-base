import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Users,
  Calendar,
  ClipboardCheck,
  IndianRupee,
  AlertTriangle,
  Clock,
  ChevronRight,
  Eye,
  EyeOff,
  Cake,
  MessageSquare,
} from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../utils/api';
import CountUpAmount from '../components/CountUpAmount';
import Loader from '../components/Loader';
import { PageHeader, MetricCard, Panel, SectionLabel } from '../components/ConsoleUI';
import { useRevealTimer } from '../hooks/useRevealTimer';
import { normalizeMobileForWhatsApp } from '../utils/phone';
import { useOrgBranding } from '../hooks/useOrgBranding';
import InstallAppButton from '../components/InstallAppButton';
import SeatLimitNotice from '../components/SeatLimitNotice';

// Hot-wire: persist the last dashboard payload per org so counts (Total Students,
// etc.) render INSTANTLY on the next visit while we revalidate in the background.
function dashCacheKey() {
  let org = '0';
  try { org = localStorage.getItem('veena_impersonate_org_id') || localStorage.getItem('veena_active_org_id') || '0'; } catch {}
  return `veena_dash_${org}`;
}
function readDashCache() {
  try { const raw = localStorage.getItem(dashCacheKey()); if (raw) return JSON.parse(raw); } catch {}
  return null;
}

export default function Dashboard() {
  // Bank-style mask for the financial stat. Auto-hides 20s after toggle.
  const amountReveal = useRevealTimer(20000);
  const branding = useOrgBranding();
  const cached = useRef(readDashCache()).current; // read once, synchronously
  const [data, setData] = useState(cached?.data || null);
  const [birthdays, setBirthdays] = useState(cached?.birthdays || []);
  // Only block the whole screen with a loader when we have nothing to show yet.
  // With cached data we render instantly and refresh silently in the background.
  const [loading, setLoading] = useState(!cached);
  const hadData = useRef(!!cached);
  const navigate = useNavigate();

  useEffect(() => {
    fetchDashboard();
  }, []);

  const fetchDashboard = async () => {
    try {
      const [result, bday] = await Promise.all([
        api.get('/dashboard'),
        api.get('/dashboard/birthdays?days=30').catch(() => ({ birthdays: [] })),
      ]);
      setData(result);
      setBirthdays(bday.birthdays || []);
      hadData.current = true;
      try { localStorage.setItem(dashCacheKey(), JSON.stringify({ data: result, birthdays: bday.birthdays || [] })); } catch {}
    } catch (err) {
      // Stay quiet if we already have cached data on screen (e.g. a background
      // refresh failed) — only surface an error when there's nothing to show.
      if (!hadData.current) toast.error('Failed to load dashboard: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  if (loading) return <Loader text="Loading dashboard..." />;
  if (!data) return <div className="text-center py-12 text-gray-500">Failed to load dashboard data.</div>;

  const totalStudents = data.stats?.total_active_students || 0;
  const classesToday = data.upcoming_classes_today || [];
  const attendanceRateThisMonth = data.stats?.attendance_rate_this_month || 0;
  const feesCollectedThisMonth = data.stats?.total_fee_this_month || 0;
  const recentAttendance = data.recent_attendance || [];
  const absenceAlerts = data.absent_alerts || [];

  const attRate = Math.round(attendanceRateThisMonth);
  const attTone = attRate >= 80 ? 'good' : attRate >= 60 ? 'warn' : 'bad';

  const formatTime = (timeStr) => {
    if (!timeStr) return '';
    const [h, m] = timeStr.split(':');
    const hour = parseInt(h, 10);
    const ampm = hour >= 12 ? 'PM' : 'AM';
    const displayHour = hour % 12 || 12;
    return `${displayHour}:${m} ${ampm}`;
  };

  const classTypeColors = {
    online: 'border-l-blue-500 bg-blue-50',
    offline: 'border-l-emerald-500 bg-emerald-50',
    offline_group: 'border-l-purple-500 bg-purple-50',
    online_group: 'border-l-cyan-500 bg-cyan-50',
  };

  const classTypeBadge = {
    online: 'badge-online',
    offline: 'badge-offline',
    offline_group: 'badge-offline-group',
    online_group: 'badge-online',
  };

  return (
    <div className="space-y-6">
      {/* Install-as-app prompt (phones only, hidden once installed) */}
      <InstallAppButton />

      {/* Seat over-limit notice (also shown on the Students page). */}
      <SeatLimitNotice linkToStudents />

      <PageHeader
        title="Dashboard"
        subtitle={branding.name ? `${branding.name} · at a glance` : 'Your academy at a glance'}
        right={(
          <button
            onClick={amountReveal.toggle}
            className="btn-secondary btn-sm"
            title={amountReveal.revealed ? 'Hide amounts (auto-hides in 20s)' : 'Show amounts (auto-hides 20s later)'}
          >
            {amountReveal.revealed ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            {amountReveal.revealed ? 'Hide' : 'Show'} amounts
          </button>
        )}
      />

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4" data-tour="dashboard-stats">
        <MetricCard
          label="Total Students"
          value={totalStudents.toLocaleString('en-IN')}
          accent="indigo"
          icon={Users}
        />
        <MetricCard
          label="Classes Today"
          value={classesToday.length}
          accent="blue"
          icon={Calendar}
          onClick={() => navigate('/classes')}
        />
        <MetricCard
          label="Attendance Rate"
          value={`${attRate}%`}
          sub="This month"
          tone={attTone}
          accent="emerald"
          icon={ClipboardCheck}
          onClick={() => navigate('/attendance')}
        />
        <MetricCard
          label="Fees Collected"
          value={amountReveal.revealed
            ? <CountUpAmount key="fees-collected" value={feesCollectedThisMonth} />
            : '₹••••'}
          sub="This month"
          accent="amber"
          icon={IndianRupee}
          onClick={() => navigate('/fees')}
        />
      </div>

      {/* Upcoming Birthdays — next 30 days */}
      {birthdays.length > 0 && (
        <Panel
          title={<span className="flex items-center gap-1.5 text-pink-600"><Cake className="w-3.5 h-3.5" /> Upcoming Birthdays</span>}
          action={<span className="text-[11px] text-gray-400">{birthdays.length} in next 30 days</span>}
        >
          <div className="space-y-2">
            {birthdays.map((b) => {
              const isToday = b.days_until === 0;
              const isTomorrow = b.days_until === 1;
              const dobDate = new Date(b.next_birthday + 'T00:00:00');
              const phone = normalizeMobileForWhatsApp(b.mobile_number);
              const message = `🎂 Happy birthday ${b.name}! Wishing you a wonderful year ahead.${branding.name ? `\n\n— ${branding.name}` : ''}`;
              const waLink = phone ? `https://wa.me/${phone}?text=${encodeURIComponent(message)}` : null;
              return (
                <div key={b.student_id} className="flex items-center gap-3 border border-gray-100 rounded-lg px-3 py-2">
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0 ${isToday ? 'bg-pink-500 text-white' : 'bg-pink-100 text-pink-700'}`}>
                    {b.name?.[0]?.toUpperCase() || '?'}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-gray-900 leading-tight">
                      {b.name}
                      {b.turning_age > 0 && (
                        <>
                          {' '}
                          <span className="text-xs font-normal text-gray-400 ml-1">· turning {b.turning_age}</span>
                        </>
                      )}
                    </p>
                    <p className="text-xs text-gray-500 mt-1">
                      {dobDate.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', weekday: 'short' })}
                      {' · '}
                      {isToday ? <span className="font-semibold text-pink-600">TODAY 🎉</span>
                        : isTomorrow ? <span className="font-medium text-pink-600">Tomorrow</span>
                        : <>in {b.days_until} days</>}
                    </p>
                  </div>
                  {waLink && (
                    <a
                      href={waLink}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="p-2 rounded-md text-green-600 hover:bg-green-50"
                      title={`Send birthday wishes to ${b.name} on WhatsApp`}
                    >
                      <MessageSquare className="w-4 h-4" />
                    </a>
                  )}
                </div>
              );
            })}
          </div>
        </Panel>
      )}

      {/* Absence Alerts */}
      {absenceAlerts.length > 0 && (
        <Panel
          title={<span className="flex items-center gap-1.5 text-rose-600"><AlertTriangle className="w-3.5 h-3.5" /> Absence Alerts</span>}
          action={<span className="text-[11px] text-gray-400">{absenceAlerts.length} students</span>}
        >
          <div className="space-y-2">
            {absenceAlerts.map((alert, idx) => (
              <div key={idx} className="flex items-center justify-between rounded-lg px-3 py-2 border border-red-100 bg-red-50">
                <div>
                  <span className="font-medium text-gray-900">{alert.student_name || alert.name}</span>
                  <span className="text-red-600 text-sm ml-2">
                    Absent {alert.consecutive_absences || alert.absent_count} consecutive classes
                  </span>
                </div>
                <button
                  onClick={() => navigate('/messages')}
                  className="text-sm text-red-600 hover:text-red-700 font-medium"
                >
                  Send Alert
                </button>
              </div>
            ))}
          </div>
        </Panel>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
        {/* Today's Classes */}
        <Panel
          title="Today's Classes"
          action={(
            <button
              onClick={() => navigate('/attendance')}
              className="text-xs text-indigo-600 hover:text-indigo-700 font-medium flex items-center gap-1"
            >
              Mark Attendance <ChevronRight className="w-3.5 h-3.5" />
            </button>
          )}
        >
          {classesToday.length === 0 ? (
            <p className="text-gray-400 text-sm py-4 text-center">No classes scheduled today.</p>
          ) : (
            <div className="space-y-3">
              {classesToday.map((cls) => (
                <div
                  key={cls.id}
                  className={`border-l-4 rounded-lg p-3 ${classTypeColors[cls.class_type] || 'bg-gray-50 border-l-gray-300'}`}
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="font-medium text-gray-900">{cls.name}</span>
                      <div className="flex items-center gap-2 mt-1">
                        <Clock className="w-3.5 h-3.5 text-gray-400" />
                        <span className="text-sm text-gray-500">
                          {formatTime(cls.start_time)} - {formatTime(cls.end_time)}
                        </span>
                      </div>
                    </div>
                    <span className={classTypeBadge[cls.class_type] || 'badge'}>
                      {cls.class_type?.replace('_', ' ')}
                    </span>
                  </div>
                  {(cls.student_name || cls.group_name) && (
                    <p className="text-xs text-gray-500 mt-1">
                      {cls.group_name ? `Group: ${cls.group_name}` : `Student: ${cls.student_name}`}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </Panel>

        {/* Recent Attendance */}
        <Panel
          title="Recent Attendance"
          action={(
            <button
              onClick={() => navigate('/attendance')}
              className="text-xs text-indigo-600 hover:text-indigo-700 font-medium flex items-center gap-1"
            >
              View All <ChevronRight className="w-3.5 h-3.5" />
            </button>
          )}
        >
          {recentAttendance.length === 0 ? (
            <p className="text-gray-400 text-sm py-4 text-center">No recent attendance records.</p>
          ) : (
            <div className="space-y-2">
              {recentAttendance.slice(0, 8).map((record, idx) => (
                <div key={idx} className="flex items-center justify-between py-2 border-b border-gray-50 last:border-0">
                  <div>
                    <span className="text-sm font-medium text-gray-900">{record.student_name}</span>
                    <span className="text-xs text-gray-400 ml-2">{record.class_name}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full ${record.status === 'present' ? 'bg-green-500' : 'bg-red-500'}`} />
                    <span className="text-xs text-gray-500">
                      {new Date(record.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
}
