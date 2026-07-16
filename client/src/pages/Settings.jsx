// Tabbed Settings page.
// Today: School (Phase 1) + Billing (Phase 2) + Templates (link to Messages).
// Future tabs: Notifications, Branding, Privacy, Integrations.

import { useEffect, useRef, useState } from 'react';
import { useModuleFlags } from '../hooks/useModuleFlags';
import ChangePassword from '../components/ChangePassword';
import {
  School,
  IndianRupee,
  MessageSquare,
  Save,
  Loader2,
  Phone,
  Mail,
  MapPin,
  Type,
  PenLine,
  CheckCircle2,
  ToggleLeft,
  Eye,
  Users as UsersIcon,
  UserPlus,
  Crown,
  Trash2,
  ShieldCheck,
  Camera,
  Image as ImageIcon,
  Palette,
  Sun,
  Moon,
  Monitor,
  Check,
  Clock,
  Lock,
  DatabaseBackup,
  AlertTriangle,
  Award,
  Upload,
  QrCode,
  X,
  Download,
  Settings as SettingsIcon,
} from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../utils/api';
import Loader from '../components/Loader';
import ImageCropper from '../components/ImageCropper';
import TemplatesEditor from '../components/TemplatesEditor';
import DataMigration from '../components/DataMigration';
import { useConfirm } from '../contexts/ConfirmContext';
import { invalidateOrgBranding, useOrgBranding } from '../hooks/useOrgBranding';
import { PRESETS, presetSwatch, applyTheme, saveTheme, loadTheme } from '../utils/theme';
import { DAY_NAMES, parseWorkingHours, serializeWorkingHours } from '../utils/workingHours';
import { SUPPORT_PHONE_TEL, BRAND_NAME } from '../config';
import { useNavigate, useLocation } from 'react-router-dom';

// Shape of the settings object we round-trip with the backend. Keys must
// match the whitelist in functions/api/routes/settings.js.
const EMPTY_SETTINGS = {
  'school.name': '',
  'school.signature': '',
  'school.contact_phone': '',
  'school.contact_email': '',
  'school.address': '',
  'billing.default_online_fee': '',
  'billing.default_offline_fee': '',
  'billing.default_group_fee': '',
  'billing.default_min_classes': '',
  // Fee collection mode — 'per_class' (rate × attended classes) or
  // 'per_month' (flat monthly amount per student).
  'billing.fee_mode': 'per_class',
  'billing.default_monthly_fee': '',
  // Class modes the academy offers — CSV of online / offline / group.
  'billing.class_modes': 'online,offline,group',
  // When the monthly fee-reminder cron drafts this academy's reminders —
  // 'last_day' (default) or 'fixed_day' (see billing.fee_reminder_day).
  'billing.fee_reminder_trigger': 'last_day',
  'billing.fee_reminder_day': '1',
  // Modules — string-encoded booleans ('true' / 'false').
  'modules.lessons':        'true',
  'modules.fees':           'true',
  'modules.messages':       'true',
  'modules.reports':        'true',
  'modules.camps':          'false',
  'modules.groups':         'true',
  'modules.student_photos': 'true',
  'modules.assignments':    'false',
  'modules.question_papers':'false',
  'portal.show_lessons':       'true',
  'portal.show_fees':          'true',
  'portal.show_attendance':    'true',
  'portal.allow_profile_edit': 'true',
  // Alerts — consecutive absences before an attendance alert fires (2/3/4...).
  'alerts.absence_threshold':  '2',
  // Appearance — accent theme ('default' | preset id | '#hex') + light/dark.
  'appearance.accent': 'default',
  'appearance.mode':   'light',
  // Working hours — JSON array (see utils/workingHours.js). Empty → defaults.
  'schedule.working_hours': '',
  // Online classes — provider label + a single fallback join link reused by
  // every online class that has no link of its own.
  'online.provider':     'gmeet',
  'online.default_link': '',
  // Certificate customisation — toggles are 'true'/'false' strings; *_key hold
  // a Stratus object key written by the asset-upload endpoint.
  'certificate.enabled':        'true',
  'certificate.title':          'Certificate of Completion',
  'certificate.body':           'has successfully completed the course',
  'certificate.signatory_name': '',
  'certificate.show_logo':       'true',
  'certificate.show_photo':      'false',
  'certificate.show_signature':  'true',
  'certificate.show_seal':       'true',
  'certificate.show_footer':     'true',
  'certificate.use_brand_color': 'true',
  'certificate.verify_enabled':  'true',
  'certificate.logo_key':        '',
  'certificate.signature_key':   '',
};

// Extract just the module flags that gate the sidebar nav, so we can tell when
// a save changed the visible module set (and therefore needs a reload).
function pickModuleFlags(obj) {
  const out = {};
  Object.keys(obj || {}).forEach((k) => { if (k.startsWith('modules.')) out[k] = obj[k]; });
  return out;
}

const TABS = [
  { id: 'school',       label: 'School',       icon: School },
  { id: 'schedule',     label: 'Working hours',icon: Clock },
  { id: 'appearance',   label: 'Appearance',   icon: Palette },
  { id: 'billing',      label: 'Billing',      icon: IndianRupee },
  { id: 'modules',      label: 'Modules',      icon: ToggleLeft },
  { id: 'certificate',  label: 'Certificate',  icon: Award },
  { id: 'templates',    label: 'Templates',    icon: MessageSquare },
  { id: 'organization', label: 'Organization', icon: ShieldCheck },
  { id: 'migration',    label: 'Backup & migrate', icon: DatabaseBackup },
];

export default function Settings() {
  const navigate = useNavigate();
  const location = useLocation();
  const branding = useOrgBranding();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(EMPTY_SETTINGS);
  const [savedNotice, setSavedNotice] = useState(false);
  const [activeTab, setActiveTab] = useState('school');
  const [plan, setPlan] = useState('complete');         // grandfather default
  const [entitlements, setEntitlements] = useState({}); // { lessons: bool, ... }
  // Snapshot of the module flags as last loaded/saved. The sidebar reads module
  // flags only once (useModuleFlags on mount), so when one of these changes we
  // reload after saving to keep the nav in sync.
  const navFlagsRef = useRef({});
  // Scrollable content body — reset to the top whenever the active tab changes
  // so a new tab never opens mid-scroll from the previous tab's position.
  const bodyRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api.get('/settings/app');
        const settings = res?.settings;
        if (cancelled) return;
        if (res?.plan) setPlan(res.plan);
        if (res?.entitlements) setEntitlements(res.entitlements);
        const merged = { ...EMPTY_SETTINGS, ...(settings || {}) };
        // Light/dark mode is a per-DEVICE preference (defaults to following the
        // OS), so it must NOT be overwritten by the academy's stored mode — that
        // was what made the theme flip when switching orgs. Accent DOES follow
        // the academy. So: take accent from the org, keep mode from this device.
        const deviceMode = loadTheme().mode;
        merged['appearance.mode'] = deviceMode;
        setForm(merged);
        navFlagsRef.current = pickModuleFlags(merged);
        const theme = { accent: merged['appearance.accent'], mode: deviceMode };
        applyTheme(theme);
        saveTheme(theme);
      } catch (e) {
        toast.error('Failed to load settings: ' + e.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Honor a `?tab=` query param so links can deep-link to a specific tab. The
  // onboarding tour uses this to open the Certificate tab while its "Make it
  // yours" step is showing, instead of landing on the default School tab.
  useEffect(() => {
    const wanted = new URLSearchParams(location.search).get('tab');
    if (wanted && TABS.some((t) => t.id === wanted)) setActiveTab(wanted);
  }, [location.search]);

  // Switching tabs should always open the new tab from the top, even if the
  // previous tab was scrolled halfway down.
  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = 0;
  }, [activeTab]);

  const set = (key) => (e) => {
    const v = e?.target?.value ?? e;
    setForm((f) => ({ ...f, [key]: v }));
  };

  const handleSave = async () => {
    try {
      setSaving(true);
      // Only send the keys that belong to the active concern, but easier
      // to just send them all — backend ignores anything outside its whitelist.
      const res = await api.put('/settings/app', { settings: form });
      const settings = res?.settings;
      if (res?.entitlements) setEntitlements(res.entitlements);
      if (res?.plan) setPlan(res.plan);
      const saved = { ...EMPTY_SETTINGS, ...(settings || {}) };
      setForm(saved);
      // Did any sidebar-gating module flag change? If so, the nav (read once on
      // mount) is now stale — reload so it reflects the new module set.
      const navChanged = JSON.stringify(pickModuleFlags(saved)) !== JSON.stringify(navFlagsRef.current);
      navFlagsRef.current = pickModuleFlags(saved);
      setSavedNotice(true);
      toast.success(navChanged ? 'Settings saved. Refreshing…' : 'Settings saved');
      if (navChanged) {
        setTimeout(() => window.location.reload(), 700);
        return;
      }
      setTimeout(() => setSavedNotice(false), 2500);
    } catch (e) {
      toast.error('Save failed: ' + e.message);
    } finally {
      setSaving(false);
    }
  };

  const orgName = form['school.name'] || branding.name || BRAND_NAME;
  const activeTabMeta = TABS.find((t) => t.id === activeTab) || TABS[0];
  // These tabs render their own save controls, so the shared Save bar is hidden.
  const ownsUi = activeTab === 'templates' || activeTab === 'organization' || activeTab === 'migration';

  // Close returns to wherever the gear icon was clicked from; if there's no
  // in-app history (e.g. a deep link / refresh on /settings), go to Dashboard.
  const closeSettings = () => {
    if (window.history.length > 1) navigate(-1);
    else navigate('/dashboard');
  };

  if (loading) {
    return (
      <div className="fixed inset-0 z-50 bg-gray-50 flex items-center justify-center">
        <Loader text="Loading settings..." />
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 bg-gray-50 flex flex-col">
      {/* Top bar — academy identity stays visible, plus a Close button. */}
      <header className="h-14 flex-shrink-0 flex items-center gap-2 px-3 sm:px-4 border-b border-gray-200 bg-white">
        {branding.logoUrl ? (
          <img
            src={branding.logoUrl}
            alt=""
            className="w-7 h-7 rounded-md object-cover flex-shrink-0"
            onError={(e) => { e.currentTarget.style.display = 'none'; }}
          />
        ) : (
          <img
            src={`${process.env.PUBLIC_URL || '/'}logo.png`}
            alt=""
            className="w-7 h-7 rounded-md object-cover flex-shrink-0"
          />
        )}
        <span className="font-semibold text-gray-900 truncate max-w-[38vw]">{orgName}</span>
        <span className="text-gray-300">/</span>
        <span className="text-sm text-gray-600 flex items-center gap-1.5 min-w-0">
          <SettingsIcon className="w-4 h-4 flex-shrink-0" />
          <span className="hidden sm:inline">Settings</span>
          <span className="sm:hidden truncate">{activeTabMeta.label}</span>
        </span>
        <button
          type="button"
          onClick={closeSettings}
          className="ml-auto inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-100"
        >
          <X className="w-4 h-4" /> <span className="hidden sm:inline">Close</span>
        </button>
      </header>

      <div className="flex-1 flex min-h-0">
        {/* Vertical tab rail — icons everywhere, labels alongside on desktop. */}
        <nav
          data-tour="settings-tabs"
          className="w-16 lg:w-60 flex-shrink-0 border-r border-gray-200 bg-white overflow-y-auto py-3 px-1.5 lg:px-3 space-y-1"
        >
          {TABS.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                title={tab.label}
                className={`w-full flex flex-col lg:flex-row items-center gap-1 lg:gap-3 px-1 lg:px-3 py-2.5 rounded-lg text-[10px] lg:text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-indigo-50 text-indigo-700 dark:bg-indigo-600 dark:text-white'
                    : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                }`}
              >
                <Icon className="w-5 h-5 flex-shrink-0" />
                <span className="text-center leading-tight">{tab.label}</span>
              </button>
            );
          })}
        </nav>

        {/* Content column — scrolls; the Save bar is pinned to its bottom. */}
        <div className="flex-1 min-w-0 flex flex-col">
          <div ref={bodyRef} className="flex-1 overflow-y-auto">
            <div className="p-4 lg:p-6 space-y-4">
              {activeTab === 'school'       && <SchoolTab form={form} set={set} />}
              {activeTab === 'schedule'     && <ScheduleTab form={form} setForm={setForm} />}
              {activeTab === 'appearance'   && <AppearanceTab form={form} setForm={setForm} />}
              {activeTab === 'billing'      && <BillingTab form={form} set={set} setForm={setForm} />}
              {activeTab === 'modules'      && <ModulesTab form={form} set={set} plan={plan} entitlements={entitlements} />}
              {activeTab === 'certificate'  && <CertificateTab form={form} set={set} setForm={setForm} />}
              {activeTab === 'templates'    && <TemplatesTab />}
              {activeTab === 'organization' && <OrganizationTab />}
              {activeTab === 'migration'    && <DataMigration />}
            </div>
          </div>

          {/* Save bar — hidden for tabs that own their own UI. */}
          {!ownsUi && (
            <div className="flex-shrink-0 px-4 lg:px-6 py-3 bg-white border-t border-gray-200 flex items-center justify-between">
              <span className="text-xs text-gray-500">
                {savedNotice && (
                  <span className="inline-flex items-center gap-1 text-green-700">
                    <CheckCircle2 className="w-3.5 h-3.5" /> Saved
                  </span>
                )}
              </span>
              <button
                onClick={handleSave}
                className="btn-primary"
                disabled={saving}
              >
                {saving ? <><Loader2 className="w-4 h-4 animate-spin" /> Saving...</> : <><Save className="w-4 h-4" /> Save changes</>}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ----- Tabs ------------------------------------------------------------------

function SchoolTab({ form, set }) {
  return (
    <div className="card space-y-4">
      <div>
        <h3 className="text-base font-semibold text-gray-900">School identity</h3>
        <p className="text-xs text-gray-500 mt-0.5">
          These flow into every auto-generated message via the{' '}
          <code className="font-mono text-[11px] rounded bg-gray-100 text-gray-900 px-1 py-0.5">{'{school}'}</code> and{' '}
          <code className="font-mono text-[11px] rounded bg-gray-100 text-gray-900 px-1 py-0.5">{'{signature}'}</code> placeholders. Custom templates with hardcoded names
          will keep working unchanged.
        </p>
      </div>
      <Field label="Academy name" icon={Type} hint="Used by templates that include {school}.">
        <input
          type="text"
          value={form['school.name']}
          onChange={set('school.name')}
          className="input-field"
          placeholder="e.g. Saraswati Music Academy"
        />
      </Field>
      <Field
        label="Signature"
        icon={PenLine}
        hint="Multi-line closing for messages, substituted into {signature}. Often the academy name plus teacher name."
      >
        <textarea
          value={form['school.signature']}
          onChange={set('school.signature')}
          rows={3}
          className="input-field"
          placeholder="Saraswati Music Academy"
        />
      </Field>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field label="Contact phone" icon={Phone}>
          <input
            type="tel"
            value={form['school.contact_phone']}
            onChange={set('school.contact_phone')}
            className="input-field"
            placeholder="+91 98765 43210"
          />
        </Field>
        <Field label="Contact email" icon={Mail}>
          <input
            type="email"
            value={form['school.contact_email']}
            onChange={set('school.contact_email')}
            className="input-field"
            placeholder="info@academy.com"
          />
        </Field>
      </div>
      <Field label="Address" icon={MapPin} hint="Used in future receipts + certificates.">
        <textarea
          value={form['school.address']}
          onChange={set('school.address')}
          rows={3}
          className="input-field"
          placeholder="Street, City, State, PIN"
        />
      </Field>
    </div>
  );
}

function ScheduleTab({ form, setForm }) {
  // The 7-day array is derived from the JSON string in `form`. Every edit
  // writes the serialized JSON straight back so the shared bottom Save bar
  // persists it with the rest of the settings.
  const days = parseWorkingHours(form['schedule.working_hours']);

  const writeBack = (next) => {
    setForm((f) => ({ ...f, 'schedule.working_hours': serializeWorkingHours(next) }));
  };
  const updateDay = (idx, patch) => {
    const next = days.map((d, i) => (i === idx ? { ...d, ...patch } : d));
    writeBack(next);
  };
  // Copy one day's open-window to every other OPEN day — quick way to set all
  // weekdays/weekends at once after configuring a representative day.
  const applyToAll = (idx) => {
    const src = days[idx];
    writeBack(days.map((d) => ({ ...d, start: src.start, end: src.end })));
  };

  const provider = form['online.provider'] || 'gmeet';
  const setOnline = (key) => (e) =>
    setForm((f) => ({ ...f, [key]: e?.target?.value ?? e }));

  return (
    <div className="space-y-5">
    <div className="card space-y-4">
      <div>
        <h3 className="text-base font-semibold text-gray-900">Working hours</h3>
        <p className="text-xs text-gray-500 mt-0.5">
          Set the hours you teach on each day. The Classes timetable only shows
          this range — hours outside it are greyed out, and days marked closed
          are shaded entirely. This is a visual guide; you can still add a class
          at any time.
        </p>
      </div>

      <div className="space-y-1.5">
        {days.map((d, idx) => (
          <div
            key={idx}
            className="flex flex-wrap items-center gap-x-3 gap-y-2 py-2.5 px-3 -mx-3 rounded-lg hover:bg-gray-50 transition-colors"
          >
            {/* Open / closed toggle */}
            <button
              type="button"
              onClick={() => updateDay(idx, { open: !d.open })}
              className="flex items-center gap-2.5 w-36 flex-shrink-0 text-left"
              title={d.open ? 'Open — click to close' : 'Closed — click to open'}
            >
              <span className={`flex-shrink-0 inline-flex h-6 w-11 items-center rounded-full transition-colors ${d.open ? 'bg-indigo-600' : 'bg-gray-300'}`}>
                <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${d.open ? 'translate-x-5' : 'translate-x-0.5'}`} />
              </span>
              <span className="text-sm font-medium text-gray-900">{DAY_NAMES[idx]}</span>
            </button>

            {d.open ? (
              <div className="flex flex-wrap items-center gap-2 flex-1 min-w-0">
                <input
                  type="time"
                  value={d.start}
                  onChange={(e) => updateDay(idx, { start: e.target.value })}
                  className="input-field w-auto min-w-0 py-1.5"
                />
                <span className="text-gray-400 text-sm">to</span>
                <input
                  type="time"
                  value={d.end}
                  onChange={(e) => updateDay(idx, { end: e.target.value })}
                  className="input-field w-auto min-w-0 py-1.5"
                />
                <button
                  type="button"
                  onClick={() => applyToAll(idx)}
                  className="ml-auto text-xs text-indigo-600 hover:text-indigo-700 font-medium whitespace-nowrap"
                  title="Copy these hours to every day"
                >
                  Apply to all
                </button>
              </div>
            ) : (
              <span className="text-sm text-gray-400">Closed</span>
            )}
          </div>
        ))}
      </div>
    </div>

    <div className="card space-y-4">
      <div>
        <h3 className="text-base font-semibold text-gray-900">Online classes</h3>
        <p className="text-xs text-gray-500 mt-0.5">
          Pick the tool you use for online classes, then paste a default join
          link. Any online class without its own link will use this one, so
          parents always get a Join button.
        </p>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Meeting tool</label>
        <select
          value={provider}
          onChange={setOnline('online.provider')}
          className="select-field"
        >
          <option value="gmeet">Google Meet</option>
          <option value="zoom">Zoom</option>
          <option value="zoho_meet">Zoho Meet</option>
        </select>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Default meeting link</label>
        <input
          type="url"
          value={form['online.default_link'] || ''}
          onChange={setOnline('online.default_link')}
          placeholder="https://meet.google.com/abc-defg-hij"
          className="input-field"
        />
        <p className="text-xs text-gray-400 mt-1">
          Used for any online class that has no link of its own. A per-class
          link set on the class always takes priority. Tip: Google Meet makes a
          fresh link each time, so paste a reusable room link here (for example a
          Zoom personal room or a fixed Meet/Jitsi room) so the Join button keeps
          working.
        </p>
      </div>
    </div>
    </div>
  );
}

function BillingTab({ form, set, setForm }) {
  const { featureOn } = useModuleFlags();
  const feeMode = form['billing.fee_mode'] || 'per_class';
  const perMonth = feeMode === 'per_month';

  // ---- Payment QR (static UPI per academy) ----
  // Parents see a QR on their portal Fees tab. The academy can either set a UPI
  // id (the portal builds a scan-to-pay QR from it) or upload a payment-QR
  // image. The uploaded image is stored in Stratus via the asset endpoint
  // (kind 'fee_qr'); its key lands in form['fees.qr_key'].
  const [qrData, setQrData] = useState('');     // local preview of just-picked image
  const [busyQr, setBusyQr] = useState(false);
  const [qrCropSrc, setQrCropSrc] = useState(''); // picked image awaiting crop
  const qrRef = useRef(null);
  const hasQr = !!form['fees.qr_key'] || !!qrData;

  // Pick → read to a data URL → open the cropper. The actual upload happens
  // once the academy frames the QR (uploadQr below).
  const pickQr = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) { toast.error('Please pick an image file'); return; }
    if (file.size > 8 * 1024 * 1024)     { toast.error('Image must be 8MB or smaller'); return; }
    const reader = new FileReader();
    reader.onload = () => setQrCropSrc(String(reader.result || ''));
    reader.onerror = () => toast.error('Could not read the file');
    reader.readAsDataURL(file);
    if (qrRef.current) qrRef.current.value = '';
  };

  const uploadQr = async (dataUrl) => {
    setQrCropSrc('');
    setQrData(dataUrl);
    try {
      setBusyQr(true);
      const res = await api.post('/settings/app/certificate-asset', { kind: 'fee_qr', data: dataUrl });
      setForm((f) => ({ ...f, 'fees.qr_key': res?.object_key || '' }));
      toast.success('Payment QR uploaded');
    } catch (err) {
      toast.error('Upload failed: ' + err.message);
      setQrData('');
    } finally {
      setBusyQr(false);
    }
  };

  const removeQr = async () => {
    try {
      await api.delete('/settings/app/certificate-asset?kind=fee_qr');
      setForm((f) => ({ ...f, 'fees.qr_key': '' }));
      setQrData('');
      toast.success('Payment QR removed');
    } catch (err) {
      toast.error('Could not remove: ' + err.message);
    }
  };

  // Class modes are stored as a CSV ('online,offline,group'). Parse to a set
  // for the checkboxes; write back as CSV preserving a stable order.
  const MODE_ORDER = ['online', 'offline', 'group'];
  const MODE_LABELS = { online: 'Online', offline: 'Offline', group: 'Group' };
  const selectedModes = String(form['billing.class_modes'] || '')
    .split(',')
    .map((m) => m.trim())
    .filter(Boolean);
  const hasMode = (m) => selectedModes.includes(m);
  const toggleMode = (m) => () => {
    const next = hasMode(m)
      ? selectedModes.filter((x) => x !== m)
      : [...selectedModes, m];
    const csv = MODE_ORDER.filter((x) => next.includes(x)).join(',');
    setForm((f) => ({ ...f, 'billing.class_modes': csv }));
  };
  const setMode = (mode) => () => setForm((f) => ({ ...f, 'billing.fee_mode': mode }));

  return (
    <div className="space-y-5">
      <div className="card space-y-4">
        <div>
          <h3 className="text-base font-semibold text-gray-900">Fee collection</h3>
          <p className="text-xs text-gray-500 mt-0.5">
            Choose how fees are figured for each student.
          </p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <button
            type="button"
            onClick={setMode('per_class')}
            className={`text-left rounded-lg border p-3 transition ${!perMonth ? 'border-brand-500 ring-1 ring-brand-500 bg-brand-50' : 'border-gray-200 hover:border-gray-300'}`}
          >
            <div className="text-sm font-semibold text-gray-900">Per class</div>
            <div className="text-xs text-gray-500 mt-0.5">Hourly rate times classes attended each month.</div>
          </button>
          {featureOn('fees.perStudent') && (
            <button
              type="button"
              onClick={setMode('per_month')}
              className={`text-left rounded-lg border p-3 transition ${perMonth ? 'border-brand-500 ring-1 ring-brand-500 bg-brand-50' : 'border-gray-200 hover:border-gray-300'}`}
            >
              <div className="text-sm font-semibold text-gray-900">Per month</div>
              <div className="text-xs text-gray-500 mt-0.5">A flat monthly amount per student.</div>
            </button>
          )}
        </div>

        <div>
          <h4 className="text-sm font-semibold text-gray-900">Class modes offered</h4>
          <p className="text-xs text-gray-500 mt-0.5">
            Pick the ways you teach. Only these appear on the student fee form.
          </p>
          <div className="flex flex-wrap gap-2 mt-2">
            {MODE_ORDER.map((m) => (
              <button
                key={m}
                type="button"
                onClick={toggleMode(m)}
                className={`rounded-full border px-3 py-1.5 text-sm transition ${hasMode(m) ? 'border-brand-500 bg-brand-50 text-brand-700 font-medium' : 'border-gray-200 text-gray-600 hover:border-gray-300'}`}
              >
                {MODE_LABELS[m]}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="card space-y-4">
        <div>
          <h3 className="text-base font-semibold text-gray-900">Billing defaults</h3>
          <p className="text-xs text-gray-500 mt-0.5">
            Pre-fills the Add Student form. Leave blank to skip the pre-fill.
          </p>
        </div>

        {perMonth ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Monthly fee ₹" icon={IndianRupee} hint="Flat amount charged each month per student.">
              <input
                type="number"
                min="0"
                value={form['billing.default_monthly_fee']}
                onChange={set('billing.default_monthly_fee')}
                className="input-field"
                placeholder="2000"
              />
            </Field>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {hasMode('online') && (
              <Field label="Online ₹/hr" icon={IndianRupee}>
                <input
                  type="number"
                  min="0"
                  value={form['billing.default_online_fee']}
                  onChange={set('billing.default_online_fee')}
                  className="input-field"
                  placeholder="500"
                />
              </Field>
            )}
            {hasMode('offline') && (
              <Field label="Offline ₹/hr" icon={IndianRupee}>
                <input
                  type="number"
                  min="0"
                  value={form['billing.default_offline_fee']}
                  onChange={set('billing.default_offline_fee')}
                  className="input-field"
                  placeholder="700"
                />
              </Field>
            )}
            {hasMode('group') && (
              <Field label="Group ₹/hr" icon={IndianRupee}>
                <input
                  type="number"
                  min="0"
                  value={form['billing.default_group_fee']}
                  onChange={set('billing.default_group_fee')}
                  className="input-field"
                  placeholder="350"
                />
              </Field>
            )}
            <Field label="Min classes / month" icon={IndianRupee} hint="Fees page flags students below this.">
              <input
                type="number"
                min="0"
                max="31"
                value={form['billing.default_min_classes']}
                onChange={set('billing.default_min_classes')}
                className="input-field"
                placeholder="0 = no minimum"
              />
            </Field>
          </div>
        )}
      </div>

      {/* Payment QR — static UPI per academy, shown to parents on the portal */}
      <div className="card space-y-4">
        <div className="flex items-center gap-2">
          <QrCode className="w-5 h-5 text-indigo-600" />
          <div>
            <h3 className="text-base font-semibold text-gray-900">Payment QR for parents</h3>
            <p className="text-xs text-gray-500 mt-0.5">
              Parents see a scan-to-pay QR on their Fees tab. Enter your UPI id
              and we build the QR for you, or upload your own payment QR image.
            </p>
          </div>
        </div>

        <Field label="UPI id" icon={IndianRupee} hint="e.g. academy@okhdfcbank. The portal builds a QR that opens any UPI app with the amount due prefilled.">
          <input
            type="text"
            className="input-field"
            value={form['fees.upi_id'] || ''}
            onChange={set('fees.upi_id')}
            placeholder="academy@okhdfcbank"
          />
        </Field>

        <Field label="Payee name" icon={PenLine} hint="The name shown in the parent's UPI app when they scan.">
          <input
            type="text"
            className="input-field"
            value={form['fees.payee_name'] || ''}
            onChange={set('fees.payee_name')}
            placeholder="Your Academy"
          />
        </Field>

        <Field label="Note for parents" icon={PenLine} hint="Optional line shown under the QR, e.g. a reference to add when paying.">
          <input
            type="text"
            className="input-field"
            value={form['fees.note'] || ''}
            onChange={set('fees.note')}
            placeholder="Add your child's name as the payment reference"
          />
        </Field>

        <div>
          <p className="text-sm font-medium text-gray-700 mb-2">Or upload your own QR image</p>
          <AssetUploader
            label="Payment QR image"
            icon={QrCode}
            uploaded={hasQr}
            previewSrc={qrData}
            busy={busyQr}
            inputRef={qrRef}
            onPick={pickQr}
            onRemove={removeQr}
          />
          <p className="text-xs text-gray-400 mt-2">
            An uploaded image is shown as-is. If you set both, the upload takes priority.
          </p>
        </div>
      </div>

      {/* Monthly fee reminders — when the automatic reminder drafts are made */}
      <div className="card space-y-4">
        <div className="flex items-center gap-2">
          <Clock className="w-5 h-5 text-indigo-600" />
          <div>
            <h3 className="text-base font-semibold text-gray-900">Monthly fee reminders</h3>
            <p className="text-xs text-gray-500 mt-0.5">
              Choose when this month's fee-reminder drafts are prepared for you to review and send.
            </p>
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() => setForm((f) => ({ ...f, 'billing.fee_reminder_trigger': 'last_day' }))}
            className={`text-left rounded-lg border p-3 transition ${
              (form['billing.fee_reminder_trigger'] || 'last_day') === 'last_day'
                ? 'border-brand-500 ring-1 ring-brand-500 bg-brand-50'
                : 'border-gray-200 hover:border-gray-300'
            }`}
          >
            <div className="text-sm font-semibold text-gray-900">Last day of the month</div>
            <div className="text-xs text-gray-500 mt-0.5">Works for every month automatically. No date to pick.</div>
          </button>
          <button
            type="button"
            onClick={() => setForm((f) => ({ ...f, 'billing.fee_reminder_trigger': 'fixed_day' }))}
            className={`text-left rounded-lg border p-3 transition ${
              form['billing.fee_reminder_trigger'] === 'fixed_day'
                ? 'border-brand-500 ring-1 ring-brand-500 bg-brand-50'
                : 'border-gray-200 hover:border-gray-300'
            }`}
          >
            <div className="text-sm font-semibold text-gray-900">A specific day each month</div>
            <div className="text-xs text-gray-500 mt-0.5">Pick a day from 1 to 28.</div>
          </button>
        </div>
        {form['billing.fee_reminder_trigger'] === 'fixed_day' && (
          <Field label="Day of the month" icon={Clock} hint="1 to 28, so it always exists, even in February.">
            <input
              type="number"
              min="1"
              max="28"
              value={form['billing.fee_reminder_day']}
              onChange={set('billing.fee_reminder_day')}
              className="input-field"
              placeholder="1"
            />
          </Field>
        )}
      </div>

      {qrCropSrc && (
        <ImageCropper
          src={qrCropSrc}
          aspect={1}
          mime="image/png"
          outputSize={640}
          title="Crop payment QR"
          hint="Keep the whole QR code inside the frame so it stays scannable."
          onCancel={() => setQrCropSrc('')}
          onConfirm={uploadQr}
        />
      )}
    </div>
  );
}

function AppearanceTab({ form, setForm }) {
  const accent = form['appearance.accent'] || 'default';
  const mode = form['appearance.mode'] || 'system';

  // Apply changes live (instant preview) AND cache to localStorage so the look
  // survives a reload even before the user hits Save (which persists to the
  // backend for cross-device sync). The bottom Save bar sends `form`, which
  // already carries these keys.
  const update = (patch) => {
    const next = {
      accent: patch.accent !== undefined ? patch.accent : accent,
      mode: patch.mode !== undefined ? patch.mode : mode,
    };
    setForm((f) => ({ ...f, 'appearance.accent': next.accent, 'appearance.mode': next.mode }));
    applyTheme(next);
    saveTheme(next);
  };

  const isCustom = accent !== 'default' && !PRESETS.some((p) => p.id === accent);
  const customValue = isCustom ? accent : '#4f46e5';

  return (
    <div className="space-y-5">
      {/* Theme */}
      <div className="card space-y-4">
        <div>
          <h3 className="text-base font-semibold text-gray-900">Theme</h3>
          <p className="text-xs text-gray-500 mt-0.5">
            Each theme recolours buttons, links, the active sidebar item, and the
            app/browser theme colour with its primary shade. Pick one made for your
            kind of academy — or choose a custom colour below.
          </p>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {PRESETS.map((p) => {
            const selected = accent === p.id;
            const primary = presetSwatch(p);
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => update({ accent: p.id })}
                title={p.desc || p.label}
                className={`relative text-left rounded-xl border p-3 transition-all hover:shadow-sm ${
                  selected
                    ? 'border-transparent ring-2 ring-offset-1 shadow-sm'
                    : 'border-gray-200 hover:border-gray-300'
                }`}
                style={selected ? { '--tw-ring-color': primary } : undefined}
              >
                {/* Colour strip: primary (large) + secondary + accent */}
                <span className="flex items-center gap-1.5 mb-2">
                  <span className="h-8 flex-1 rounded-md" style={{ backgroundColor: primary }} />
                  <span className="h-8 w-3 rounded-sm" style={{ backgroundColor: p.secondary }} />
                  <span className="h-8 w-3 rounded-sm" style={{ backgroundColor: p.accent }} />
                </span>
                <span className="flex items-center gap-1.5">
                  {p.emoji && <span aria-hidden className="text-sm leading-none">{p.emoji}</span>}
                  <span className={`text-sm ${selected ? 'text-gray-900 font-semibold' : 'text-gray-700 font-medium'}`}>{p.label}</span>
                  {selected && <Check className="w-4 h-4 ml-auto" style={{ color: primary }} />}
                </span>
              </button>
            );
          })}
        </div>

        <div className="border-t border-gray-100 pt-4">
          <label className="flex items-center gap-3">
            <span
              className={`w-10 h-10 rounded-full flex items-center justify-center ${isCustom ? 'ring-2 ring-offset-2 ring-gray-400' : 'border border-gray-200'}`}
              style={{ backgroundColor: customValue }}
            >
              {isCustom && <Check className="w-5 h-5 text-white" />}
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-medium text-gray-700">Custom colour</span>
              <span className="block text-xs text-gray-500">Pick any colour — the full shade range is generated for you.</span>
            </span>
            <input
              type="color"
              value={customValue}
              onChange={(e) => update({ accent: e.target.value })}
              className="ml-auto w-12 h-9 rounded-md border border-gray-300 bg-white cursor-pointer p-0.5"
            />
          </label>
        </div>
      </div>

      {/* Light / dark mode */}
      <div className="card space-y-3">
        <div>
          <h3 className="text-base font-semibold text-gray-900">Theme mode</h3>
          <p className="text-xs text-gray-500 mt-0.5">Light, dark, or match your device. This is saved for this device, so each person can pick their own.</p>
        </div>
        <div className="grid grid-cols-3 gap-3 max-w-md">
          {[
            { id: 'light', label: 'Light', icon: Sun },
            { id: 'dark', label: 'Dark', icon: Moon },
            { id: 'system', label: 'System', icon: Monitor },
          ].map((opt) => {
            const Icon = opt.icon;
            const selected = mode === opt.id;
            return (
              <button
                key={opt.id}
                type="button"
                onClick={() => update({ mode: opt.id })}
                className={`flex items-center justify-center gap-2 py-3 rounded-lg border text-sm font-medium transition-colors ${
                  selected
                    ? 'border-brand-500 ring-1 ring-brand-500 bg-brand-50 text-brand-700'
                    : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                }`}
              >
                <Icon className="w-4 h-4" /> {opt.label}
                {selected && <Check className="w-4 h-4" />}
              </button>
            );
          })}
        </div>
        <p className="text-xs text-gray-400">
          Saved per device immediately. Hit <span className="font-medium">Save changes</span> to sync it to your account so it applies on other devices too.
        </p>
      </div>
    </div>
  );
}

function TemplatesTab() {
  return <TemplatesEditor />;
}

function ModulesTab({ form, set, plan = 'complete', entitlements = {} }) {
  // Boolean-as-string helper — settings come back as 'true' / 'false'.
  const isOn = (k) => form[k] === 'true' || form[k] === true;
  const toggle = (k) => () => set(k)({ target: { value: isOn(k) ? 'false' : 'true' } });

  // A premium module is locked when the org's plan doesn't unlock it. The
  // backend (lib/plans.js) is the source of truth — `entitlements` mirrors it.
  // Default to entitled if the server didn't say, so we never falsely lock.
  const locked = (mod) => entitlements[mod] === false;
  const planLabel = plan === 'core' ? 'Core' : plan === 'complete' ? 'Complete' : plan;
  const anyLocked = locked('lessons') || locked('assignments') || locked('question_papers');

  return (
    <div className="space-y-5">
      <div className="card">
        <div className="flex items-center justify-between gap-2 mb-1">
          <div className="flex items-center gap-2">
            <ToggleLeft className="w-5 h-5 text-indigo-600" />
            <h3 className="text-base font-semibold text-gray-900">Modules enabled for this academy</h3>
          </div>
          <span className="text-[11px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700">
            {planLabel} plan
          </span>
        </div>
        <p className="text-xs text-gray-500 mb-4">
          Switch off the features you don't use. Disabled modules hide from the sidebar — students/parents won't see them either.
          {anyLocked && ' Modules marked “Complete” aren’t part of your current plan.'}
        </p>
        <div className="space-y-1">
          <ModuleToggle label="Groups"           hint="Group classes + bulk membership management" on={isOn('modules.groups')}         onClick={toggle('modules.groups')} />
          <ModuleToggle label="Fees"             hint="Monthly fee aggregation + payments + additional fees" on={isOn('modules.fees')}           onClick={toggle('modules.fees')} />
          <ModuleToggle label="Messages"         hint="WhatsApp message drafts + auto-reminders + templates" on={isOn('modules.messages')}       onClick={toggle('modules.messages')} />
          <ModuleToggle label="Reports"          hint="Attendance + fee summaries" on={isOn('modules.reports')}        onClick={toggle('modules.reports')} />
          <ModuleToggle label="Lessons"          hint="Udemy-style video courses for students" on={isOn('modules.lessons')}        onClick={toggle('modules.lessons')} locked={locked('lessons')} />
          <ModuleToggle label="Assignments"      hint="Set assignments with due dates; students submit & you grade them" on={isOn('modules.assignments')}    onClick={toggle('modules.assignments')} locked={locked('assignments')} />
          <ModuleToggle label="Question papers"  hint="Share past papers & practice sets (PDF/Drive links) for download" on={isOn('modules.question_papers')} onClick={toggle('modules.question_papers')} locked={locked('question_papers')} />
          <ModuleToggle label="Camps"            hint="Time-bounded special programs (workshops, intensives)" on={isOn('modules.camps')}          onClick={toggle('modules.camps')} />
          <ModuleToggle label="Student photos"   hint="Photo uploads in profile + avatar on Students list" on={isOn('modules.student_photos')} onClick={toggle('modules.student_photos')} />
        </div>
        {anyLocked && (
          <div className="mt-4 flex items-start gap-2 rounded-lg bg-amber-50 border border-amber-100 px-3 py-2.5">
            <Lock className="w-4 h-4 text-amber-500 mt-0.5 flex-shrink-0" />
            <p className="text-xs text-amber-800">
              Online learning modules are part of the <span className="font-semibold">Complete</span> plan.
              To unlock Lessons, Assignments and Question papers, <a href={`tel:${SUPPORT_PHONE_TEL}`} className="font-semibold underline">contact us to upgrade</a>.
            </p>
          </div>
        )}
      </div>

      <div className="card">
        <div className="flex items-center gap-2 mb-1">
          <Eye className="w-5 h-5 text-indigo-600" />
          <h3 className="text-base font-semibold text-gray-900">Parent portal visibility</h3>
        </div>
        <p className="text-xs text-gray-500 mb-4">
          Choose what parents see when they log in. Class History is always visible.
        </p>
        <div className="space-y-1">
          <ModuleToggle label="My Lessons"        hint="Parents see enrolled courses + watch lessons" on={isOn('portal.show_lessons')}       onClick={toggle('portal.show_lessons')} />
          <ModuleToggle label="Fees tab"          hint="Parents can see their fee breakdown by month" on={isOn('portal.show_fees')}          onClick={toggle('portal.show_fees')} />
          <ModuleToggle label="Class history"     hint="Parents can see their attendance / class history" on={isOn('portal.show_attendance')}    onClick={toggle('portal.show_attendance')} />
          <ModuleToggle label="Profile editing"   hint="Parents can edit name, DOB, address, photo. Disable to lock the profile." on={isOn('portal.allow_profile_edit')} onClick={toggle('portal.allow_profile_edit')} />
        </div>
      </div>

      <div className="card">
        <div className="flex items-center gap-2 mb-1">
          <AlertTriangle className="w-5 h-5 text-indigo-600" />
          <h3 className="text-base font-semibold text-gray-900">Attendance alerts</h3>
        </div>
        <p className="text-xs text-gray-500 mb-4">
          How many classes in a row a student can miss before they show up in the absence-alert banner on the Attendance page.
        </p>
        <div className="flex items-center gap-3">
          <label className="text-sm text-gray-700">Alert after</label>
          <select
            value={form['alerts.absence_threshold'] || '2'}
            onChange={set('alerts.absence_threshold')}
            className="input-field w-auto"
          >
            <option value="2">2 absences in a row</option>
            <option value="3">3 absences in a row</option>
            <option value="4">4 absences in a row</option>
            <option value="5">5 absences in a row</option>
          </select>
        </div>
      </div>

      <SetupGuideCard />
    </div>
  );
}

// Lets an owner replay the first-run setup guide on demand (e.g. to revisit the
// class-mode / fee-model choices). Flips the server-side onboarding flag back
// on, clears the per-device "done" marker, then reloads so the wizard mounts.
function SetupGuideCard() {
  const [busy, setBusy] = useState(false);
  const rerun = async () => {
    try {
      setBusy(true);
      await api.put('/settings/app', { settings: { 'onboarding.setup_pending': 'true' } });
      try { localStorage.removeItem('setup_wizard_done'); } catch {}
      toast.success('Opening the setup guide…');
      // Hard reload (not router navigate) so the wizard remounts fresh. Prepend
      // PUBLIC_URL because location.assign bypasses the router basename — under
      // Catalyst the app lives at /app/, so a bare '/dashboard' 404s.
      const base = (process.env.PUBLIC_URL || '/').replace(/\/$/, '');
      setTimeout(() => window.location.assign(`${base}/dashboard`), 500);
    } catch (e) {
      toast.error('Could not start the setup guide: ' + e.message);
      setBusy(false);
    }
  };
  return (
    <div className="card">
      <div className="flex items-center gap-2 mb-1">
        <School className="w-5 h-5 text-indigo-600" />
        <h3 className="text-base font-semibold text-gray-900">Setup guide</h3>
      </div>
      <p className="text-xs text-gray-500 mb-4">
        Run the short first-time setup again to revisit your class modes, fee model and parent-portal choices.
      </p>
      <button onClick={rerun} disabled={busy} className="btn-secondary">
        {busy ? <><Loader2 className="w-4 h-4 animate-spin" /> Opening…</> : 'Re-run setup guide'}
      </button>
    </div>
  );
}

function OrganizationTab() {
  const confirm = useConfirm();
  const [loading, setLoading] = useState(true);
  const [org, setOrg] = useState(null);
  const [role, setRole] = useState('');
  const [members, setMembers] = useState([]);
  const [editingName, setEditingName] = useState(false);
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteForm, setInviteForm] = useState({ email: '', first_name: '', last_name: '' });
  const [inviting, setInviting] = useState(false);
  // Logo state — picked file as a data URL, plus the currently-signed URL
  // for display.
  const [logoUrl, setLogoUrl] = useState('');
  const [logoPending, setLogoPending] = useState('');
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const logoInputRef = useRef(null);

  const isOwner = role === 'owner' || role === 'platform_admin';

  const fetchOrg = async () => {
    setLoading(true);
    try {
      const [data, logoRes] = await Promise.all([
        api.get('/organization'),
        api.get('/organization/logo-url').catch(() => ({ logo_url: '' })),
      ]);
      setOrg(data.org); setRole(data.role); setMembers(data.members || []);
      setName(data.org?.name || '');
      setLogoUrl(logoRes?.logo_url || '');
    } catch (e) {
      toast.error('Failed to load organization: ' + e.message);
    } finally { setLoading(false); }
  };
  useEffect(() => { fetchOrg(); }, []);

  const saveName = async () => {
    try {
      setSaving(true);
      await api.put('/organization', { name: name.trim() });
      // Tell the layouts to refetch branding so the sidebar updates immediately.
      invalidateOrgBranding();
      toast.success('Academy name updated — refresh the page to see it in the sidebar');
      setEditingName(false);
      fetchOrg();
    } catch (e) {
      toast.error('Save failed: ' + e.message);
    } finally { setSaving(false); }
  };

  const handlePickLogo = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) { toast.error('Please pick an image file'); return; }
    if (file.size > 8 * 1024 * 1024)   { toast.error('Logo must be 8MB or smaller'); return; }
    const reader = new FileReader();
    reader.onload  = () => setLogoPending(String(reader.result || ''));
    reader.onerror = () => toast.error('Could not read the file');
    reader.readAsDataURL(file);
  };

  const uploadLogo = async () => {
    if (!logoPending) return;
    try {
      setUploadingLogo(true);
      const { logo_url } = await api.post('/organization/logo', { data: logoPending });
      setLogoUrl(logo_url || '');
      setLogoPending('');
      if (logoInputRef.current) logoInputRef.current.value = '';
      invalidateOrgBranding();
      toast.success('Logo updated — refresh to see it in the sidebar');
    } catch (e) {
      toast.error('Logo upload failed: ' + e.message);
    } finally {
      setUploadingLogo(false);
    }
  };

  const looksLikeEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);

  const sendInvite = async (e) => {
    e?.preventDefault?.();
    if (!inviteForm.email.trim()) return toast.error('Email required');
    if (!looksLikeEmail(inviteForm.email.trim())) {
      return toast.error('Please enter a valid email address.');
    }
    try {
      setInviting(true);
      await api.post('/organization/invite', inviteForm);
      toast.success('Invite sent — they\'ll get an email to set their password');
      setInviteOpen(false);
      setInviteForm({ email: '', first_name: '', last_name: '' });
      fetchOrg();
    } catch (e) {
      toast.error('Invite failed: ' + (e.message || 'unknown'));
    } finally { setInviting(false); }
  };

  const removeMember = async (m) => {
    const ok = await confirm({
      title: `Remove ${m.display || m.email || 'this member'}?`,
      message: 'They will no longer have access to this academy. Their login account stays; only their membership in this academy is removed.',
      confirmText: 'Remove',
    });
    if (!ok) return;
    try {
      await api.delete(`/organization/members/${m.id}`);
      toast.success('Member removed');
      fetchOrg();
    } catch (e) {
      toast.error('Remove failed: ' + e.message);
    }
  };

  const transferOwnership = async (m) => {
    const ok = await confirm({
      title: `Make ${m.display || m.email || 'this teacher'} the new owner?`,
      message: 'You will become a teacher of this academy. They will have full owner rights including the ability to remove you. This cannot be easily undone.',
      confirmText: 'Transfer ownership',
    });
    if (!ok) return;
    try {
      await api.post('/organization/transfer-ownership', { membership_id: m.id });
      toast.success('Ownership transferred');
      fetchOrg();
    } catch (e) {
      toast.error('Transfer failed: ' + e.message);
    }
  };

  if (loading) return <div className="card text-sm text-gray-500 flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Loading organization...</div>;
  if (!org) return <div className="card text-sm text-red-600">Could not load organization data.</div>;

  return (
    <div className="space-y-5">
      {/* Org identity + branding */}
      <div className="card space-y-4">
        <h3 className="text-base font-semibold text-gray-900">Organization</h3>

        {/* Logo block — the same image is what shows in the sidebar */}
        <div className="flex items-start gap-4">
          <div className="flex-shrink-0">
            {logoPending || logoUrl ? (
              <img
                src={logoPending || logoUrl}
                alt=""
                className="w-20 h-20 rounded-xl object-cover border-2 border-indigo-100 shadow-sm"
              />
            ) : (
              <div className="w-20 h-20 rounded-xl bg-indigo-50 border-2 border-dashed border-indigo-200 flex items-center justify-center">
                <ImageIcon className="w-8 h-8 text-indigo-300" />
              </div>
            )}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-gray-700">Logo</p>
            <p className="text-xs text-gray-500 mt-0.5">
              Replaces the default music icon in the sidebar + browser tab. Square images render best.
            </p>
            {isOwner && (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <input
                  ref={logoInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handlePickLogo}
                  className="hidden"
                  id="org-logo-input"
                />
                <label htmlFor="org-logo-input" className="btn-secondary btn-sm cursor-pointer">
                  <Camera className="w-3.5 h-3.5" /> Choose file
                </label>
                {logoPending && (
                  <>
                    <button onClick={uploadLogo} disabled={uploadingLogo} className="btn-primary btn-sm">
                      {uploadingLogo ? (<><Loader2 className="w-3.5 h-3.5 animate-spin" /> Uploading...</>) : (<><Save className="w-3.5 h-3.5" /> Upload</>)}
                    </button>
                    <button onClick={() => { setLogoPending(''); if (logoInputRef.current) logoInputRef.current.value=''; }} className="text-xs text-gray-500 hover:text-gray-700 underline">
                      Cancel
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Academy name (inline edit) */}
        <div className="border-t border-gray-100 pt-4">
          <p className="text-sm font-medium text-gray-700 mb-1">Academy name</p>
          {editingName ? (
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="input-field"
                maxLength={200}
                autoFocus
              />
              <button onClick={saveName} disabled={saving} className="btn-primary btn-sm">
                {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                Save
              </button>
              <button onClick={() => { setEditingName(false); setName(org.name); }} className="btn-secondary btn-sm">Cancel</button>
            </div>
          ) : (
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="text-lg font-semibold text-gray-900 truncate">{org.name}</p>
                <p className="text-xs text-gray-500">
                  Shown in the sidebar, browser tab, and as <code>{'{school}'}</code> in message templates.
                  · Slug: <code>{org.slug}</code> · Plan: <code>{org.plan || 'free'}</code>
                </p>
              </div>
              {isOwner && (
                <button onClick={() => setEditingName(true)} className="btn-secondary btn-sm flex-shrink-0">Rename</button>
              )}
            </div>
          )}
        </div>

        <p className="text-xs text-gray-500">
          Your role: <span className="font-medium text-gray-700">{role}</span>
        </p>
      </div>

      {/* Members list */}
      <div className="card">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <UsersIcon className="w-5 h-5 text-indigo-600" />
            <h3 className="text-base font-semibold text-gray-900">Members ({members.length})</h3>
          </div>
          {isOwner && (
            <button onClick={() => setInviteOpen(!inviteOpen)} className="btn-primary btn-sm">
              <UserPlus className="w-4 h-4" /> Invite teacher
            </button>
          )}
        </div>

        {inviteOpen && (
          <form onSubmit={sendInvite} className="border border-gray-200 rounded-lg p-3 mb-3 space-y-2 bg-gray-50">
            <p className="text-xs text-gray-600">
              They'll receive an email to set their password. After they sign in,
              they get a teacher role — full admin access to this academy except
              ownership transfer.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <input
                type="email"
                value={inviteForm.email}
                onChange={(e) => setInviteForm({ ...inviteForm, email: e.target.value })}
                className="input-field"
                placeholder="teacher@example.com"
                required
                autoFocus
              />
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="text"
                  value={inviteForm.first_name}
                  onChange={(e) => setInviteForm({ ...inviteForm, first_name: e.target.value })}
                  className="input-field"
                  placeholder="First name"
                />
                <input
                  type="text"
                  value={inviteForm.last_name}
                  onChange={(e) => setInviteForm({ ...inviteForm, last_name: e.target.value })}
                  className="input-field"
                  placeholder="Last (optional)"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <button type="button" onClick={() => setInviteOpen(false)} className="btn-secondary btn-sm">Cancel</button>
              <button type="submit" disabled={inviting} className="btn-primary btn-sm">
                {inviting ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Sending...</> : <>Send invite</>}
              </button>
            </div>
          </form>
        )}

        <div className="divide-y divide-gray-100">
          {members.map((m) => (
            <div key={m.id} className="flex items-center gap-3 py-3">
              <div className="w-9 h-9 rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center text-sm font-semibold flex-shrink-0">
                {(m.display || m.email || '?').slice(0, 1).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-sm font-medium text-gray-900 truncate">{m.display || m.email || m.user_id}</span>
                  {m.role === 'owner' && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 text-xs font-medium">
                      <Crown className="w-3 h-3" /> owner
                    </span>
                  )}
                  {m.role === 'teacher' && (
                    <span className="px-2 py-0.5 rounded-full bg-gray-100 text-gray-700 text-xs font-medium">teacher</span>
                  )}
                  {m.role === 'parent' && (
                    <span className="px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 text-xs font-medium">parent</span>
                  )}
                  {m.status === 'invited' && (
                    <span className="px-2 py-0.5 rounded-full bg-yellow-50 text-yellow-700 text-xs font-medium">invite pending</span>
                  )}
                </div>
                {m.email && <p className="text-xs text-gray-500 truncate">{m.email}</p>}
              </div>
              {isOwner && m.role !== 'owner' && m.status === 'active' && (
                <>
                  <button
                    onClick={() => transferOwnership(m)}
                    className="btn-sm bg-amber-50 text-amber-700 border border-amber-200 hover:bg-amber-100 rounded-lg flex items-center gap-1 px-2 py-1 text-xs"
                    title="Make this user the new owner"
                  >
                    <Crown className="w-3.5 h-3.5" /> Transfer
                  </button>
                  <button
                    onClick={() => removeMember(m)}
                    className="btn-sm bg-red-50 text-red-600 border border-red-200 hover:bg-red-100 rounded-lg flex items-center gap-1 px-2 py-1 text-xs"
                  >
                    <Trash2 className="w-3.5 h-3.5" /> Remove
                  </button>
                </>
              )}
            </div>
          ))}
        </div>
      </div>

      <ChangePassword />
    </div>
  );
}

function ModuleToggle({ label, hint, on, onClick, locked = false }) {
  if (locked) {
    // Plan doesn't include this module — show it disabled with an upgrade chip
    // instead of a working toggle.
    return (
      <div className="w-full flex items-center justify-between gap-3 py-2.5 px-3 -mx-3 rounded-lg opacity-80">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 text-sm font-medium text-gray-500">
            <Lock className="w-3.5 h-3.5 text-gray-400" /> {label}
          </div>
          <div className="text-xs text-gray-400 mt-0.5">{hint}</div>
        </div>
        <span className="flex-shrink-0 text-[10px] font-bold uppercase tracking-wide px-2 py-1 rounded-full bg-gray-100 text-gray-500">
          Complete
        </span>
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full flex items-center justify-between gap-3 py-2.5 px-3 -mx-3 rounded-lg hover:bg-gray-50 transition-colors text-left"
    >
      <div className="min-w-0">
        <div className="text-sm font-medium text-gray-900">{label}</div>
        <div className="text-xs text-gray-500 mt-0.5">{hint}</div>
      </div>
      <span className={`flex-shrink-0 inline-flex h-6 w-11 items-center rounded-full transition-colors ${on ? 'bg-indigo-600' : 'bg-gray-300'}`}>
        <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${on ? 'translate-x-5' : 'translate-x-0.5'}`} />
      </span>
    </button>
  );
}

// ----- Certificate customisation --------------------------------------------

function CertificateTab({ form, set, setForm }) {
  const isOn = (k) => form[k] === 'true' || form[k] === true;
  const toggle = (k) => () => set(k)({ target: { value: isOn(k) ? 'false' : 'true' } });

  // Local previews of the just-picked images (data URLs). Used to render the
  // thumbnail AND embedded into the live preview PDF (the saved key only yields
  // a server-side data URL on the real download).
  const [logoData, setLogoData] = useState('');
  const [sigData, setSigData] = useState('');
  const [busyLogo, setBusyLogo] = useState(false);
  const [busySig, setBusySig] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [previewUrl, setPreviewUrl] = useState('');
  const logoRef = useRef(null);
  const sigRef = useRef(null);

  // Revoke the blob URL when the modal closes or the component unmounts.
  const closePreview = () => {
    setPreviewUrl((u) => { if (u) { try { URL.revokeObjectURL(u); } catch {} } return ''; });
  };
  useEffect(() => () => { if (previewUrl) { try { URL.revokeObjectURL(previewUrl); } catch {} } }, [previewUrl]);

  const pick = (kind, setData, ref) => (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) { toast.error('Please pick an image file'); return; }
    if (file.size > 8 * 1024 * 1024)     { toast.error('Image must be 8MB or smaller'); return; }
    const reader = new FileReader();
    reader.onload  = () => {
      const dataUrl = String(reader.result || '');
      setData(dataUrl);
      upload(kind, dataUrl, ref);
    };
    reader.onerror = () => toast.error('Could not read the file');
    reader.readAsDataURL(file);
  };

  const upload = async (kind, dataUrl, ref) => {
    const setBusy = kind === 'logo' ? setBusyLogo : setBusySig;
    try {
      setBusy(true);
      const res = await api.post('/settings/app/certificate-asset', { kind, data: dataUrl });
      // Persist the returned key into the form so the next Save keeps it (and
      // never clobbers it back to empty).
      setForm((f) => ({ ...f, [`certificate.${kind}_key`]: res?.object_key || '' }));
      if (ref?.current) ref.current.value = '';
      toast.success(`${kind === 'logo' ? 'Logo' : 'Signature'} uploaded`);
    } catch (err) {
      toast.error('Upload failed: ' + err.message);
      if (kind === 'logo') setLogoData(''); else setSigData('');
    } finally {
      setBusy(false);
    }
  };

  const removeAsset = async (kind) => {
    try {
      await api.delete(`/settings/app/certificate-asset?kind=${kind}`);
      setForm((f) => ({ ...f, [`certificate.${kind}_key`]: '' }));
      if (kind === 'logo') setLogoData(''); else setSigData('');
      toast.success(`${kind === 'logo' ? 'Logo' : 'Signature'} removed`);
    } catch (err) {
      toast.error('Could not remove: ' + err.message);
    }
  };

  const runPreview = async () => {
    try {
      setPreviewing(true);
      const { previewCertificate } = await import('../utils/certificate');
      const verifyOn = isOn('certificate.verify_enabled');
      const { url } = await previewCertificate({
        student_name: 'Sample Student',
        course_name: 'Sample Course',
        academy_name: form['school.name'] || 'Your Academy',
        lessons_total: 8,
        completed_at: new Date().toISOString(),
        certificate_id: 'CERT-PREVIEW',
        title: form['certificate.title'] || 'Certificate of Completion',
        body: form['certificate.body'] || 'has successfully completed the course',
        signatory_name: form['certificate.signatory_name'] || '',
        show_logo: isOn('certificate.show_logo'),
        show_photo: false, // no sample photo in preview
        show_signature: isOn('certificate.show_signature'),
        show_seal: isOn('certificate.show_seal'),
        show_footer: isOn('certificate.show_footer'),
        use_brand_color: isOn('certificate.use_brand_color'),
        accent: form['appearance.accent'] || 'default',
        logo_data: isOn('certificate.show_logo') ? logoData : '',
        signature_data: isOn('certificate.show_signature') ? sigData : '',
        student_photo_data: '',
        contact_phone: form['school.contact_phone'] || '',
        contact_email: form['school.contact_email'] || '',
        verify_code: verifyOn ? 'preview' : '',
        verify_url: verifyOn ? '/app/verify/CERT-PREVIEW?c=preview' : '',
      });
      closePreview();
      setPreviewUrl(url);
    } catch (err) {
      toast.error('Could not build preview: ' + err.message);
    } finally {
      setPreviewing(false);
    }
  };

  const hasLogo = !!form['certificate.logo_key'] || !!logoData;
  const hasSig = !!form['certificate.signature_key'] || !!sigData;

  return (
    <div className="space-y-5">
      {/* Intro + master switch */}
      <div className="card">
        <div className="flex items-center gap-2 mb-1">
          <Award className="w-5 h-5 text-indigo-600" />
          <h3 className="text-base font-semibold text-gray-900">Completion certificate</h3>
        </div>
        <p className="text-xs text-gray-500 mb-4">
          Students download a certificate once they finish every lesson in a course. Tailor how it looks for your academy below, then use Preview to see a sample.
        </p>
        <div className="space-y-1">
          <ModuleToggle
            label="Offer certificates"
            hint="When on, finishing a course unlocks a downloadable certificate for the student."
            on={isOn('certificate.enabled')}
            onClick={toggle('certificate.enabled')}
          />
        </div>
      </div>

      {/* Wording */}
      <div className="card space-y-4">
        <div className="flex items-center gap-2">
          <Type className="w-5 h-5 text-indigo-600" />
          <h3 className="text-base font-semibold text-gray-900">Wording</h3>
        </div>
        <Field label="Title" icon={Type} hint="The big heading printed across the certificate.">
          <input
            type="text"
            className="input-field"
            value={form['certificate.title'] || ''}
            onChange={set('certificate.title')}
            placeholder="Certificate of Completion"
          />
        </Field>
        <Field label="Body line" icon={PenLine} hint="Printed between the student name and the course name.">
          <input
            type="text"
            className="input-field"
            value={form['certificate.body'] || ''}
            onChange={set('certificate.body')}
            placeholder="has successfully completed the course"
          />
        </Field>
        <Field label="Signatory name" icon={PenLine} hint="Printed under the signature line (e.g. the principal or head of academy).">
          <input
            type="text"
            className="input-field"
            value={form['certificate.signatory_name'] || ''}
            onChange={set('certificate.signatory_name')}
            placeholder="e.g. Smt. Lakshmi Rao, Principal"
          />
        </Field>
      </div>

      {/* Layout toggles */}
      <div className="card">
        <div className="flex items-center gap-2 mb-1">
          <Eye className="w-5 h-5 text-indigo-600" />
          <h3 className="text-base font-semibold text-gray-900">What to show</h3>
        </div>
        <p className="text-xs text-gray-500 mb-4">Turn each element on or off to match your academy style.</p>
        <div className="space-y-1">
          <ModuleToggle label="Institute logo"  hint="Your academy logo across the top of the certificate." on={isOn('certificate.show_logo')}       onClick={toggle('certificate.show_logo')} />
          <ModuleToggle label="Student photo"   hint="The student's profile photo, when they have one on file." on={isOn('certificate.show_photo')}      onClick={toggle('certificate.show_photo')} />
          <ModuleToggle label="Signature"       hint="The signature image above the signatory name." on={isOn('certificate.show_signature')}  onClick={toggle('certificate.show_signature')} />
          <ModuleToggle label="Gold seal"       hint="A gold completion seal in the corner." on={isOn('certificate.show_seal')}       onClick={toggle('certificate.show_seal')} />
          <ModuleToggle label="Academy footer"  hint="Your contact phone + email along the bottom." on={isOn('certificate.show_footer')}     onClick={toggle('certificate.show_footer')} />
          <ModuleToggle label="Brand colour"    hint="Use your appearance accent for the border + title. Off uses classic indigo." on={isOn('certificate.use_brand_color')} onClick={toggle('certificate.use_brand_color')} />
          <ModuleToggle label="Verification QR" hint="A QR code linking to a public page that confirms the certificate is genuine." on={isOn('certificate.verify_enabled')}  onClick={toggle('certificate.verify_enabled')} />
        </div>
      </div>

      {/* Images */}
      <div className="card space-y-4">
        <div className="flex items-center gap-2">
          <ImageIcon className="w-5 h-5 text-indigo-600" />
          <h3 className="text-base font-semibold text-gray-900">Images</h3>
        </div>
        <AssetUploader
          label="Institute logo"
          icon={ImageIcon}
          uploaded={hasLogo}
          previewSrc={logoData}
          busy={busyLogo}
          inputRef={logoRef}
          onPick={pick('logo', setLogoData, logoRef)}
          onRemove={() => removeAsset('logo')}
        />
        <AssetUploader
          label="Signature image"
          icon={PenLine}
          uploaded={hasSig}
          previewSrc={sigData}
          busy={busySig}
          inputRef={sigRef}
          onPick={pick('signature', setSigData, sigRef)}
          onRemove={() => removeAsset('signature')}
        />
      </div>

      {/* Preview */}
      <div className="card">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <Eye className="w-5 h-5 text-indigo-600" />
            <div>
              <h3 className="text-base font-semibold text-gray-900">Preview</h3>
              <p className="text-xs text-gray-500 mt-0.5">View a sample certificate using your current settings, right here.</p>
            </div>
          </div>
          <button type="button" onClick={runPreview} disabled={previewing} className="btn-secondary">
            {previewing ? <><Loader2 className="w-4 h-4 animate-spin" /> Building…</> : <><Eye className="w-4 h-4" /> Preview certificate</>}
          </button>
        </div>
      </div>

      {/* Inline preview modal — shows the generated PDF in an iframe so the
          owner can see the certificate without a download. */}
      {previewUrl && (
        <div
          className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-3 sm:p-6"
          onClick={closePreview}
        >
          <div
            className="bg-white rounded-xl shadow-2xl w-full max-w-4xl h-[85vh] flex flex-col overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-gray-200">
              <div className="flex items-center gap-2 min-w-0">
                <Award className="w-5 h-5 text-indigo-600 flex-shrink-0" />
                <h3 className="text-sm font-semibold text-gray-900 truncate">Certificate preview</h3>
              </div>
              <div className="flex items-center gap-2">
                <a
                  href={previewUrl}
                  download="Certificate - preview.pdf"
                  className="btn-secondary"
                >
                  <Download className="w-4 h-4" /> Download
                </a>
                <button type="button" onClick={closePreview} className="p-2 rounded-lg hover:bg-gray-100 text-gray-500">
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>
            <iframe
              src={previewUrl}
              title="Certificate preview"
              className="flex-1 w-full border-0 bg-gray-100"
            />
          </div>
        </div>
      )}
    </div>
  );
}

function AssetUploader({ label, icon: Icon, uploaded, previewSrc, busy, inputRef, onPick, onRemove }) {
  return (
    <div className="flex items-center justify-between gap-4 flex-wrap">
      <div className="flex items-center gap-3 min-w-0">
        <div className="w-14 h-14 rounded-lg border border-gray-200 bg-gray-50 flex items-center justify-center overflow-hidden flex-shrink-0">
          {previewSrc
            ? <img src={previewSrc} alt={label} className="w-full h-full object-contain" />
            : <Icon className="w-6 h-6 text-gray-300" />}
        </div>
        <div className="min-w-0">
          <div className="text-sm font-medium text-gray-900">{label}</div>
          <div className="text-xs text-gray-500 mt-0.5">
            {uploaded ? 'On file' : 'No image uploaded yet'}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <input ref={inputRef} type="file" accept="image/*" className="hidden" onChange={onPick} />
        <button type="button" onClick={() => inputRef.current?.click()} disabled={busy} className="btn-secondary">
          {busy ? <><Loader2 className="w-4 h-4 animate-spin" /> Uploading…</> : <><Upload className="w-4 h-4" /> {uploaded ? 'Replace' : 'Upload'}</>}
        </button>
        {uploaded && (
          <button type="button" onClick={onRemove} className="btn-secondary text-red-600">
            <Trash2 className="w-4 h-4" /> Remove
          </button>
        )}
      </div>
    </div>
  );
}

// ----- Field row ------------------------------------------------------------

function Field({ label, icon: Icon, hint, children }) {
  return (
    <label className="block">
      <span className="flex items-center gap-1.5 text-sm font-medium text-gray-700 mb-1">
        {Icon && <Icon className="w-4 h-4 text-gray-400" />}
        {label}
      </span>
      {children}
      {hint && <p className="text-xs text-gray-400 mt-1">{hint}</p>}
    </label>
  );
}
