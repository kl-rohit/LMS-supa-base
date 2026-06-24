// NotificationBell — parent-portal header bell with unread badge + dropdown
// inbox. Polls the in-app notification feed, lets parents mark items read and
// deep-link into the relevant page, and offers a one-tap "enable push" toggle
// so reminders arrive on the lock screen (incl. installed iOS PWAs).
//
// Dark + light aware via the shared utility classes / dark: variants.

import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Bell, BellRing, Check, CheckCheck, X, BellOff,
  ClipboardList, Video, ListChecks, GraduationCap, IndianRupee, CalendarClock, Mail,
} from 'lucide-react';
import api from '../utils/api';
import usePush from '../hooks/usePush';

const POLL_MS = 60000;

// Map notification type → icon + accent.
const TYPE_META = {
  lesson:     { icon: Video,        cls: 'bg-indigo-100 text-indigo-600' },
  quiz:       { icon: ListChecks,   cls: 'bg-violet-100 text-violet-600' },
  assignment: { icon: ClipboardList,cls: 'bg-indigo-100 text-indigo-600' },
  enrollment: { icon: GraduationCap,cls: 'bg-emerald-100 text-emerald-600' },
  fee:        { icon: IndianRupee,  cls: 'bg-amber-100 text-amber-600' },
  class:      { icon: CalendarClock,cls: 'bg-sky-100 text-sky-600' },
  attendance: { icon: CalendarClock,cls: 'bg-sky-100 text-sky-600' },
  message:    { icon: Mail,         cls: 'bg-gray-100 text-gray-600' },
  general:    { icon: Bell,         cls: 'bg-gray-100 text-gray-600' },
};

function timeAgo(iso) {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const sec = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (sec < 60) return 'just now';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const d = Math.floor(hr / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}

export default function NotificationBell({
  listUrl = '/portal/notifications',
  readUrl = (id) => `/portal/notifications/${id}/read`,
  readAllUrl = '/portal/notifications/read-all',
  pushBase = '/portal',
} = {}) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);
  const [unread, setUnread] = useState(0);
  const wrapRef = useRef(null);
  const navigate = useNavigate();
  const { isSupported, permission, subscribed, busy, subscribe, unsubscribe } = usePush(pushBase);

  const fetchFeed = useCallback(async () => {
    try {
      const data = await api.get(listUrl);
      setItems(data.notifications || []);
      setUnread(data.unread || 0);
    } catch { /* table may not exist yet — keep quiet */ }
  }, [listUrl]);

  // Initial + polling.
  useEffect(() => {
    fetchFeed();
    const t = setInterval(fetchFeed, POLL_MS);
    return () => clearInterval(t);
  }, [fetchFeed]);

  // Close on outside click / Esc.
  useEffect(() => {
    if (!open) return;
    const onDown = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  const markRead = async (n) => {
    if (!n.read) {
      setItems((prev) => prev.map((x) => x.id === n.id ? { ...x, read: true } : x));
      setUnread((u) => Math.max(0, u - 1));
      try { await api.post(readUrl(n.id)); } catch { /* ignore */ }
    }
  };

  const openItem = async (n) => {
    await markRead(n);
    setOpen(false);
    if (n.link) navigate(n.link.replace(/^\/+/, '/'));
  };

  const markAll = async () => {
    setItems((prev) => prev.map((x) => ({ ...x, read: true })));
    setUnread(0);
    try { await api.post(readAllUrl); } catch { /* ignore */ }
  };

  const Icon = unread > 0 ? BellRing : Bell;

  return (
    <div className="relative" ref={wrapRef}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="relative p-2 rounded-md hover:bg-gray-100 text-gray-600 transition-colors"
        aria-label="Notifications"
      >
        <Icon className="w-5 h-5" />
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-rose-500 text-white text-[10px] font-bold flex items-center justify-center">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-80 max-w-[calc(100vw-2rem)] bg-white border border-gray-200 rounded-xl shadow-lg z-50 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
            <h3 className="text-sm font-semibold text-gray-900">Notifications</h3>
            <div className="flex items-center gap-1">
              {unread > 0 && (
                <button onClick={markAll} className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline inline-flex items-center gap-1">
                  <CheckCheck className="w-3.5 h-3.5" /> Mark all read
                </button>
              )}
              <button onClick={() => setOpen(false)} className="p-1 rounded hover:bg-gray-100 text-gray-400">
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Push enable prompt */}
          {isSupported && permission !== 'denied' && (
            <button
              onClick={subscribed ? unsubscribe : subscribe}
              disabled={busy}
              className="w-full flex items-center gap-2 px-4 py-2.5 text-xs border-b border-gray-100 text-gray-600 hover:bg-gray-50 transition-colors disabled:opacity-60"
            >
              {subscribed ? <BellOff className="w-4 h-4" /> : <BellRing className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />}
              {subscribed ? 'Turn off push notifications' : 'Enable push notifications on this device'}
            </button>
          )}

          <div className="max-h-96 overflow-y-auto">
            {items.length === 0 ? (
              <div className="px-4 py-10 text-center">
                <Bell className="w-8 h-8 mx-auto text-gray-300" />
                <p className="text-sm text-gray-500 mt-2">No notifications yet</p>
              </div>
            ) : (
              items.map((n) => {
                const meta = TYPE_META[n.type] || TYPE_META.general;
                const MIcon = meta.icon;
                return (
                  <button
                    key={n.id}
                    onClick={() => openItem(n)}
                    className={`w-full text-left flex items-start gap-3 px-4 py-3 border-b border-gray-50 hover:bg-gray-50 transition-colors ${n.read ? '' : 'bg-indigo-50/40 dark:bg-indigo-500/10'}`}
                  >
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${meta.cls} dark:bg-opacity-20`}>
                      <MIcon className="w-4 h-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start gap-2">
                        <p className={`text-sm break-words ${n.read ? 'text-gray-700' : 'font-semibold text-gray-900'}`}>{n.title}</p>
                        {!n.read && <span className="w-2 h-2 mt-1.5 rounded-full bg-indigo-500 flex-shrink-0" />}
                      </div>
                      {n.body && <p className="text-xs text-gray-500 mt-0.5 break-words whitespace-pre-wrap">{n.body}</p>}
                      <p className="text-[11px] text-gray-400 mt-1">{timeAgo(n.created_at)}</p>
                    </div>
                    {!n.read && (
                      <span
                        role="button"
                        tabIndex={0}
                        onClick={(e) => { e.stopPropagation(); markRead(n); }}
                        onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); markRead(n); } }}
                        className="p-1 rounded hover:bg-gray-200 text-gray-400 flex-shrink-0"
                        title="Mark read"
                      >
                        <Check className="w-3.5 h-3.5" />
                      </span>
                    )}
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
