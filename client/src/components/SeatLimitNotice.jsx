// Amber notice shown when an org's active students exceed its approved seat
// count. Self-contained: fetches seat usage from /settings/app so it can be
// dropped onto any page (Students, Dashboard, etc.) without extra wiring.
//
// Optional props:
//   activeCount — live active-student count from the host page. When provided
//                 it overrides the server figure so the notice updates as the
//                 owner sets students active/inactive.
//   linkToStudents — when true, shows a link to the Students page (used on the
//                 Dashboard where the list is not on screen).

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle } from 'lucide-react';
import api from '../utils/api';

export default function SeatLimitNotice({ activeCount, linkToStudents = false }) {
  const [seat, setSeat] = useState({ max: null, count: null });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const resp = await api.get('/settings/app');
        if (cancelled) return;
        if (resp.maxStudents !== undefined || resp.studentCount !== undefined) {
          setSeat({ max: resp.maxStudents ?? null, count: resp.studentCount ?? null });
        }
      } catch {
        // fail quiet — the notice simply stays hidden if seat info is unavailable
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const count = activeCount != null ? activeCount : seat.count;
  const overLimit = seat.max != null && count != null && count > seat.max;
  if (!overLimit) return null;
  const overBy = count - seat.max;

  return (
    <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-start gap-3" data-tour="students-seat-notice">
      <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
      <div className="text-sm">
        <p className="font-semibold text-amber-800">
          {count} active students on a {seat.max}-seat plan
        </p>
        <p className="text-amber-700 mt-1">
          You are {overBy} over your approved seat count. To keep everyone within plan,
          set {overBy} student{overBy === 1 ? '' : 's'} to inactive
          {linkToStudents ? (
            <> from the <Link to="/students" className="font-semibold underline hover:text-amber-900">Students page</Link>, or </>
          ) : (
            <> from the list below, or </>
          )}
          reach out to add more seats. Attendance and group creation stay available once your
          active students are within the seat count.
        </p>
      </div>
    </div>
  );
}
