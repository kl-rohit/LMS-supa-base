// First-run SETUP WIZARD — a short, skippable carousel that collects the few
// org settings worth getting right on day one: academy basics, the class modes
// offered, how fees are collected, and which tabs parents see.
//
// It is distinct from the welcome tour (OnboardingTour.jsx). The tour is a
// feature walkthrough; this wizard writes real settings via PUT /settings/app.
//
// Gating mirrors the tour: a SERVER flag ('onboarding.setup_pending') is set
// only when a brand-new org is created (auth.js signup). Established orgs have
// no flag, so they never see it. Finishing or skipping clears the flag (per
// account) and is also remembered in localStorage (per device) so it settles
// instantly even before the network round-trip lands.

import { useState, useEffect } from 'react';
import {
  X,
  ChevronRight,
  ChevronLeft,
  School,
  Layers,
  IndianRupee,
  Eye,
  Check,
} from 'lucide-react';
import api from '../utils/api';

const STORAGE_KEY = 'setup_wizard_done';

function hasFinishedLocally() {
  try { return localStorage.getItem(STORAGE_KEY) === 'done'; }
  catch { return false; }
}
function markFinishedLocally() {
  try { localStorage.setItem(STORAGE_KEY, 'done'); } catch {}
}

const MODE_ORDER = ['online', 'offline', 'group'];
const MODE_LABELS = { online: 'Online', offline: 'Offline', group: 'Group' };

export default function SetupWizard() {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [feesEnabled, setFeesEnabled] = useState(true);

  // Local working copy of the settings the wizard manages. Seeded from the
  // server so we never blow away values the owner already set.
  const [draft, setDraft] = useState({
    'school.name': '',
    'school.contact_phone': '',
    'school.contact_email': '',
    'billing.class_modes': 'online,offline,group',
    'billing.fee_mode': 'per_class',
    'billing.default_online_fee': '',
    'billing.default_offline_fee': '',
    'billing.default_group_fee': '',
    'billing.default_monthly_fee': '',
    'portal.show_lessons': 'true',
    'portal.show_fees': 'true',
    'portal.show_attendance': 'true',
  });

  // Decide once on mount. If this device has already finished, skip with no
  // network. Otherwise ask the server: only brand-new orgs have the flag set.
  useEffect(() => {
    let cancelled = false;
    if (hasFinishedLocally()) return;
    (async () => {
      try {
        const res = await api.get('/settings/app');
        if (cancelled) return;
        const s = res?.settings || {};
        if (s['onboarding.setup_pending'] !== 'true') {
          markFinishedLocally();
          return;
        }
        setFeesEnabled(s['modules.fees'] !== 'false');
        setDraft((d) => ({
          ...d,
          'school.name': s['school.name'] || '',
          'school.contact_phone': s['school.contact_phone'] || '',
          'school.contact_email': s['school.contact_email'] || '',
          'billing.class_modes': s['billing.class_modes'] || 'online,offline,group',
          'billing.fee_mode': s['billing.fee_mode'] || 'per_class',
          'billing.default_online_fee': s['billing.default_online_fee'] || '',
          'billing.default_offline_fee': s['billing.default_offline_fee'] || '',
          'billing.default_group_fee': s['billing.default_group_fee'] || '',
          'billing.default_monthly_fee': s['billing.default_monthly_fee'] || '',
          'portal.show_lessons': s['portal.show_lessons'] ?? 'true',
          'portal.show_fees': s['portal.show_fees'] ?? 'true',
          'portal.show_attendance': s['portal.show_attendance'] ?? 'true',
        }));
        setOpen(true);
      } catch {
        // Settings unavailable — leave the wizard closed (fail closed).
      }
    })();
    return () => { cancelled = true; };
  }, []);

  if (!open) return null;

  const upd = (key, value) => setDraft((d) => ({ ...d, [key]: value }));

  const selectedModes = String(draft['billing.class_modes'] || '')
    .split(',').map((m) => m.trim()).filter(Boolean);
  const hasMode = (m) => selectedModes.includes(m);
  const toggleMode = (m) => {
    const next = hasMode(m)
      ? selectedModes.filter((x) => x !== m)
      : [...selectedModes, m];
    upd('billing.class_modes', MODE_ORDER.filter((x) => next.includes(x)).join(','));
  };

  const feeMode = draft['billing.fee_mode'] || 'per_class';
  const perMonth = feeMode === 'per_month';

  const toggleFlag = (key) => upd(key, draft[key] === 'true' ? 'false' : 'true');
  const isOn = (key) => draft[key] === 'true';

  // The fee step is hidden entirely when the Fees module is off.
  const steps = [
    { id: 'basics', icon: School, title: 'Academy basics' },
    { id: 'modes', icon: Layers, title: 'How you teach' },
    ...(feesEnabled ? [{ id: 'fees', icon: IndianRupee, title: 'Fee collection' }] : []),
    { id: 'portal', icon: Eye, title: 'Parent portal' },
  ];
  const current = steps[step];
  const Icon = current.icon;
  const isLast = step === steps.length - 1;

  // Persist the managed keys plus the cleared setup flag in one PUT. Marking
  // finished is non-fatal: even on a failed save we let the owner move on.
  const finish = async () => {
    setSaving(true);
    markFinishedLocally();
    try {
      await api.put('/settings/app', {
        settings: { ...draft, 'onboarding.setup_pending': 'false' },
      });
    } catch { /* non-fatal — localStorage already suppresses it on this device */ }
    setSaving(false);
    setOpen(false);
  };

  const skip = async () => {
    setSaving(true);
    markFinishedLocally();
    try {
      await api.put('/settings/app', { settings: { 'onboarding.setup_pending': 'false' } });
    } catch { /* non-fatal */ }
    setSaving(false);
    setOpen(false);
  };

  const next = () => { if (isLast) finish(); else setStep((s) => s + 1); };
  const back = () => setStep((s) => Math.max(0, s - 1));

  return (
    <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="absolute inset-0 bg-black/50" onClick={skip} aria-hidden="true" />

      <div
        role="dialog"
        aria-modal="true"
        aria-label="Setup wizard"
        className="relative w-full sm:max-w-lg bg-white rounded-t-2xl sm:rounded-2xl shadow-xl overflow-hidden"
      >
        {/* Header band */}
        <div className="bg-indigo-600 px-6 pt-6 pb-7 text-white relative">
          <button
            onClick={skip}
            className="absolute top-3 right-3 p-1.5 rounded-full hover:bg-white/20 transition-colors"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
          <span className="inline-flex w-12 h-12 rounded-xl bg-white/15 items-center justify-center mb-3">
            <Icon className="w-6 h-6" />
          </span>
          <p className="text-xs uppercase tracking-wide text-white/70">
            Step {step + 1} of {steps.length}
          </p>
          <h3 className="text-xl font-bold leading-snug">{current.title}</h3>
        </div>

        <div className="px-6 py-5 max-h-[55vh] overflow-y-auto">
          {current.id === 'basics' && (
            <div className="space-y-4">
              <p className="text-sm text-gray-600">Tell us about your academy. You can change this any time in Settings.</p>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Academy name</label>
                <input
                  type="text"
                  value={draft['school.name']}
                  onChange={(e) => upd('school.name', e.target.value)}
                  className="input-field"
                  placeholder="Sunrise Music Academy"
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Contact phone</label>
                  <input
                    type="tel"
                    value={draft['school.contact_phone']}
                    onChange={(e) => upd('school.contact_phone', e.target.value)}
                    className="input-field"
                    placeholder="98765 43210"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Contact email</label>
                  <input
                    type="email"
                    value={draft['school.contact_email']}
                    onChange={(e) => upd('school.contact_email', e.target.value)}
                    className="input-field"
                    placeholder="hello@academy.com"
                  />
                </div>
              </div>
            </div>
          )}

          {current.id === 'modes' && (
            <div className="space-y-4">
              <p className="text-sm text-gray-600">Pick the ways you teach. These shape the fee fields on each student.</p>
              <div className="flex flex-wrap gap-2">
                {MODE_ORDER.map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => toggleMode(m)}
                    className={`rounded-full border px-4 py-2 text-sm transition ${hasMode(m) ? 'border-indigo-500 bg-indigo-50 text-indigo-700 font-medium' : 'border-gray-200 text-gray-600 hover:border-gray-300'}`}
                  >
                    {hasMode(m) && <Check className="w-3.5 h-3.5 inline -mt-0.5 mr-1" />}
                    {MODE_LABELS[m]}
                  </button>
                ))}
              </div>
            </div>
          )}

          {current.id === 'fees' && (
            <div className="space-y-5">
              <p className="text-sm text-gray-600">Choose how you collect fees. You can fine-tune amounts later per student.</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => upd('billing.fee_mode', 'per_class')}
                  className={`text-left rounded-lg border p-3 transition ${!perMonth ? 'border-indigo-500 ring-1 ring-indigo-500 bg-indigo-50' : 'border-gray-200 hover:border-gray-300'}`}
                >
                  <div className="text-sm font-semibold text-gray-900">Per class</div>
                  <div className="text-xs text-gray-500 mt-0.5">Hourly rate times classes attended.</div>
                </button>
                <button
                  type="button"
                  onClick={() => upd('billing.fee_mode', 'per_month')}
                  className={`text-left rounded-lg border p-3 transition ${perMonth ? 'border-indigo-500 ring-1 ring-indigo-500 bg-indigo-50' : 'border-gray-200 hover:border-gray-300'}`}
                >
                  <div className="text-sm font-semibold text-gray-900">Per month</div>
                  <div className="text-xs text-gray-500 mt-0.5">A flat monthly amount per student.</div>
                </button>
              </div>

              {perMonth ? (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Default monthly fee</label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">{'₹'}</span>
                    <input
                      type="number"
                      min="0"
                      value={draft['billing.default_monthly_fee']}
                      onChange={(e) => upd('billing.default_monthly_fee', e.target.value)}
                      className="input-field pl-7"
                      placeholder="2000"
                    />
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {hasMode('online') && (
                    <FeeInput label="Online ₹/hr" value={draft['billing.default_online_fee']} onChange={(v) => upd('billing.default_online_fee', v)} placeholder="500" />
                  )}
                  {hasMode('offline') && (
                    <FeeInput label="Offline ₹/hr" value={draft['billing.default_offline_fee']} onChange={(v) => upd('billing.default_offline_fee', v)} placeholder="700" />
                  )}
                  {hasMode('group') && (
                    <FeeInput label="Group ₹/hr" value={draft['billing.default_group_fee']} onChange={(v) => upd('billing.default_group_fee', v)} placeholder="350" />
                  )}
                </div>
              )}
              <p className="text-xs text-gray-400">These pre-fill the Add Student form. Leave blank to skip the pre-fill.</p>
            </div>
          )}

          {current.id === 'portal' && (
            <div className="space-y-3">
              <p className="text-sm text-gray-600">Choose which tabs parents see in their portal. You can change these any time.</p>
              <PortalToggle label="My Lessons" hint="Enrolled courses and video lessons" on={isOn('portal.show_lessons')} onClick={() => toggleFlag('portal.show_lessons')} />
              <PortalToggle label="Fees tab" hint="Monthly fee breakdown" on={isOn('portal.show_fees')} onClick={() => toggleFlag('portal.show_fees')} />
              <PortalToggle label="Class history" hint="Attendance and class records" on={isOn('portal.show_attendance')} onClick={() => toggleFlag('portal.show_attendance')} />
            </div>
          )}
        </div>

        {/* Controls */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-gray-100">
          {step > 0 ? (
            <button onClick={back} className="btn-secondary btn-sm" disabled={saving}>
              <ChevronLeft className="w-4 h-4" />
              Back
            </button>
          ) : (
            <button onClick={skip} className="text-sm text-gray-500 hover:text-gray-700 px-2" disabled={saving}>
              Skip for now
            </button>
          )}

          <button onClick={next} className="btn-primary btn-sm" disabled={saving}>
            {isLast ? (saving ? 'Saving...' : 'Finish') : 'Next'}
            {!isLast && <ChevronRight className="w-4 h-4" />}
          </button>
        </div>
      </div>
    </div>
  );
}

function FeeInput({ label, value, onChange, placeholder }) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
      <div className="relative">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">{'₹'}</span>
        <input
          type="number"
          min="0"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="input-field pl-7"
          placeholder={placeholder}
        />
      </div>
    </div>
  );
}

function PortalToggle({ label, hint, on, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full flex items-center justify-between gap-3 rounded-lg border border-gray-200 p-3 text-left hover:border-gray-300 transition"
    >
      <div>
        <div className="text-sm font-medium text-gray-900">{label}</div>
        <div className="text-xs text-gray-500">{hint}</div>
      </div>
      <span className={`relative inline-flex h-6 w-11 flex-shrink-0 rounded-full transition ${on ? 'bg-indigo-600' : 'bg-gray-300'}`}>
        <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition ${on ? 'left-[22px]' : 'left-0.5'}`} />
      </span>
    </button>
  );
}
