import { Flame, CheckCircle2, GraduationCap, Trophy } from 'lucide-react';

// Lightweight encouragement badges for the parent dashboard, computed entirely
// from data already loaded (attendance history + continue-watching). No extra
// API calls. Shows an attendance streak, total classes attended, and a course
// milestone when there is one to celebrate.
export default function PortalBadges({ attendance = [], continueWatching = null }) {
  const present = attendance.filter((a) => a.status === 'present');
  const totalPresent = present.length;

  // Streak: consecutive most-recent records that are 'present'.
  const sorted = [...attendance].sort((a, b) =>
    String(b.class_date || b.date || '').localeCompare(String(a.class_date || a.date || '')));
  let streak = 0;
  for (const r of sorted) { if (r.status === 'present') streak++; else break; }

  const cwPercent = continueWatching?.course?.progress_percent
    ?? continueWatching?.progress_percent
    ?? null;

  const badges = [];
  if (streak >= 2) badges.push({ icon: Flame, color: 'text-amber-500', label: `${streak}-class streak` });
  if (totalPresent > 0) badges.push({ icon: CheckCircle2, color: 'text-green-500', label: `${totalPresent} attended` });
  if (cwPercent === 100) badges.push({ icon: Trophy, color: 'text-indigo-500', label: 'Course complete' });
  else if (cwPercent != null && cwPercent > 0) badges.push({ icon: GraduationCap, color: 'text-indigo-500', label: `${cwPercent}% through a course` });

  if (!badges.length) return null;

  return (
    <div className="flex flex-wrap gap-2">
      {badges.map((b, i) => {
        const Icon = b.icon;
        return (
          <span
            key={i}
            className="inline-flex items-center gap-1.5 rounded-full bg-white ring-1 ring-gray-200 px-3 py-1.5 text-xs font-medium text-gray-700"
          >
            <Icon className={`w-4 h-4 ${b.color}`} />
            {b.label}
          </span>
        );
      })}
    </div>
  );
}
