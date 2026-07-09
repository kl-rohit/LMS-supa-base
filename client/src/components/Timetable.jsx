// Week-at-a-glance timetable for the Classes page.
//
// Renders recurring classes (Classes.day_of_week + start/end times) as a
// time-grid on desktop (time axis × 7 day columns) and a swipeable single-day
// agenda on mobile — tuned for tuition teachers who think in weekly slots.
//
// It is DATE-AWARE: the week navigator shows real calendar dates, and a single
// occurrence can be cancelled or moved. Exceptions are stored in each class's
// `exceptions` JSON array (Classes.exceptions column) and ride along with the
// `classes` prop — no separate fetch. Cancelled occurrences are greyed with an
// undo; moved occurrences are drawn at their new slot. After a mutation we ask
// the parent to refetch classes via `onRefresh`.
//
// Roster labels are resolved client-side from the already-loaded `students`
// and `groups` arrays, so this component issues no per-class lookups.

import { useState, useEffect, useMemo, useRef } from 'react';
import {
  ChevronLeft, ChevronRight, Plus, Clock, CalendarDays, X,
  Ban, Edit2, ClipboardCheck, RotateCcw, CalendarClock,
  Monitor, MapPin, UsersRound, Wifi,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import api from '../utils/api';
import Modal from './Modal';
import { parseWorkingHours } from '../utils/workingHours';

const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const HOUR_PX = 56;       // pixels per hour in the desktop grid
const MIN_BLOCK_PX = 30;  // floor so very short slots stay tappable
const DEFAULT_START_H = 8;
const DEFAULT_END_H = 20;

const TYPE_META = {
  online:        { Icon: Monitor,   bar: 'bg-blue-500',    tint: 'bg-blue-50 border-blue-200 text-blue-900 dark:bg-blue-500/15 dark:border-blue-500/30 dark:text-blue-100' },
  offline:       { Icon: MapPin,    bar: 'bg-emerald-500', tint: 'bg-emerald-50 border-emerald-200 text-emerald-900 dark:bg-emerald-500/15 dark:border-emerald-500/30 dark:text-emerald-100' },
  offline_group: { Icon: UsersRound,bar: 'bg-purple-500',  tint: 'bg-purple-50 border-purple-200 text-purple-900 dark:bg-purple-500/15 dark:border-purple-500/30 dark:text-purple-100' },
  online_group:  { Icon: Wifi,      bar: 'bg-cyan-500',    tint: 'bg-cyan-50 border-cyan-200 text-cyan-900 dark:bg-cyan-500/15 dark:border-cyan-500/30 dark:text-cyan-100' },
};
const metaFor = (t) => TYPE_META[t] || { Icon: MapPin, bar: 'bg-gray-400', tint: 'bg-gray-50 border-gray-200 text-gray-900' };

// ---- date / time helpers (all local-time; never round-trip through UTC) ----
function fmtDateLocal(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
function startOfWeekSunday(d) {
  const x = new Date(d); x.setHours(0, 0, 0, 0);
  x.setDate(x.getDate() - x.getDay());
  return x;
}
function toMin(t) {
  if (!t) return 0;
  const [h, m] = t.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}
function fmtTime(t) {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const hh = h % 12 || 12;
  return `${hh}:${String(m).padStart(2, '0')} ${ampm}`;
}
function hourLabel(h) {
  const ampm = h >= 12 ? 'p' : 'a';
  const hh = h % 12 || 12;
  return `${hh}${ampm}`;
}
function minToTime(min) {
  const m = Math.max(0, Math.min(24 * 60 - 1, Math.round(min / 15) * 15)); // snap to 15 min
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

export default function Timetable({ classes = [], students = [], groups = [], workingHours, onAddSlot, onEditClass, onRefresh }) {
  const navigate = useNavigate();
  const today = useMemo(() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; }, []);
  const [weekStart, setWeekStart] = useState(() => startOfWeekSunday(new Date()));
  const [mobileDay, setMobileDay] = useState(() => new Date().getDay());
  const [selected, setSelected] = useState(null);     // occurrence in the action sheet
  const [resched, setResched] = useState(null);        // { occ, new_date, new_start_time, new_end_time }
  const touchX = useRef(null);

  const weekDates = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)),
    [weekStart]
  );
  const weekDateStrs = useMemo(() => weekDates.map(fmtDateLocal), [weekDates]);
  const isThisWeek = fmtDateLocal(weekStart) === fmtDateLocal(startOfWeekSunday(today));

  const studentMap = useMemo(() => {
    const m = {}; for (const s of students) m[String(s.id)] = s; return m;
  }, [students]);
  const groupMap = useMemo(() => {
    const m = {}; for (const g of groups) m[String(g.id)] = g; return m;
  }, [groups]);

  // Keep the mobile day in range and snap to today when viewing the current week.
  useEffect(() => {
    setMobileDay(isThisWeek ? new Date().getDay() : 0);
  }, [weekStart]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- build this week's concrete, dated occurrences ----
  // Each class carries its own `exceptions` array (from Classes.exceptions);
  // entries are keyed by their original `date`.
  const occurrences = useMemo(() => {
    const active = classes.filter((c) => c.is_active !== 0 && c.day_of_week != null);
    const out = [];
    for (const c of active) {
      const di = Number(c.day_of_week);
      if (di < 0 || di > 6) continue;
      const excs = Array.isArray(c.exceptions) ? c.exceptions : [];
      // 1. The recurring occurrence for this week, unless it's moved away.
      const date = weekDateStrs[di];
      const exc = excs.find((e) => e.date === date);
      if (exc?.status !== 'moved') {
        out.push({
          key: `${c.id}-${date}`,
          cls: c, date, dayIndex: di,
          start: c.start_time, end: c.end_time,
          cancelled: exc?.status === 'cancelled',
          excDate: exc ? exc.date : null,
        });
      }
      // 2. Any of this class's moved occurrences that land in the visible week.
      for (const e of excs) {
        if (e.status !== 'moved' || !e.new_date) continue;
        const mdi = weekDateStrs.indexOf(e.new_date);
        if (mdi < 0) continue;
        out.push({
          key: `mv-${c.id}-${e.date}`,
          cls: c, date: e.new_date, dayIndex: mdi,
          start: e.new_start_time || c.start_time,
          end: e.new_end_time || c.end_time,
          moved: true, movedFrom: e.date, excDate: e.date,
        });
      }
    }
    return out;
  }, [classes, weekDateStrs]);

  const byDay = useMemo(() => {
    const m = Array.from({ length: 7 }, () => []);
    for (const o of occurrences) m[o.dayIndex].push(o);
    for (const list of m) list.sort((a, b) => toMin(a.start) - toMin(b.start));
    return m;
  }, [occurrences]);

  // Per-day working hours (Settings → Working hours). Bounds the grid and
  // shades non-working time. Falls back to all-days 08:00–20:00.
  const wh = useMemo(() => parseWorkingHours(workingHours), [workingHours]);

  // Grid vertical bounds: the envelope of the configured working hours, then
  // widened to fit any actual class that sits outside it (so nothing clips).
  const { startH, endH } = useMemo(() => {
    let lo = 24 * 60, hi = 0;
    for (const d of wh) {
      if (!d.open) continue;
      lo = Math.min(lo, toMin(d.start));
      hi = Math.max(hi, toMin(d.end));
    }
    for (const o of occurrences) { lo = Math.min(lo, toMin(o.start)); hi = Math.max(hi, toMin(o.end)); }
    if (hi <= lo) return { startH: DEFAULT_START_H, endH: DEFAULT_END_H };
    return { startH: Math.floor(lo / 60), endH: Math.ceil(hi / 60) };
  }, [wh, occurrences]);
  const hours = useMemo(() => {
    const arr = []; for (let h = startH; h <= endH; h++) arr.push(h); return arr;
  }, [startH, endH]);
  const gridHeight = (endH - startH) * HOUR_PX;

  // Non-working bands (in px from the grid top) for a given day column. A
  // closed day shades the full height; an open day shades before `start` and
  // after `end`.
  const shadeBands = (dayIndex) => {
    const d = wh[dayIndex];
    if (!d || !d.open) return [{ top: 0, height: gridHeight }];
    const yFor = (min) => ((min - startH * 60) / 60) * HOUR_PX;
    const ws = yFor(toMin(d.start));
    const we = yFor(toMin(d.end));
    const bands = [];
    if (ws > 0) bands.push({ top: 0, height: ws });
    if (we < gridHeight) bands.push({ top: we, height: gridHeight - we });
    return bands;
  };
  const topFor = (start) => ((toMin(start) - startH * 60) / 60) * HOUR_PX;
  const heightFor = (start, end) => Math.max(MIN_BLOCK_PX, ((toMin(end) - toMin(start)) / 60) * HOUR_PX - 2);

  // ---- roster label (resolved from loaded students/groups) ----
  const labelFor = (cls) => {
    if (cls.group_id) {
      const g = groupMap[String(cls.group_id)];
      const extras = Array.isArray(cls.student_ids) ? cls.student_ids.length : 0;
      return `${g?.name || cls.name || 'Batch'}${extras ? ` +${extras}` : ''}`;
    }
    const ids = (cls.student_ids && cls.student_ids.length)
      ? cls.student_ids
      : (cls.student_id ? [cls.student_id] : []);
    if (ids.length === 1) return studentMap[String(ids[0])]?.name || cls.name;
    if (ids.length > 1) return `${studentMap[String(ids[0])]?.name || 'Student'} +${ids.length - 1}`;
    return cls.name;
  };

  // ---- exception actions (write to Classes.exceptions, then refetch) ----
  const cancelOccurrence = async (o) => {
    try {
      await api.post(`/classes/${o.cls.id}/exceptions`, {
        exception_date: o.date, status: 'cancelled',
      });
      toast.success('Class cancelled for this date');
      setSelected(null);
      onRefresh?.();
    } catch (err) { toast.error(err.message || 'Failed to cancel'); }
  };
  const restoreOccurrence = async (o) => {
    if (!o.excDate) { setSelected(null); return; }
    try {
      await api.delete(`/classes/${o.cls.id}/exceptions/${o.excDate}`);
      toast.success('Occurrence restored');
      setSelected(null);
      onRefresh?.();
    } catch (err) { toast.error(err.message || 'Failed to restore'); }
  };
  const saveReschedule = async () => {
    const r = resched;
    if (!r?.new_date) { toast.error('Pick a new date'); return; }
    if (toMin(r.new_end_time) <= toMin(r.new_start_time)) { toast.error('End time must be after start'); return; }
    try {
      // Key the exception by the ORIGINAL recurring date. For an already-moved
      // occurrence that's `excDate`; for a fresh one it's the occurrence's date.
      await api.post(`/classes/${r.occ.cls.id}/exceptions`, {
        exception_date: r.occ.excDate || r.occ.date,
        status: 'moved',
        new_date: r.new_date,
        new_start_time: r.new_start_time,
        new_end_time: r.new_end_time,
      });
      toast.success('Class moved');
      setResched(null);
      setSelected(null);
      onRefresh?.();
    } catch (err) { toast.error(err.message || 'Failed to move'); }
  };

  const markAttendance = (o) => {
    setSelected(null);
    navigate(`/attendance?date=${o.date}&class=${o.cls.id}`);
  };

  // Click empty space in a desktop day column → add a slot at that time.
  const handleColumnClick = (dayIndex, e) => {
    if (!onAddSlot) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const offsetY = e.clientY - rect.top;
    const minutes = startH * 60 + (offsetY / HOUR_PX) * 60;
    onAddSlot(dayIndex, minToTime(minutes));
  };

  const goWeek = (delta) => setWeekStart((w) => addDays(w, delta * 7));
  const goToday = () => setWeekStart(startOfWeekSunday(new Date()));

  const monthLabel = weekDates[0].toLocaleDateString('en-IN', { month: 'short', day: 'numeric' })
    + ' – ' + weekDates[6].toLocaleDateString('en-IN', { month: 'short', day: 'numeric', year: 'numeric' });

  const todayStr = fmtDateLocal(today);

  // ---- shared block content ----
  const BlockBody = ({ o, compact }) => {
    const m = metaFor(o.cls.class_type);
    return (
      <>
        <div className="flex items-center gap-1 min-w-0">
          {!compact && <m.Icon className="w-3 h-3 flex-shrink-0 opacity-70" />}
          <span className={`font-semibold truncate ${o.cancelled ? 'line-through opacity-60' : ''}`}>
            {labelFor(o.cls)}
          </span>
        </div>
        <div className="flex items-center gap-1 text-[11px] opacity-80 mt-0.5">
          <Clock className="w-2.5 h-2.5 flex-shrink-0" />
          <span className="truncate">{fmtTime(o.start)}–{fmtTime(o.end)}</span>
        </div>
        {(o.cancelled || o.moved) && (
          <span className="inline-block mt-0.5 text-[10px] font-bold uppercase tracking-wide">
            {o.cancelled ? 'Cancelled' : 'Moved'}
          </span>
        )}
      </>
    );
  };

  return (
    <div className="space-y-3">
      {/* Week navigator */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <button onClick={() => goWeek(-1)} className="p-2 rounded-lg hover:bg-gray-100" title="Previous week">
            <ChevronLeft className="w-4 h-4 text-gray-600" />
          </button>
          <span className="text-sm font-semibold text-gray-900 min-w-[170px] text-center">{monthLabel}</span>
          <button onClick={() => goWeek(1)} className="p-2 rounded-lg hover:bg-gray-100" title="Next week">
            <ChevronRight className="w-4 h-4 text-gray-600" />
          </button>
          {!isThisWeek && (
            <button onClick={goToday} className="px-3 py-1.5 rounded-lg text-sm font-medium bg-indigo-50 text-indigo-700 hover:bg-indigo-100 dark:bg-indigo-500/15 dark:text-indigo-300 dark:hover:bg-indigo-500/25">
              This week
            </button>
          )}
        </div>
        {onAddSlot && (
          <button onClick={() => onAddSlot(isThisWeek ? new Date().getDay() : 0, '17:00')} className="btn-primary btn-sm">
            <Plus className="w-4 h-4" /> Add Class
          </button>
        )}
      </div>

      {/* ===== Desktop / tablet: time-grid ===== */}
      <div className="hidden md:block card overflow-x-auto p-0">
        {/* Day headers */}
        <div className="grid border-b border-gray-200" style={{ gridTemplateColumns: `48px repeat(7, minmax(0, 1fr))` }}>
          <div />
          {weekDates.map((d, idx) => {
            const isToday = fmtDateLocal(d) === todayStr;
            return (
              <div key={idx} className={`px-2 py-2 text-center border-l border-gray-100 ${isToday ? 'bg-indigo-50 dark:bg-indigo-500/15' : ''}`}>
                <div className={`text-xs font-medium ${isToday ? 'text-indigo-700 dark:text-indigo-300' : 'text-gray-500'}`}>{DAY_SHORT[idx]}</div>
                <div className={`text-lg font-semibold leading-tight ${isToday ? 'text-indigo-700 dark:text-indigo-300' : 'text-gray-900'}`}>{d.getDate()}</div>
              </div>
            );
          })}
        </div>
        {/* Grid body */}
        <div className="grid" style={{ gridTemplateColumns: `48px repeat(7, minmax(0, 1fr))` }}>
          {/* time gutter */}
          <div className="relative" style={{ height: gridHeight }}>
            {hours.map((h) => (
              <div key={h} className="absolute right-1 text-[10px] text-gray-400 -translate-y-1/2 w-full text-right pr-1"
                style={{ top: (h - startH) * HOUR_PX }}>
                {hourLabel(h)}
              </div>
            ))}
          </div>
          {/* day columns */}
          {weekDates.map((d, idx) => {
            const isToday = fmtDateLocal(d) === todayStr;
            return (
              <div key={idx} onClick={(e) => handleColumnClick(idx, e)}
                className={`relative border-l border-gray-100 cursor-copy ${isToday ? 'bg-indigo-50/40 dark:bg-indigo-500/10' : ''}`}
                style={{ height: gridHeight }}
                title="Click to add a class here">
                {/* Non-working hours — shaded so the working window stands out */}
                {shadeBands(idx).map((b, i) => (
                  <div key={`shade-${i}`} className="absolute left-0 right-0 bg-gray-100/70 dark:bg-black/30 pointer-events-none"
                    style={{ top: b.top, height: b.height }} />
                ))}
                {hours.map((h) => (
                  <div key={h} className="absolute left-0 right-0 border-t border-gray-100" style={{ top: (h - startH) * HOUR_PX }} />
                ))}
                {byDay[idx].map((o) => {
                  const m = metaFor(o.cls.class_type);
                  return (
                    <button
                      key={o.key}
                      onClick={(e) => { e.stopPropagation(); setSelected(o); }}
                      className={`absolute left-0.5 right-0.5 rounded-md border pl-1.5 pr-1 py-1 text-left text-xs overflow-hidden shadow-sm hover:shadow-md transition-shadow ${m.tint} ${o.cancelled ? 'opacity-60' : ''}`}
                      style={{ top: topFor(o.start), height: heightFor(o.start, o.end) }}
                    >
                      <span className={`absolute left-0 top-0 bottom-0 w-1 rounded-l-md ${m.bar}`} />
                      <BlockBody o={o} compact />
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>

      {/* ===== Mobile: swipeable single-day agenda ===== */}
      <div className="md:hidden space-y-3">
        {/* Day pills */}
        <div className="flex gap-1.5 overflow-x-auto pb-1 -mx-1 px-1">
          {weekDates.map((d, idx) => {
            const isToday = fmtDateLocal(d) === todayStr;
            const isSel = idx === mobileDay;
            const count = byDay[idx].filter((o) => !o.cancelled).length;
            return (
              <button key={idx} onClick={() => setMobileDay(idx)}
                className={`flex-1 min-w-[44px] rounded-xl py-2 text-center border transition-colors ${
                  isSel ? 'bg-indigo-600 border-indigo-600 text-white'
                    : isToday ? 'bg-indigo-50 border-indigo-200 text-indigo-700 dark:bg-indigo-500/15 dark:border-indigo-500/30 dark:text-indigo-300' : 'bg-white border-gray-200 text-gray-600'
                }`}>
                <div className="text-[10px] font-medium">{DAY_SHORT[idx]}</div>
                <div className="text-base font-bold leading-tight">{d.getDate()}</div>
                <div className={`mt-0.5 mx-auto w-1.5 h-1.5 rounded-full ${count ? (isSel ? 'bg-white' : 'bg-indigo-500') : 'bg-transparent'}`} />
              </button>
            );
          })}
        </div>

        {/* Agenda for the selected day */}
        <div
          onTouchStart={(e) => { touchX.current = e.touches[0].clientX; }}
          onTouchEnd={(e) => {
            if (touchX.current == null) return;
            const dx = e.changedTouches[0].clientX - touchX.current;
            if (dx < -50 && mobileDay < 6) setMobileDay((d) => d + 1);
            else if (dx > 50 && mobileDay > 0) setMobileDay((d) => d - 1);
            touchX.current = null;
          }}
          className="space-y-2 min-h-[120px]"
        >
          {byDay[mobileDay].length === 0 ? (
            <div className="text-center py-10 border border-dashed border-gray-200 rounded-xl">
              <CalendarDays className="w-7 h-7 text-gray-300 mx-auto mb-1" />
              <p className="text-sm text-gray-400">
                {wh[mobileDay]?.open ? 'No classes this day' : 'Closed on this day'}
              </p>
              {onAddSlot && (
                <button onClick={() => onAddSlot(mobileDay, wh[mobileDay]?.open ? wh[mobileDay].start : '17:00')} className="text-sm text-indigo-600 font-medium mt-1">
                  + Add a class
                </button>
              )}
            </div>
          ) : (
            byDay[mobileDay].map((o) => {
              const m = metaFor(o.cls.class_type);
              return (
                <button key={o.key} onClick={() => setSelected(o)}
                  className={`w-full text-left rounded-xl border-l-4 border p-3 flex items-start gap-3 ${m.tint} ${o.cancelled ? 'opacity-60' : ''}`}
                  style={{ borderLeftColor: 'currentColor' }}>
                  <div className="text-center flex-shrink-0 w-14">
                    <div className="text-sm font-bold leading-tight">{fmtTime(o.start).replace(' ', '')}</div>
                    <div className="text-[10px] opacity-70">{fmtTime(o.end).replace(' ', '')}</div>
                  </div>
                  <div className="min-w-0 flex-1">
                    <BlockBody o={o} />
                  </div>
                </button>
              );
            })
          )}
        </div>
      </div>

      {/* ===== Occurrence action sheet ===== */}
      <Modal isOpen={!!selected} onClose={() => setSelected(null)} title={selected ? labelFor(selected.cls) : ''} size="sm">
        {selected && (
          <div className="space-y-3">
            <div className="rounded-lg bg-gray-50 px-3 py-2 text-sm text-gray-600">
              <div className="flex items-center gap-2">
                <CalendarDays className="w-4 h-4 text-gray-400" />
                {new Date(selected.date + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })}
              </div>
              <div className="flex items-center gap-2 mt-1">
                <Clock className="w-4 h-4 text-gray-400" />
                {fmtTime(selected.start)} – {fmtTime(selected.end)}
                <span className="text-xs text-gray-400">· {String(selected.cls.class_type || '').replace('_', ' ')}</span>
              </div>
              {selected.moved && (
                <div className="text-xs text-amber-600 mt-1">Moved from {selected.movedFrom}</div>
              )}
              {selected.cancelled && (
                <div className="text-xs text-red-500 mt-1">Cancelled for this date</div>
              )}
            </div>

            {selected.cancelled ? (
              <button onClick={() => restoreOccurrence(selected)} className="btn-primary w-full justify-center">
                <RotateCcw className="w-4 h-4" /> Restore this class
              </button>
            ) : (
              <div className="grid grid-cols-1 gap-2">
                <button onClick={() => markAttendance(selected)} className="btn-primary w-full justify-center">
                  <ClipboardCheck className="w-4 h-4" /> Mark attendance
                </button>
                <button
                  onClick={() => setResched({
                    occ: selected,
                    new_date: selected.date,
                    new_start_time: selected.start,
                    new_end_time: selected.end,
                  })}
                  className="btn-secondary w-full justify-center">
                  <CalendarClock className="w-4 h-4" /> Reschedule this date
                </button>
                {selected.moved ? (
                  <button onClick={() => restoreOccurrence(selected)} className="btn-secondary w-full justify-center">
                    <RotateCcw className="w-4 h-4" /> Undo move
                  </button>
                ) : (
                  <button onClick={() => cancelOccurrence(selected)} className="btn-secondary w-full justify-center text-red-600 hover:bg-red-50">
                    <Ban className="w-4 h-4" /> Cancel this date
                  </button>
                )}
                {onEditClass && (
                  <button onClick={() => { setSelected(null); onEditClass(selected.cls); }} className="btn-secondary w-full justify-center">
                    <Edit2 className="w-4 h-4" /> Edit recurring class
                  </button>
                )}
              </div>
            )}
            <p className="text-[11px] text-gray-400 text-center">
              Cancel / reschedule only affects this one date — the weekly class stays.
            </p>
          </div>
        )}
      </Modal>

      {/* ===== Reschedule modal ===== */}
      <Modal isOpen={!!resched} onClose={() => setResched(null)} title="Reschedule this class" size="sm" onSave={saveReschedule} saveLabel="Move class">
        {resched && (
          <div className="space-y-3">
            <p className="text-sm text-gray-500">
              Move just this occurrence of <span className="font-medium text-gray-700">{labelFor(resched.occ.cls)}</span> to a new date or time.
            </p>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">New date</label>
              <input type="date" value={resched.new_date}
                onChange={(e) => setResched({ ...resched, new_date: e.target.value })}
                className="input-field" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Start</label>
                <input type="time" value={resched.new_start_time}
                  onChange={(e) => setResched({ ...resched, new_start_time: e.target.value })}
                  className="input-field" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">End</label>
                <input type="time" value={resched.new_end_time}
                  onChange={(e) => setResched({ ...resched, new_end_time: e.target.value })}
                  className="input-field" />
              </div>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
