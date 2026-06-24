// Academy switcher for users who belong to more than one academy.
//
// A user's relationship is per academy: they might be staff (owner / admin /
// teacher) in one and a parent in another. Each entry from /auth/me carries a
// `context` ('staff' | 'parent'). Switching academy re-resolves everything via
// AuthContext.switchOrg (a clean reload), so the correct shell loads — the
// admin app for a staff academy, the parent portal for a parent academy.
//
// Renders nothing when the user belongs to a single academy (or none).

import { useEffect, useRef, useState } from 'react';
import { Building2, Check, ChevronDown } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';

export default function OrgSwitcher() {
  const { orgs, activeOrgId, switchOrg } = useAuth();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  // Collapse the raw entries (which may list the same academy twice when a user
  // is both staff and parent there) into one row per academy, remembering which
  // contexts apply so we can badge it.
  const byOrg = new Map();
  for (const o of orgs || []) {
    const id = Number(o.org_id);
    if (!byOrg.has(id)) byOrg.set(id, { org_id: id, org_name: o.org_name, contexts: new Set() });
    byOrg.get(id).contexts.add(o.context);
  }
  const academies = [...byOrg.values()];

  // Close on outside click.
  useEffect(() => {
    if (!open) return undefined;
    const onDocClick = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  // Nothing to switch between → render nothing.
  if (academies.length < 2) return null;

  const active = academies.find((a) => a.org_id === Number(activeOrgId)) || academies[0];

  const badge = (contexts) =>
    contexts.has('staff') ? 'Staff' : 'Parent';

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title="Switch academy"
        aria-label="Switch academy"
        data-tour="org-switcher"
        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-100 transition-colors max-w-[10rem] sm:max-w-[14rem]"
      >
        <Building2 className="w-4 h-4 flex-shrink-0 text-gray-500" />
        <span className="truncate">{active?.org_name || 'Academy'}</span>
        <ChevronDown className="w-4 h-4 flex-shrink-0 text-gray-400" />
      </button>

      {open && (
        <div className="absolute right-0 mt-1 w-64 bg-white border border-gray-200 rounded-lg shadow-lg py-1 z-50">
          <p className="px-3 py-1.5 text-xs font-semibold text-gray-400 uppercase tracking-wide">
            Your academies
          </p>
          {academies.map((a) => {
            const isActive = a.org_id === Number(activeOrgId);
            return (
              <button
                key={a.org_id}
                type="button"
                onClick={() => { setOpen(false); if (!isActive) switchOrg(a.org_id); }}
                className={`w-full flex items-center gap-2 px-3 py-2 text-left text-sm transition-colors ${
                  isActive ? 'bg-indigo-50 text-indigo-700' : 'text-gray-700 hover:bg-gray-50'
                }`}
              >
                <span className="flex-1 min-w-0 truncate">{a.org_name}</span>
                <span className={`text-xs px-1.5 py-0.5 rounded-full ${
                  a.contexts.has('staff')
                    ? 'bg-indigo-100 text-indigo-700'
                    : 'bg-emerald-100 text-emerald-700'
                }`}>
                  {badge(a.contexts)}
                </span>
                {isActive && <Check className="w-4 h-4 flex-shrink-0 text-indigo-600" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
